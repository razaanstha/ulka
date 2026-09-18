import { expect, test } from 'bun:test';
import { createGateway, Output } from 'ai';
import { z } from 'zod';
import { generateStructuredText } from '../apps/extension/src/agent/structured-generation';

function testGateway(options: { apiKey: string; fetch: (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response> }) {
  return createGateway({ ...options, fetch: Object.assign(options.fetch, { preconnect: fetch.preconnect }) });
}

const schema = z.object({ satisfied: z.boolean(), evidence: z.string() });
function response(text: string) {
  const events = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: text.slice(0, 10) },
    { type: 'text-delta', id: 'answer', delta: text.slice(10) },
    { type: 'text-end', id: 'answer' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    } },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('structured Gateway requests stream and return complete validated output with usage', async () => {
  const gateway = testGateway({ apiKey: 'test', fetch: async (_url, init) => {
    expect(new Headers(init?.headers).get('ai-language-model-streaming')).toBe('true');
    return response(JSON.stringify({ satisfied: true, evidence: 'Observed result' }));
  } });
  const result = await generateStructuredText({ model: gateway('deepseek/deepseek-v4.1-flash'), prompt: 'Verify', output: Output.object({ schema }), maxRetries: 0 });
  expect(result.output).toEqual({ satisfied: true, evidence: 'Observed result' });
  expect(result.totalUsage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
});

test('structured stream rejects invalid final schema', async () => {
  const gateway = testGateway({ apiKey: 'test', fetch: async () => response('{"satisfied":"yes"}') });
  await expect(generateStructuredText({ model: gateway('deepseek/deepseek-v4.1-flash'), prompt: 'Verify', output: Output.object({ schema }), maxRetries: 0 })).rejects.toThrow();
});

test('structured stream preserves transport failure instead of producing a verdict', async () => {
  const gateway = testGateway({ apiKey: 'test', fetch: async () => new Response(JSON.stringify({ error: { message: 'Method not allowed', type: 'internal_server_error' } }), { status: 405 }) });
  try {
    await generateStructuredText({ model: gateway('deepseek/deepseek-v4.1-flash'), prompt: 'Verify', output: Output.object({ schema }), maxRetries: 0 });
    throw new Error('Expected rejection');
  } catch (error) {
    expect(error).toMatchObject({ statusCode: 405 });
  }
});

test('structured stream honors pre-cancellation without a network request', async () => {
  const controller = new AbortController();
  controller.abort(new Error('User stopped'));
  const gateway = testGateway({ apiKey: 'test', fetch: async () => { throw new Error('Unexpected request'); } });
  await expect(generateStructuredText({ model: gateway('deepseek/deepseek-v4.1-flash'), prompt: 'Verify', output: Output.object({ schema }), abortSignal: controller.signal })).rejects.toThrow('User stopped');
});

test('cancellation during a partial stream never returns a verdict', async () => {
  const controller = new AbortController();
  const gateway = testGateway({ apiKey: 'test', fetch: async (_url, init) => {
    const stream = new ReadableStream<Uint8Array>({ start(sink) {
      const encoder = new TextEncoder();
      for (const event of [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'answer' },
        { type: 'text-delta', id: 'answer', delta: '{"satisfied":true' },
      ]) sink.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      init?.signal?.addEventListener('abort', () => sink.error(init.signal!.reason), { once: true });
      queueMicrotask(() => controller.abort(new Error('User stopped mid-stream')));
    } });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  } });
  await expect(generateStructuredText({ model: gateway('deepseek/deepseek-v4.1-flash'), prompt: 'Verify', output: Output.object({ schema }), abortSignal: controller.signal, maxRetries: 0 })).rejects.toThrow('User stopped mid-stream');
});
