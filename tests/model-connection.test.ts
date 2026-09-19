import { expect, test } from 'bun:test';
import { testModelConnection } from '../apps/extension/src/agent/model-connection';

test('model check isolates schema, reasoning and headers without sending browser content or exposing credentials', async () => {
  const requests: Array<{ headers: Headers; body: any }> = [];
  const result = await testModelConnection('private-test-key', async (_url, init) => {
    requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ error: { message: 'Method not allowed private-test-key', code: 'method_not_allowed' } }), {
      status: 405, headers: { 'content-type': 'application/json', 'x-vercel-id': 'test-request' },
    });
  });
  expect(requests).toHaveLength(7);
  expect(requests.every(request => request.body.providerOptions.gateway.zeroDataRetention === false)).toBe(true);
  expect(requests[0]!.headers.has('ai-gateway-auth-method')).toBe(false);
  expect(requests[1]!.headers.get('ai-gateway-auth-method')).toBe('api-key');
  expect(requests[1]!.body.responseFormat).toBeUndefined();
  expect(requests[2]!.body.responseFormat.type).toBe('json');
  expect(requests[2]!.body.reasoning).toBeUndefined();
  expect(requests[3]!.body.reasoning).toBe('none');
  expect(requests.slice(4).every(request => request.body.reasoning === 'none')).toBe(true);
  expect(result.slice(4).every(item => item.model === 'deepseek/deepseek-v4.1-flash')).toBe(true);
  expect(requests[4].body.responseFormat.schema.properties).toHaveProperty('suitable');
  expect(requests[5].body.responseFormat.schema.properties).toHaveProperty('date');
  expect(requests[6].body.responseFormat.schema.properties).toHaveProperty('approved');
  expect(result.every(item => item.status === 'failed')).toBe(true);
  expect(JSON.stringify(result)).toContain('test-request');
  expect(JSON.stringify(result)).toContain('method_not_allowed');
  expect(JSON.stringify(result)).toContain('[redacted]');
  expect(JSON.stringify(result)).not.toContain('private-test-key');
});

test('model check bounds stalled transports even when fetch ignores cancellation', async () => {
  const result = await testModelConnection('test', async () => new Promise(() => {}), 5);
  expect(result).toHaveLength(7);
  expect(result.every(item => item.status === 'failed')).toBe(true);
});

test('connection checks exercise real contracts and reject semantically wrong synthetic values', async () => {
  const results = await testModelConnection('test', async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const properties = body.responseFormat?.schema?.properties ?? {};
    const output = properties.text ? { suitable: true, reason: 'Synthetic', text: 'Wrong name' }
      : properties.date ? { suitable: true, reason: 'Synthetic', date: { format: 'iso', day: 5, month: 10, year: 2026 } }
      : properties.approved ? { approved: true, reason: 'Synthetic' }
      : properties.satisfied ? { satisfied: true, evidence: 'Synthetic' } : { ok: true };
    const events = [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: JSON.stringify(output) }, { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  });
  expect(results.filter(result => result.status === 'failed').map(result => result.check)).toEqual(['sdk_text_generation']);
  expect(results.find(result => result.check === 'sdk_text_generation')?.error).toMatchObject({
    message: 'Synthetic contract values did not match. Expected {"suitable":true,"text":"Ulka QA"}; received {"suitable":true,"text":"Wrong name"}',
  });
  expect(results.find(result => result.check === 'sdk_text_date')?.status).toBe('passed');
});
