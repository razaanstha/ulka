import { expect, test } from 'bun:test';
import { createFxGatewayFetch } from '../apps/extension/src/agent/gateway-policy';

test('FX Gateway byte requests disable ZDR and preserve options, credentials and cancellation', async () => {
  const controller = new AbortController();
  let sent!: Request;
  const transport = createFxGatewayFetch(async input => { sent = input as Request; return new Response('ok'); });
  const body = { prompt: [{ role: 'user', content: 'Synthetic' }], providerOptions: {
    gateway: { zeroDataRetention: true, order: ['test-provider'] }, other: { mode: 'kept' },
  } };
  await transport('https://ai-gateway.vercel.sh/v4/ai/language-model', {
    method: 'POST', body: new TextEncoder().encode(JSON.stringify(body)),
    headers: { authorization: 'Bearer synthetic', 'ai-language-model-streaming': 'true' }, signal: controller.signal,
  });
  expect(await sent.json()).toEqual({ ...body, reasoning: 'none', providerOptions: {
    gateway: { zeroDataRetention: false, order: ['test-provider'] }, other: { mode: 'kept' },
  } });
  expect(sent.headers.get('authorization')).toBe('Bearer synthetic');
  expect(sent.headers.get('ai-language-model-streaming')).toBe('true');
  controller.abort();
  expect(sent.signal.aborted).toBe(true);
});

test('FX v3 Request inputs also disable ZDR', async () => {
  const transport = createFxGatewayFetch(async input => {
    expect(await (input as Request).json()).toMatchObject({ reasoning: 'none', providerOptions: { gateway: { zeroDataRetention: false } } });
    return new Response('ok');
  });
  await transport(new Request('https://ai-gateway.vercel.sh/v3/ai/language-model', { method: 'POST', body: '{}' }));
});

test('FX leaves assets, metadata and non-Gateway requests untouched', async () => {
  for (const url of ['https://extension.test/fx-core.wasm', 'https://ai-gateway.vercel.sh/v1/models', 'https://other.test/v4/ai/language-model']) {
    const init = { method: 'GET' };
    await createFxGatewayFetch(async (input, received) => {
      expect(input).toBe(url); expect(received).toBe(init); return new Response('ok');
    })(url, init);
  }
});

test('malformed FX Gateway bodies fail before transmission', async () => {
  let requests = 0;
  const transport = createFxGatewayFetch(async () => { requests++; return new Response('unexpected'); });
  for (const body of ['not json', 'null', '{"providerOptions":[]}', '{"providerOptions":{"gateway":false}}']) {
    await expect(transport('https://ai-gateway.vercel.sh/v4/ai/language-model', { method: 'POST', body })).rejects.toThrow();
  }
  expect(requests).toBe(0);
});
