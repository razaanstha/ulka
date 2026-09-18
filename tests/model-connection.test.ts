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
  expect(requests).toHaveLength(4);
  expect(requests[0]!.headers.has('ai-gateway-auth-method')).toBe(false);
  expect(requests[1]!.headers.get('ai-gateway-auth-method')).toBe('api-key');
  expect(requests[1]!.body.responseFormat).toBeUndefined();
  expect(requests[2]!.body.responseFormat.type).toBe('json');
  expect(requests[2]!.body.reasoning).toBeUndefined();
  expect(requests[3]!.body.reasoning).toBe('low');
  expect(result.every(item => item.status === 'failed')).toBe(true);
  expect(JSON.stringify(result)).toContain('test-request');
  expect(JSON.stringify(result)).toContain('method_not_allowed');
  expect(JSON.stringify(result)).toContain('[redacted]');
  expect(JSON.stringify(result)).not.toContain('private-test-key');
});

test('model check bounds stalled transports even when fetch ignores cancellation', async () => {
  const result = await testModelConnection('test', async () => new Promise(() => {}), 5);
  expect(result).toHaveLength(4);
  expect(result.every(item => item.status === 'failed')).toBe(true);
});
