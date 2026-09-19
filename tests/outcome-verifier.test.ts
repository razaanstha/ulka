import { expect, test } from 'bun:test';
import { OutcomeVerifier, VerificationUnavailableError } from '../apps/extension/src/agent/outcome-verifier';
import type { PageSnapshot } from '../packages/protocol/src';

const page: PageSnapshot = {
  snapshotId: 's', fingerprint: 'f', pageIdentity: 'p', url: 'https://example.test', title: 'Booking',
  text: 'Choose destination', elements: [{ id: 'e1', nodeId: 1, role: 'combobox', label: 'Destination', value: 'Oslo', expanded: true, optionIds: ['e2'], operations: ['TYPE_TEXT'] },
    { id: 'e2', nodeId: 2, role: 'option', label: 'Oslo Airport', selected: false, operations: ['CLICK'] }],
  scroll: { y: 0, height: 100, viewportHeight: 100 }, guards: {}, createdAt: 1,
};

test('bounded verifier preserves decisive controls and prior evidence, logs metrics without page content', async () => {
  const events: Array<{ event: string; data: any }> = [];
  const usage: unknown[] = [];
  const verifier = new OutcomeVerifier('test', undefined, (_stage, value) => usage.push(value), {
    log: (event, data) => events.push({ event, data }),
    generate: async input => {
      expect(input.reasoning).toBe('none');
      expect(input.maxRetries).toBe(0);
      expect(input.maxOutputTokens).toBe(4096);
      expect(input.system).toContain('later corrections replace earlier constraints');
      expect(input.system).toContain('committed search filters plus matching, settled result facts');
      expect(input.system).toContain('unless the user requested complete itineraries or those details');
      expect(input.system).toContain('If results are still loading');
      expect(input.system).toContain('proposedAnswer');
      expect(input.system).toContain('does not need to appear on the website');
      const payload = JSON.parse(input.prompt as string);
      const table = payload.controlSets[payload.page.elements.controlSetRef];
      const controls = table.rows.map((row: unknown[]) => Object.fromEntries(table.columns.map((key: string, i: number) => [key, row[i]])));
      expect(controls[0]).toMatchObject({ value: 'Oslo', expanded: true, optionIds: ['e2'] });
      expect(controls[1].selected).toBe(false);
      expect(payload.taskEvidence[0].result).toBe('Earlier milestone');
      return { output: { satisfied: false, evidence: 'Suggestion not committed' }, totalUsage: { inputTokens: 100, outputTokens: 20 } };
    },
  });
  expect((await verifier.verify('Select destination', page, [], [{ tool: 'observe_browser', observedAt: 'now', result: 'Earlier milestone' }])).satisfied).toBe(false);
  expect(usage).toEqual([{ inputTokens: 100, outputTokens: 20 }]);
  expect(events.map(e => e.event)).toEqual(['verification_start', 'verification_end']);
  expect(events[0].data).toMatchObject({ scope: 'task', evidenceCount: 1 });
  expect(events[0].data.requestId).toBe(events[1].data.requestId);
  expect(events[1].data.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(events)).not.toContain('Oslo');
});

test('Stop releases stalled verification even when transport ignores abort', async () => {
  let calls = 0; let requestSignal: AbortSignal | undefined;
  const events: any[] = [];
  const usage: unknown[] = [];
  const controller = new AbortController();
  const verifier = new OutcomeVerifier('test', controller.signal, (_stage, value) => usage.push(value), { log: (event, data) => events.push({ event, ...data }),
    generate: async input => { calls++; requestSignal = input.abortSignal; queueMicrotask(() => controller.abort(new Error('User stopped'))); return new Promise(() => {}); },
  });
  await expect(verifier.verify('Select destination', page, [])).rejects.toThrow('User stopped');
  expect(calls).toBe(1);
  expect(requestSignal?.aborted).toBe(true);
  expect(events.at(-1)).toMatchObject({ event: 'verification_error', outcome: 'cancelled' });
  expect(usage).toEqual([undefined]);
});

test('user cancellation interrupts verifier and preserves cancellation reason', async () => {
  const controller = new AbortController();
  const reason = new Error('User stopped');
  const verifier = new OutcomeVerifier('test', controller.signal, undefined, {
    generate: async () => { controller.abort(reason); return new Promise(() => {}); },
  });
  await expect(verifier.verify('Select destination', page, [])).rejects.toBe(reason);
});

