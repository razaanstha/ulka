import { describe, expect, test } from "bun:test";
import { VercelJevDecisionEngine, validateGatewayChoice } from "../apps/extension/src/agent/vercel-jev";
import { progressActionKey } from "../apps/extension/src/agent/history";
import type { ActionRecord, PageSnapshot } from "../packages/protocol/src";

const snapshot: PageSnapshot = {
  snapshotId: "s", fingerprint: "f", pageIdentity: "p", url: "https://example.test", title: "Example", text: "About",
  scroll: { y: 0, height: 100, viewportHeight: 100 }, createdAt: 1,
  elements: [{ id: "e1", nodeId: 1, role: "button", label: "About", operations: ["CLICK"] }],
  guards: { e1: { nodeId: 1, role: "button", label: "About", enabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } } },
};

test('a just-entered date advances to confirmation instead of retyping the same value', async () => {
  const field = { id: 'end', nodeId: 2, role: 'textbox', label: 'Return', value: '2026-10-10', operations: ['TYPE_TEXT', 'PRESS_ENTER'] as const };
  const page: PageSnapshot = { ...snapshot, elements: [
    { ...field, operations: [...field.operations] },
    { id: 'apply', nodeId: 3, role: 'button', label: 'Done', operations: ['CLICK'] },
  ] };
  const typed = { step: 1, operation: 'TYPE_TEXT' as const, target: 'end', targetLabel: 'Return', text: field.value, url: page.url, executedAt: 1, pageChanged: true };
  const evaluator = async (input: any): Promise<any> => {
    expect(input.state.action_targets.TYPE_TEXT).toBeUndefined();
    expect(input.questions.operation.criteria.TYPE_TEXT).toBeUndefined();
    expect(input.state.action_targets.CLICK).toContain('apply');
    expect(input.state.action_targets.PRESS_ENTER).toContain('end');
    return combinedAnswers(input, 'CLICK', 'apply');
  };
  expect(await new VercelJevDecisionEngine('test', evaluator).decide('Change return date', page, [typed])).toMatchObject({ operation: 'CLICK', target: 'apply' });

  // A rejected commit, changed/truncated value, or absence of confirmation must
  // retain editing so recovery remains possible.
  for (const [state, history] of [
    [page, [{ ...typed, operation: 'CLICK' as const, target: 'apply' }]],
    [{ ...page, elements: [{ ...page.elements[0], value: 'wrong' }, page.elements[1]] }, [typed]],
    [{ ...page, elements: [{ ...page.elements[0], valueTruncated: true }, page.elements[1]] }, [typed]],
    [{ ...page, elements: [page.elements[0]] }, [typed]],
  ] as Array<[PageSnapshot, ActionRecord[]]>) {
    await new VercelJevDecisionEngine('test', async (input: any): Promise<any> => {
      expect(input.state.action_targets.TYPE_TEXT).toContain('end');
      return combinedAnswers(input, 'TYPE_TEXT', 'end');
    }).decide('Change return date', state, [...history]);
  }
});

test('editable date fields advertise direct entry while read-only calendars retain their actions', async () => {
  const page: PageSnapshot = { ...snapshot, elements: [
    { id: 'start', nodeId: 1, role: 'textbox', label: 'Departure', value: 'Sat, Oct 3', operations: ['CLICK', 'TYPE_TEXT'] },
    { id: 'end', nodeId: 2, role: 'textbox', label: 'Return', value: 'Sat, Oct 10', operations: ['CLICK', 'TYPE_TEXT'] },
    { id: 'readonly', nodeId: 3, role: 'textbox', label: 'Start date', operations: ['CLICK'] },
    { id: 'day', nodeId: 4, role: 'button', label: 'Friday, October 9, 2026', operations: ['CLICK'] },
  ] };
  const evaluator = async (input: any): Promise<any> => {
    expect(input.state.widget_state.editable_date_fields.map((e: any) => e.id)).toEqual(['start', 'end']);
    expect(input.state).toStrictEqual(JSON.parse(JSON.stringify(input.state)));
    expect(input.questions.operation.criteria.TYPE_TEXT).toContain('Prefer this for editable dates');
    expect(input.state.decision_rules).toContain('Apply/Done');
    expect(input.questions.click_target.criteria).toHaveProperty('day');
    return combinedAnswers(input, 'TYPE_TEXT', 'end');
  };
  const result = await new VercelJevDecisionEngine('test', evaluator).decide('Change return to October 9, keep departure October 3', page, []);
  expect(result).toMatchObject({ operation: 'TYPE_TEXT', target: 'end' });
});

