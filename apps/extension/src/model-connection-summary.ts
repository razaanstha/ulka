export interface ConnectionCheckSummary {
  check: string;
  status: string;
  transport: { status?: number; responseBody?: unknown };
  error?: unknown;
}

// Inputs come from the synthetic diagnostic, already sanitized in background.
// Render this as textContent, never HTML or a model instruction.
export function formatConnectionChecks(results: ConnectionCheckSummary[]): string {
  const summary = results.map(result => `${result.check}: ${result.status}${result.transport.status ? ` (HTTP ${result.transport.status})` : ''}`).join('; ');
  const failure = results.find(result => result.status === 'failed');
  let detail: unknown = failure?.transport.responseBody;
  if (typeof detail === 'string') {
    try { const parsed = JSON.parse(detail); detail = parsed?.error?.message ?? parsed?.message ?? detail; } catch { /* Keep bounded plain-text responses. */ }
  }
  if (typeof detail !== 'string' && failure?.error && typeof failure.error === 'object' && 'message' in failure.error) detail = failure.error.message;
  return summary + '.' + (typeof detail === 'string' ? ` First failure (${failure!.check}): ${detail.slice(0, 2000)}` : '') + ' Copy logs for details.';
}
