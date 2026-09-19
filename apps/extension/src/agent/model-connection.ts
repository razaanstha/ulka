import { textPlanSchema, textDateSchema, textReviewSchema } from './text-generator';
import { verificationSchema } from './outcome-verifier';
import { createGateway, Output } from 'ai';
import { z } from 'zod';
import { sanitize } from '../diagnostics';
import { LANGUAGE_MODEL, TEXT_MODEL } from './models';
import { generateStructuredText, structuredFailureDetails } from './structured-generation';

type Transport = (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;
export interface ModelConnectionResult {
  check: string; model: string; status: 'passed' | 'failed'; elapsedMs: number;
  transport: Record<string, unknown>; error?: unknown;
}

// Synthetic requests only. Never attach a browser, read a page, or replay actions.
export async function testModelConnection(apiKey: string, transport: Transport = fetch, timeoutMs = 10_000): Promise<ModelConnectionResult[]> {
  const checks = ['fx_style_headers', 'sdk_plain', 'sdk_schema', 'sdk_verifier', 'sdk_text_generation', 'sdk_text_date', 'sdk_text_review'] as const;
  return Promise.all(checks.map(async check => {
    const started = performance.now();
    const model = check.startsWith('sdk_text_') ? TEXT_MODEL : LANGUAGE_MODEL;
    const schema: z.ZodType = check === 'sdk_text_generation' ? textPlanSchema : check === 'sdk_text_date' ? textDateSchema
      : check === 'sdk_text_review' ? textReviewSchema : check === 'sdk_verifier' ? verificationSchema : z.object({ ok: z.literal(true) });
    const expected = check === 'sdk_text_generation' ? { suitable: true, reason: 'Synthetic name field', text: 'Ulka QA' }
      : check === 'sdk_text_date' ? { suitable: true, reason: 'Synthetic native date field', date: { year: 2026, month: 10, day: 5, format: 'iso' } }
      : check === 'sdk_text_review' ? { approved: true, reason: 'Synthetic field value matches request' }
      : check === 'sdk_verifier' ? { satisfied: true, evidence: 'Synthetic observed result matches goal' } : { ok: true };
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
      const result = await Promise.race([generateStructuredText({
        model: gateway(model), abortSignal: controller.signal, maxRetries: 0, maxOutputTokens: 1_200,
        prompt: `Synthetic contract check only. Return exactly this object: ${JSON.stringify(expected)}`,
        ...(check === 'sdk_schema' || check === 'sdk_verifier' || check.startsWith('sdk_text_') ? { output: Output.object({ schema }) } : {}),
        ...(check === 'sdk_verifier' || check.startsWith('sdk_text_') ? { reasoning: 'none' as const } : {}),
      }), timeout]);
      if (check === 'sdk_verifier' || check.startsWith('sdk_text_')) {
        const { reason: _reason, evidence: _evidence, ...wanted } = expected as Record<string, unknown>;
        const actual = result.output as Record<string, unknown>;
        if (!actual || Object.entries(wanted).some(([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value))) {
          // This check sends synthetic constants only. Surface the bounded mismatch
          // so provider mistakes can be distinguished from diagnostic bugs.
          const received = actual && Object.fromEntries(Object.keys(wanted).map(key => [key, actual[key]]));
          throw new Error(`Synthetic contract values did not match. Expected ${JSON.stringify(wanted)}; received ${JSON.stringify(received)?.slice(0, 1000)}`);
        }
      }
      return { check, model, status: 'passed', elapsedMs: performance.now() - started, transport: details };
    } catch (error) {
      // Only synthetic requests reach this path, so error messages cannot echo page data.
      return { check, model, status: 'failed', elapsedMs: performance.now() - started,
        transport: { ...details, ...structuredFailureDetails(error) }, error: sanitize(error instanceof Error ? { name: error.name, message: error.message } : 'Unknown error', '', [apiKey]) };
    } finally { clearTimeout(timer); }
  }));
}