describe("Vercel Gateway Jev engine", () => {
  test('Stop cancels stalled evaluation even if transport ignores cancellation', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const evaluator = (input: any) => {
      requestSignal = input.abortSignal;
      queueMicrotask(() => controller.abort(new Error('User stopped')));
      return new Promise<any>(() => {});
    };
    const engine = new VercelJevDecisionEngine('test', evaluator, controller.signal);
    await expect(engine.decide('Continue', snapshot, [])).rejects.toThrow('User stopped');
    expect(requestSignal?.aborted).toBe(true);
  });

  test('Stop releases stalled target selection without waiting for transport', async () => {
    const controller = new AbortController();
    let targetStarted!: () => void;
    const started = new Promise<void>(resolve => { targetStarted = resolve; });
    const evaluator = async (input: any): Promise<any> => {
      if (input.questions.click_target) { targetStarted(); return new Promise(() => {}); }
      throw new Error('Expected a combined request');
      return { answers: { operation: { type: 'choice', choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'CLICK' ? 1 : 0])) } } };
    };
    const pending = new VercelJevDecisionEngine('test', evaluator, controller.signal).decide('Continue', { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2' }] }, []);
    await started;
    controller.abort(new Error('Stopped by user'));
    await expect(pending).rejects.toThrow('Stopped by user');
  });
  test('repeated ineffective target is excluded while another control stays available', async () => {
    const page = { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2', label: 'Alternative' }] };
    const history = [1, 2].map(step => ({ step, operation: 'CLICK' as const, targetLabel: 'About', url: page.url, fingerprint: page.fingerprint, pageChanged: false, executedAt: step }));
    const evaluator = async (input: any): Promise<{ answers: Record<string, { type: 'choice'; choice: string; probabilities: Record<string, number> }> }> => {
      if (input.questions.target) {
        expect(Object.keys(input.questions.target.criteria)).toEqual(['e2']);
        return { answers: { target: { type: 'choice' as const, choice: 'e2', probabilities: { e2: 1 } } } };
      }
      return { answers: { operation: { type: 'choice' as const, choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'CLICK' ? 1 : 0])) } } };
    };
    expect((await new VercelJevDecisionEngine('test', evaluator).decide('Continue', page, history)).target).toBe('e2');
  });
  test('rejected completion removes DONE and includes feedback as evidence', async () => {
    const evaluator = async (input: any) => {
      expect(input.questions.operation.criteria.DONE).toBeUndefined();
      expect(input.state.verification_feedback.evidence).toBe('Missing outcome');
      return { answers: { operation: { type: 'choice' as const, choice: 'BLOCKED', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'BLOCKED' ? 1 : 0])) } } };
    };
    await new VercelJevDecisionEngine('test', evaluator).decide('Continue', snapshot, [], { evidence: 'Missing outcome', excludeDone: true });
  });
  test('exhausted waits are removed from action choices', async () => {
    const evaluator = async (input: any) => {
      expect(input.questions.operation.criteria.WAIT).toBeUndefined();
      return { answers: { operation: { type: 'choice' as const, choice: 'BLOCKED', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'BLOCKED' ? 1 : 0])) } } };
    };
    const history = [1, 2].map(step => ({ step, operation: 'WAIT' as const, url: snapshot.url, pageChanged: false, executedAt: step }));
    expect((await new VercelJevDecisionEngine('test', evaluator).decide('Continue', snapshot, history)).operation).toBe('BLOCKED');
  });
  test("retries invalid argmax output once without accepting it", async () => {
    let calls = 0;
    const evaluator = async (input: any) => {
      expect(input.providerOptions.gateway.zeroDataRetention).toBe(false);
      if (++calls === 1) throw new Error('Question "operation" did not select a highest-probability option.');
      return { answers: { operation: { type: "choice" as const, choice: "DONE", probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(id => [id, id === "DONE" ? 1 : 0])) } } };
    };
    expect((await new VercelJevDecisionEngine("test", evaluator).decide("Read", snapshot, [])).operation).toBe("DONE");
    expect(calls).toBe(2);
  });

  test("persistent invalid choices stop after two attempts", async () => {
    let calls = 0;
    const evaluator = async () => { calls++; throw new Error('Question "operation" did not select a highest-probability option.'); };
    await expect(new VercelJevDecisionEngine("test", evaluator).decide("Read", snapshot, [])).rejects.toThrow("highest-probability");
    expect(calls).toBe(2);
  });
  test("maps operation and authoritative click target", async () => {
    let call = 0;
    const evaluator: any = async (input: any) => {
      expect(input.model.modelId).toBe("typesafe-ai/jev");
      call += 1;
      if (call === 2) {
        expect(Object.keys(input.questions)).toEqual(["target"]);
        return { answers: { target: { type: "choice" as const, choice: "e1", probabilities: { e1: 1 } } } };
      }
      expect(Object.keys(input.questions)).toEqual(["operation"]);
      const operationIds = Object.keys(input.questions.operation.criteria);
      const remainder = 0.2 / (operationIds.length - 1);
      return { answers: {
        operation: { type: "choice" as const, choice: "CLICK", probabilities: Object.fromEntries(operationIds.map((id) => [id, id === "CLICK" ? 0.8 : remainder])) },
      } };
    };
    const decision = await new VercelJevDecisionEngine("test-key", evaluator).decide("Open About", snapshot, []);
    expect(decision.operation).toBe("CLICK");
    expect(decision.target).toBe("e1");
    expect(decision.confidence).toBe(0.8);
    expect(call).toBe(1);
    expect(decision.targetProbabilities).toBeUndefined();
  });

  test("sends JSON-compatible state after an action with absent optional fields", async () => {
    const containsUndefined = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(containsUndefined);
      if (value && typeof value === "object") return Object.values(value).some((item) => item === undefined || containsUndefined(item));
      return false;
    };
    const evaluator = async (input: any) => {
      expect(containsUndefined(input.state)).toBe(false);
      const operationIds = Object.keys(input.questions.operation.criteria);
      return { answers: {
        operation: { type: "choice" as const, choice: "DONE", probabilities: Object.fromEntries(operationIds.map((id) => [id, id === "DONE" ? 1 : 0])) },
      } };
    };
    const history = [{ step: 1, operation: "CLICK" as const, url: snapshot.url, executedAt: 1 }];
    await expect(new VercelJevDecisionEngine("test-key", evaluator).decide("Open About", snapshot, history)).resolves.toMatchObject({ operation: "DONE" });
  });

  test("rejects absent and non-argmax probability distributions", () => {
    expect(() => validateGatewayChoice({ type: "choice", choice: "A" }, ["A", "B"])).toThrow();
    expect(() => validateGatewayChoice({ type: "choice", choice: "A", probabilities: { A: 0.2, B: 0.8 } }, ["A", "B"])).toThrow();
  });
});