test('pre-cancelled verification makes no model call', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const verifier = new OutcomeVerifier('test', controller.signal, undefined, {
    generate: async () => { calls++; return { output: { satisfied: true, evidence: 'Invalid' } }; },
  });
  await expect(verifier.verify('Select destination', page, [])).rejects.toThrow();
  expect(calls).toBe(0);
});

test('malformed verdict and provider failures remain unverified', async () => {
  for (const generate of [async () => ({ output: { satisfied: true } }), async () => { throw new Error('Provider unavailable'); }]) {
    const verifier = new OutcomeVerifier('test', undefined, undefined, { generate });
    await expect(verifier.verify('Select destination', page, [])).rejects.toBeInstanceOf(VerificationUnavailableError);
  }
});

test('transient verifier failure retries the same observation once and resumes with its verdict', async () => {
  const requests: any[] = [], events: any[] = [], usage: unknown[] = [];
  const verifier = new OutcomeVerifier('test', undefined, (_stage, value) => usage.push(value), {
    log: (event, data) => events.push({ event, ...data }),
    generate: async input => {
      requests.push(input);
      if (requests.length === 1) throw Object.assign(new Error('Temporary gateway failure'), { name: 'GatewayInternalServerError', statusCode: 500, isRetryable: true });
      return { output: { satisfied: true, evidence: 'Observed selected destination' }, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  });
  expect((await verifier.verify('Select destination', page, [])).satisfied).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests[1].prompt).toBe(requests[0].prompt);
  expect(requests[1].abortSignal).toBe(requests[0].abortSignal);
  expect(usage).toEqual([undefined, { inputTokens: 10, outputTokens: 5 }]);
  expect(events.find(event => event.event === 'verification_retry')).toMatchObject({ attempt: 1, nextAttempt: 2 });
  expect(events.at(-1)).toMatchObject({ event: 'verification_end', attempt: 2, satisfied: true });
});

test('persistent transient errors stop after one retry', async () => {
  let calls = 0;
  const verifier = new OutcomeVerifier('test', undefined, undefined, {
    generate: async () => { calls++; throw Object.assign(new Error('Unavailable'), { name: 'GatewayInternalServerError' }); },
  });
  await expect(verifier.verify('Select destination', page, [])).rejects.toBeInstanceOf(VerificationUnavailableError);
  expect(calls).toBe(2);
});

test('permanent request failures are not retried even when gateway wraps them as 500', async () => {
  for (const statusCode of [400, 401, 403, 404]) {
    let calls = 0;
    const verifier = new OutcomeVerifier('test', undefined, undefined, {
      generate: async () => {
        calls++;
        throw Object.assign(new Error('Bad request'), { name: 'GatewayInternalServerError', statusCode: 500, isRetryable: true, cause: { statusCode } });
      },
    });
    await expect(verifier.verify('Select destination', page, [])).rejects.toBeInstanceOf(VerificationUnavailableError);
    expect(calls).toBe(1);
  }
});

test('user stop during verifier retry backoff prevents a second request', async () => {
  let calls = 0; const controller = new AbortController();
  const verifier = new OutcomeVerifier('test', controller.signal, undefined, {
    log: event => { if (event === 'verification_retry') controller.abort(new Error('User stopped')); },
    generate: async () => { calls++; throw Object.assign(new Error('Unavailable'), { name: 'GatewayInternalServerError' }); },
  });
  await expect(verifier.verify('Select destination', page, [])).rejects.toThrow('User stopped');
  expect(calls).toBe(1);
});

test('verification retry retains user cancellation when second transport stalls', async () => {
  const signals: AbortSignal[] = []; const events: any[] = [];
  const controller = new AbortController();
  const verifier = new OutcomeVerifier('test', controller.signal, undefined, {
    log: (event, data) => events.push({ event, ...data }),
    generate: async input => {
      signals.push(input.abortSignal!);
      if (signals.length === 1) throw Object.assign(new Error('Temporary'), { statusCode: 503 });
      queueMicrotask(() => controller.abort(new Error('User stopped')));
      return new Promise(() => {});
    },
  });
  await expect(verifier.verify('Select destination', page, [])).rejects.toThrow('User stopped');
  expect(signals).toHaveLength(2);
  expect(signals[1]).toBe(signals[0]);
  expect(signals[1].aborted).toBe(true);
  expect(events.at(-1)).toMatchObject({ event: 'verification_error', attempt: 2, outcome: 'cancelled' });
});

test('completion failure exposes safe status and preserves cause without leaking provider text', async () => {
  const cause = Object.assign(new Error('Secret page content and credentials'), { name: 'GatewayInternalServerError', cause: { name: 'AI_APICallError', statusCode: 405, isRetryable: false } });
  const verifier = new OutcomeVerifier('test', undefined, undefined, { generate: async () => { throw cause; } });
  try {
    await verifier.verify('Select destination', page, []);
    throw new Error('Expected verification failure');
  } catch (error) {
    expect(error).toBeInstanceOf(VerificationUnavailableError);
    expect((error as Error).message).toContain('HTTP 405');
    expect((error as Error).message).not.toContain('Secret page');
    expect((error as Error).cause).toBe(cause);
  }
});

test('truncated JSON gets one fresh verification with more output room and accounts for failed usage', async () => {
  const { NoObjectGeneratedError } = await import('ai');
  const requests: any[] = [], events: any[] = [], usage: unknown[] = [];
  const verifier = new OutcomeVerifier('test', undefined, (_, value) => usage.push(value), {
    log: (event, data) => events.push({ event, ...data }),
    generate: async input => {
      requests.push(input);
      if (requests.length === 1) throw new NoObjectGeneratedError({ text: 'private incomplete verdict', finishReason: 'length',
        usage: { inputTokens: 100, outputTokens: 1200 } as any, response: {} as any });
      return { output: { satisfied: false, evidence: 'Destination still missing' }, usage: { inputTokens: 100, outputTokens: 40 } };
    },
  });
  expect((await verifier.verify('Select destination', page, [])).satisfied).toBe(false);
  expect(requests).toHaveLength(2);
  expect(requests[1].prompt).toBe(requests[0].prompt);
  expect(requests[1].maxOutputTokens).toBeGreaterThan(requests[0].maxOutputTokens);
  expect(requests[1].system).toContain('previous verification response');
  expect(usage[0]).toEqual({ inputTokens: 100, outputTokens: 1200 });
  expect(events.find(e => e.event === 'verification_error')).toMatchObject({ finishReason: 'length', generatedChars: 26 });
  expect(JSON.stringify(events)).not.toContain('private incomplete verdict');
});

test('malformed verifier response recovery is bounded and never accepts an invalid verdict', async () => {
  const { NoObjectGeneratedError } = await import('ai');
  let calls = 0;
  const verifier = new OutcomeVerifier('test', undefined, undefined, { generate: async () => {
    calls++;
    throw new NoObjectGeneratedError({ text: 'not json', finishReason: 'stop', usage: {} as any, response: {} as any });
  } });
  await expect(verifier.verify('Select destination', page, [])).rejects.toBeInstanceOf(VerificationUnavailableError);
  expect(calls).toBe(2);
});


test('schema failure gets reasoning headroom on repair even without truncation', async () => {
  const { NoObjectGeneratedError } = await import('ai');
  const requests: any[] = [];
  const verifier = new OutcomeVerifier('test', undefined, undefined, {
    generate: async input => {
      requests.push(input);
      if (requests.length === 1) throw new NoObjectGeneratedError({
        text: '{"satisfied":"yes"}', finishReason: 'stop',
        usage: { inputTokens: 3022, outputTokens: 1030,
          outputTokenDetails: { reasoningTokens: 953, textTokens: 77 } } as any,
        response: {} as any,
      });
      expect(input.maxOutputTokens).toBe(8192);
      return { output: { satisfied: false, evidence: 'Selection unconfirmed' } };
    },
  });
  expect(await verifier.verify('Select destination', page, [])).toEqual({ satisfied: false, evidence: 'Selection unconfirmed' });
  expect(requests).toHaveLength(2);
  expect(requests[1].prompt).toBe(requests[0].prompt);
});
