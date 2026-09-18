import { createGateway, Output } from 'ai';
import { z } from 'zod';
import { sanitize } from '../diagnostics';
import { LANGUAGE_MODEL } from './models';
import { generateStructuredText } from './structured-generation';

type Transport = (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;
export interface ModelConnectionResult {
  check: string; model: string; status: 'passed' | 'failed'; elapsedMs: number;
  transport: Record<string, unknown>; error?: unknown;
}

// Synthetic requests only. Never attach a browser, read a page, or replay actions.
export async function testModelConnection(apiKey: string, transport: Transport = fetch, timeoutMs = 10_000): Promise<ModelConnectionResult[]> {
  const checks = ['fx_style_headers', 'sdk_plain', 'sdk_schema', 'sdk_verifier'] as const;
  return Promise.all(checks.map(async check => {
    const started = performance.now();
    const controller = new AbortController();
    let rejectTimeout!: (reason: unknown) => void;
    const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
    const timer = setTimeout(() => {
      const error = new Error('Model connection check timed out');
      controller.abort(error); rejectTimeout(error);
    }, timeoutMs);
    const details: Record<string, unknown> = {};
    const request: Transport = async (url, init) => {
      const headers = new Headers(init?.headers);
      if (check === 'fx_style_headers') {
        headers.delete('ai-gateway-auth-method'); headers.delete('user-agent');
        headers.set('http-referer', 'https://github.com/vercel-labs/fx');
        headers.set('x-title', 'fx');
      }
      Object.assign(details, { route: new URL(url instanceof Request ? url.url : String(url)).pathname, method: init?.method, streaming: headers.get('ai-language-model-streaming'),
        specification: headers.get('ai-language-model-specification-version'), authMethod: headers.get('ai-gateway-auth-method') });
      const response = await transport(url, { ...init, headers });
      Object.assign(details, { status: response.status, redirected: response.redirected,
        contentType: response.headers.get('content-type'), allow: response.headers.get('allow'),
        requestId: response.headers.get('x-vercel-id'), generationId: response.headers.get('x-generation-id') });
      if (!response.ok) {
        const reader = response.clone().body?.getReader();
        if (reader) {
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (length < 2_048) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = value.slice(0, 2_048 - length);
              chunks.push(chunk); length += chunk.length;
            }
          } finally { void reader.cancel().catch(() => {}); }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          details.responseBody = sanitize(new TextDecoder().decode(bytes), '', [apiKey]);
        }
      }
      return response;
    };
    const gateway = createGateway({ apiKey, fetch: Object.assign(request, { preconnect: fetch.preconnect }) });
    try {
      await Promise.race([generateStructuredText({
        model: gateway(LANGUAGE_MODEL), abortSignal: controller.signal, maxRetries: 0, maxOutputTokens: 1_200,
        prompt: 'Connection test only. Return {"ok":true}.',
        ...(check === 'sdk_schema' || check === 'sdk_verifier' ? { output: Output.object({ schema: z.object({ ok: z.literal(true) }) }) } : {}),
        ...(check === 'sdk_verifier' ? { reasoning: 'low' as const } : {}),
      }), timeout]);
      return { check, model: LANGUAGE_MODEL, status: 'passed', elapsedMs: performance.now() - started, transport: details };
    } catch (error) {
      // Only synthetic requests reach this path, so error messages cannot echo page data.
      return { check, model: LANGUAGE_MODEL, status: 'failed', elapsedMs: performance.now() - started,
        transport: details, error: sanitize(error instanceof Error ? { name: error.name, message: error.message } : 'Unknown error', '', [apiKey]) };
    } finally { clearTimeout(timer); }
  }));
}