test('exhausted unlabeled toggle is removed before choosing another control', async () => {
  const page = { ...snapshot, elements: [{ ...snapshot.elements[0], label: '' }, { ...snapshot.elements[0], id: 'e2', label: 'Search', nodeId: 2 }] };
  const key = progressActionKey(page, { operation: 'CLICK', target: 'e1' })!;
  const evaluator = async (input: any): Promise<any> => {
    if (input.questions.target) {
      expect(Object.keys(input.questions.target.criteria)).toEqual(['e2']);
      return { answers: { target: { type: 'choice', choice: 'e2', probabilities: { e2: 1 } } } };
    }
    expect(input.state.verification_feedback).toBeUndefined();
    return { answers: { operation: { type: 'choice', choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'CLICK' ? 1 : 0])) } } };
  };
  expect((await new VercelJevDecisionEngine('test', evaluator).decide('Search', page, [], { exhaustedActions: [key] })).target).toBe('e2');
});


test('multiple compatible targets are chosen in the same request as operation', async () => {
  const page = { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2', label: 'Help' }] };
  let calls = 0;
  const evaluator = async (input: any): Promise<any> => {
    calls++;
    expect(Object.keys(input.questions)).toEqual(['operation', 'click_target']);
    return combinedAnswers(input, 'CLICK', 'e2');
  };
  const result = await new VercelJevDecisionEngine('test', evaluator).decide('Open Help', page, []);
  expect(calls).toBe(1);
  expect(result.target).toBe('e2');
  expect(result.targetProbabilities).toEqual({ e1: 0, e2: 1 });
});

function combinedAnswers(input: any, operation: string, target: string) {
  return { usage: { inputTokens: 10, outputTokens: 1 }, answers: Object.fromEntries(
    Object.entries(input.questions).map(([key, question]: [string, any]) => {
      const choice = key === 'operation' ? operation : target;
      return [key, { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map(id => [id, id === choice ? 1 : 0])) }];
    })
  ) };
}

