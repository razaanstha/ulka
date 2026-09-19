import { streamText, NoObjectGeneratedError } from 'ai';
import { withGatewayPolicy } from './gateway-policy';

export type StructuredRequest = Parameters<typeof streamText>[0];
export type StructuredGenerator = (input: StructuredRequest) => Promise<{
  output: unknown; usage?: unknown; totalUsage?: unknown;
}>;

// Use the same Gateway streaming transport as FX. Consume the entire response
// before exposing schema-validated output; partial JSON must never drive actions.
export const generateStructuredText: StructuredGenerator = async input => {
  input.abortSignal?.throwIfAborted();
  const format = await input.output?.responseFormat;
  if (format?.type === 'json' && format.schema) {
    // Some routes accept schema metadata without enforcing every required field.
    // State the identical contract in-band; strict SDK validation still decides.
    const contract = `Return only a JSON object matching this JSON Schema. Include every required field with its exact type. No Markdown fences, commentary, or schema wrapper. Use false/null only where the schema permits and the evidence warrants it. JSON Schema: ${JSON.stringify(format.schema)}`;
    const system = input.system;
    input = { ...input, system: typeof system === 'string' || system === undefined
      ? [system, contract].filter(Boolean).join('\n\n')
      : [...(Array.isArray(system) ? system : [system]), { role: 'system' as const, content: contract }] };
  }
  input.abortSignal?.throwIfAborted();
  let streamError: unknown;
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!input.abortSignal) return;
    onAbort = () => reject(input.abortSignal!.reason);
    input.abortSignal.addEventListener('abort', onAbort, { once: true });
    if (input.abortSignal.aborted) onAbort();
  });
  try {
    const result = streamText({ ...input, providerOptions: withGatewayPolicy(input.providerOptions), onError: ({ error }) => { streamError = error; } });
    // A transport can ignore abort. Release the caller independently, while
    // observing the pending promises so late failures cannot go unhandled.
    const [output, totalUsage] = await Promise.race([Promise.all([result.output, result.totalUsage]), cancelled]);
    input.abortSignal?.throwIfAborted();
    if (streamError !== undefined) throw streamError;
    return { output, totalUsage };
  } catch (error) {
    input.abortSignal?.throwIfAborted();
    // The SDK otherwise replaces transport errors with NoOutputGeneratedError.
    throw streamError ?? error;
  } finally {
    if (onAbort) input.abortSignal?.removeEventListener('abort', onAbort);
  }
};

// Never log raw output, validation messages, unknown property names, or values.
export function structuredFailureDetails(error: unknown): Record<string, unknown> {
  if (!NoObjectGeneratedError.isInstance(error)) return {};
  const allowed = new Set(['suitable', 'reason', 'text', 'date', 'year', 'month', 'day', 'format', 'approved', 'satisfied', 'evidence']);
  const kind = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const details: Record<string, unknown> = { generatedChars: error.text?.length ?? 0, finishReason: error.finishReason };
  try {
    const value = JSON.parse(error.text ?? '');
    details.jsonType = kind(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      details.fieldTypes = Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)).map(([key, value]) => [key, kind(value)]));
      details.unknownFieldCount = Object.keys(value).filter(key => !allowed.has(key)).length;
    }
  } catch { details.jsonType = 'unparseable'; }
  const issues: Array<{ code: string; path: string[] }> = [];
  let cause: any = error.cause;
  const codes = new Set(['invalid_type', 'too_big', 'too_small', 'invalid_format', 'invalid_value', 'unrecognized_keys', 'invalid_union', 'custom']);
  for (let depth = 0; depth < 4 && cause; depth++, cause = cause.cause) {
    if (!Array.isArray(cause.issues)) continue;
    for (const issue of cause.issues.slice(0, 12)) issues.push({
      code: codes.has(issue.code) ? issue.code : 'other',
      path: Array.isArray(issue.path) ? issue.path.slice(0, 4).map((part: unknown) => typeof part === 'string' && allowed.has(part) ? part : '[other]') : [],
    });
  }
  details.schemaIssues = issues;
  return details;
}
