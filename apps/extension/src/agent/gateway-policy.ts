import type { streamText } from 'ai';

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>;
type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Explicitly disabled by user request: the current Hobby plan cannot use ZDR.
export function withGatewayPolicy(options: ProviderOptions = {}): ProviderOptions {
  return { ...options, gateway: { ...options.gateway, zeroDataRetention: false } };
}

// libfx 0.0.10 exposes fetch, but no provider-options setting. Apply the same
// policy only to its canonical Gateway language requests, never WASM/assets.
export function createFxGatewayFetch(transport: Transport = globalThis.fetch.bind(globalThis)): Transport {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.origin !== 'https://ai-gateway.vercel.sh' || !/^\/v[34]\/ai\/language-model$/.test(url.pathname) || method.toUpperCase() !== 'POST') {
      return transport(input, init);
    }
    const request = new Request(input, init);
    const body = await request.json();
    const object = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(body) || (body.providerOptions !== undefined && !object(body.providerOptions)) ||
      (body.providerOptions?.gateway !== undefined && !object(body.providerOptions.gateway))) {
      throw new Error('Invalid FX Gateway request options; request was not sent.');
    }
    body.providerOptions = withGatewayPolicy(body.providerOptions);
    // libfx does not expose the Gateway reasoning setting. Without it, the
    // planner can spend tens of seconds repeating the same uncertainty before
    // taking a read-only step. Tool execution and independent verification stay.
    body.reasoning = 'none';
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    return transport(new Request(request, { headers, body: JSON.stringify(body) }));
  };
}