test('model requests omit local metadata, retain compatibility, and report each evaluation', async () => {
  const reports: any[] = [], requests: any[] = [];
  const page = { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2', label: 'Help', selected: true }] };
  const evaluator = async (input: any): Promise<any> => {
    requests.push(input);
    return combinedAnswers(input, 'CLICK', 'e2');
  };
  await new VercelJevDecisionEngine('test', evaluator, undefined, (stage, usage) => reports.push({ stage, usage })).decide('Help', page, []);
  expect(requests.map(r => r.providerOptions)).toEqual([{ gateway: { zeroDataRetention: false } }]);
  expect(requests[0].state.action_targets.CLICK).toEqual(['e1', 'e2']);
  expect(requests[0].state.elements[1]).toMatchObject({ id: 'e2', label: 'Help', selected: true });
  expect(JSON.stringify(requests.map(r => r.state))).not.toContain('nodeId');
  expect(requests[0].questions.click_target.criteria.e2).toMatchObject({ element: '[e2] Help', role: 'button' });
  expect(requests[0].questions.click_target.criteria.e2.selected).toBeUndefined();
  expect(requests[0].questions.click_target.instructions.rules).toContain(requests[0].questions.operation.instructions.rules);
  expect(requests[0].questions.click_target.criteria.e2.element).toContain('Help');
  expect(reports.map(r => r.stage)).toEqual(['jev_decision']);
});


test('combined decision heads retain message editor structure and conversation relationships', async () => {
  const context = [{ id: 'g1', role: 'dialog', label: 'Messaging', heading: 'New message' }];
  const page: PageSnapshot = { ...snapshot, elements: [
    { id: 'e1', nodeId: 1, role: 'combobox', label: 'Enter message recipients', context, operations: ['TYPE_TEXT'] },
    { id: 'e2', nodeId: 2, role: 'textbox', label: 'Write a message…', context: [...context, { id: 'g2', role: 'form' }], multiline: true, operations: ['TYPE_TEXT'] },
  ] };
  const requests: any[] = [];
  const evaluator = async (input: any): Promise<any> => {
    requests.push(input);
    return combinedAnswers(input, 'TYPE_TEXT', 'e2');
  };
  const result = await new VercelJevDecisionEngine('test', evaluator).decide('Draft the message', page, []);
  expect(result.target).toBe('e2');
  for (const rows of [requests[0].state.elements]) {
    expect(rows[0].context[0]).toEqual(context[0]);
    expect(rows[1].context).toEqual(page.elements[1].context);
    expect(rows[1].multiline).toBe(true);
  }
});

test('large calendars omit offscreen rows from decisions without losing visible dates or blocked editors', async () => {
  const page: PageSnapshot = { ...snapshot, elements: [
    { ...snapshot.elements[0], label: 'October 5, 2026' },
    { id: 'editor', nodeId: 2, role: 'textbox', label: 'Write a message', availability: 'occluded', operations: [] },
    ...Array.from({ length: 248 }, (_, i) => ({ id: `date${i}`, nodeId: i + 3, role: 'button', label: `Offscreen date ${i}`, availability: 'offscreen' as const, operations: [] })),
  ], scroll: { y: 0, height: 2000, viewportHeight: 800 } };
  const evaluator = async (input: any) => {
    expect(input.state.elements.map((e: any) => e.id)).toEqual(['e1', 'editor']);
    expect(input.state.offscreen_controls).toEqual({ count: 248, by_role: { button: 248 } });
    expect(input.questions.operation.criteria.SCROLL_DOWN).toBeDefined();
    expect(input.state.action_targets.CLICK).toEqual(['e1']);
    return { answers: { operation: { type: 'choice' as const, choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(id => [id, id === 'CLICK' ? 1 : 0])) } } };
  };
  expect((await new VercelJevDecisionEngine('test', evaluator).decide('Select October 5', page, [])).target).toBe('e1');
});

