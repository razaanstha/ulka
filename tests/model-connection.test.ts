import { expect, test } from 'bun:test';
import { testModelConnection } from '../apps/extension/src/agent/model-connection';

test('model check isolates schema, reasoning and headers without sending browser content or exposing credentials', async () => {
  const requests: Array<{ url: string; headers: Headers; body: any }> = [];
  const result = await testModelConnection('private-test-key', async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ error: { message: 'Method not allowed private-test-key', code: 'method_not_allowed' } }), {
      status: 405, headers: { 'content-type': 'application/json', 'x-vercel-id': 'test-request' },
    });
  });
  expect(requests).toHaveLength(9);
  expect(requests.every(request => request.body.providerOptions.gateway.zeroDataRetention === false)).toBe(true);
  const byCheck = (check: string) => result.find(item => item.check === check)!;
  const jev = requests.find(request => request.body.questions?.operation && !request.url.endsWith('/v1/evaluate'))!;
  const httpJev = requests.find(request => request.url.endsWith('/v1/evaluate'))!;
  const fx = requests.find(request => request.headers.get('http-referer') === 'https://github.com/vercel-labs/fx')!;
  const plain = requests.find(request => !request.body.responseFormat && request !== fx && request !== jev && request !== httpJev)!;
  const schema = requests.find(request => request.body.responseFormat?.schema?.properties?.ok)!;
  const verifier = requests.find(request => request.body.responseFormat?.schema?.properties?.satisfied)!;
  const generation = requests.find(request => request.body.responseFormat?.schema?.properties?.text)!;
  const date = requests.find(request => request.body.responseFormat?.schema?.properties?.date)!;
  const review = requests.find(request => request.body.responseFormat?.schema?.properties?.approved)!;
  expect(fx.headers.has('ai-gateway-auth-method')).toBe(false);
  expect(plain.headers.get('ai-gateway-auth-method')).toBe('api-key');
  expect(schema.body.responseFormat.type).toBe('json');
  expect(schema.body.reasoning).toBeUndefined();
  expect(verifier.body.reasoning).toBe('none');
  expect([generation, date, review].every(request => request.body.reasoning === 'none')).toBe(true);
  expect(byCheck('sdk_jev').model).toBe('typesafe-ai/jev');
  expect(byCheck('http_jev').model).toBe('typesafe-ai/jev');
  expect(jev.body.questions.operation.type).toBe('choice');
  expect(httpJev.body).toEqual({ model: 'typesafe-ai/jev', state: jev.body.state, questions: jev.body.questions, providerOptions: jev.body.providerOptions });
  expect(httpJev.headers.get('authorization')).toBe('Bearer private-test-key');
  expect(jev.body.maxRetries).toBeUndefined();
  expect(result.every(item => item.status === 'failed')).toBe(true);
  expect(JSON.stringify(result)).toContain('test-request');
  expect(JSON.stringify(result)).toContain('method_not_allowed');
  expect(JSON.stringify(result)).toContain('[redacted]');
  expect(JSON.stringify(result)).not.toContain('private-test-key');
});

test('model check bounds stalled transports even when fetch ignores cancellation', async () => {
  const result = await testModelConnection('test', async () => new Promise(() => {}), 5);
  expect(result).toHaveLength(9);
  expect(result.every(item => item.status === 'failed')).toBe(true);
});

test('native Jev HTTP check accepts valid choice and rejects wrong choice', async () => {
  for (const choice of ['DONE', 'BLOCKED']) {
    const results = await testModelConnection('test', async (url) => {
      if (String(url).endsWith('/v1/evaluate')) return Response.json({ model: 'typesafe-ai/jev', answers: { operation: { type: 'choice', choice } } });
      return new Response('Unavailable', { status: 503 });
    });
    expect(results.find(result => result.check === 'http_jev')?.status).toBe(choice === 'DONE' ? 'passed' : 'failed');
  }
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
  expect(results.filter(result => result.status === 'failed').map(result => result.check)).toEqual(['sdk_text_generation', 'sdk_jev', 'http_jev']);
  expect(results.find(result => result.check === 'sdk_text_generation')?.error).toMatchObject({
    message: 'Synthetic contract values did not match. Expected {"suitable":true,"text":"Ulka QA"}; received {"suitable":true,"text":"Wrong name"}',
  });
  expect(results.find(result => result.check === 'sdk_text_date')?.status).toBe('passed');
});