test('speculative heads stay operation-compatible and only selected head drives target', async () => {
  const page: PageSnapshot = { ...snapshot, elements: [
    ...snapshot.elements, { ...snapshot.elements[0], id: 'e2', nodeId: 2 },
    { id: 'q1', nodeId: 3, role: 'textbox', label: 'Search', operations: ['TYPE_TEXT'] },
    { id: 'q2', nodeId: 4, role: 'textbox', label: 'Name', operations: ['TYPE_TEXT'] },
  ] };
  let calls = 0;
  const evaluator = async (input: any): Promise<any> => {
    calls++;
    expect(Object.keys(input.questions.click_target.criteria)).toEqual(['e1', 'e2']);
    expect(Object.keys(input.questions.type_text_target.criteria)).toEqual(['q1', 'q2']);
    const result = combinedAnswers(input, 'TYPE_TEXT', 'q2');
    // An unused head cannot supply the selected operation's target.
    result.answers.click_target = { type: 'choice', choice: 'e1', probabilities: { e1: 1, e2: 0 } };
    return result;
  };
  const decision = await new VercelJevDecisionEngine('test', evaluator).decide('Fill Name', page, []);
  expect(decision).toMatchObject({ operation: 'TYPE_TEXT', target: 'q2' });
  expect(calls).toBe(1);
});

test('invalid selected target never escapes combined decision validation', async () => {
  const page = { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2' }] };
  let calls = 0;
  const evaluator = async (input: any): Promise<any> => {
    calls++;
    return combinedAnswers(input, 'CLICK', 'unobserved');
  };
  await expect(new VercelJevDecisionEngine('test', evaluator).decide('Click', page, [])).rejects.toThrow('Invalid Jev response');
  expect(calls).toBe(2);
});

test('combined native select preserves observed option identity', async () => {
  const page: PageSnapshot = { ...snapshot, elements: [{ id: 's1', nodeId: 3, role: 'combobox', label: 'Country', operations: ['SELECT'], options: [
    { id: 'o1', label: 'Sweden', value: 'SE' }, { id: 'o2', label: 'Norway', value: 'NO' },
  ] }] };
  const evaluator = async (input: any): Promise<any> => {
    const ids = Object.keys(input.questions.select_target.criteria);
    expect(ids).toHaveLength(2);
    return combinedAnswers(input, 'SELECT', ids[1]);
  };
  const result = await new VercelJevDecisionEngine('test', evaluator).decide('Select Norway', page, []);
  expect(result.operation).toBe('SELECT');
  expect(result.target).toBe('s1:o2');
  expect(result.option).toBe('o2');
});


test('fan-out references shared controls without repeating full widget records', async () => {
  const page: PageSnapshot = { ...snapshot, elements: Array.from({ length: 40 }, (_, i) => ({
    id: `e${i}`, nodeId: i, role: 'combobox', label: `Destination ${i}`, expanded: true,
    optionIds: ['o1', 'o2'], activeOptionId: 'o2', value: 'London',
    context: [{ id: 'form', role: 'form', label: 'Travel preferences', heading: 'Choose your route and dates' }],
    operations: ['CLICK', 'TYPE_TEXT', 'PRESS_ENTER', 'ARROW_DOWN', 'ARROW_UP'],
  })) };
  const evaluator = async (input: any): Promise<any> => {
    let duplicatedRows = 0;
    for (const [head, question] of Object.entries(input.questions) as [string, any][]) {
      if (head === 'operation') continue;
      for (const [id, descriptor] of Object.entries(question.criteria) as [string, any][]) {
        expect(descriptor.context).toBeUndefined();
        const row = input.state.elements.find((element: any) => element.id === id);
        expect(row.context).toEqual(page.elements[0].context);
        duplicatedRows += JSON.stringify({ ...row, ...descriptor }).length - JSON.stringify(descriptor).length;
      }
    }
    const current = JSON.stringify({ state: input.state, questions: input.questions }).length;
    expect(current / (current + duplicatedRows)).toBeLessThan(0.6);
    return combinedAnswers(input, 'TYPE_TEXT', 'e0');
  };
  expect((await new VercelJevDecisionEngine('test', evaluator).decide('Fill destination', page, [])).target).toBe('e0');
});
