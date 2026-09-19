/** Summarize exported metrics without printing page content, prompts, or answers. */
const filename = process.argv[2];
if (!filename) throw new Error('Usage: bun scripts/eval/analyze-diagnostics.ts <export.json>');
const report = await Bun.file(filename).json();
if (report.format !== 'ulka-diagnostics-v1' || !Array.isArray(report.events)) throw new Error('Unsupported diagnostics export');
type Metric = { count: number; totalMs: number; minMs: number; maxMs: number };
type Run = { first: string; last: string; requestSeen: boolean; requestAt?: string; terminalAt?: string; terminalStatus?: string; stopReasons: string[]; httpFailures: number[]; metrics: Record<string, Metric>; textFailures: number; textSuccesses: number; textModels: string[] };
const runs = new Map<string, Run>();
function record(metrics: Record<string, Metric>, stage: string, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
  const previous = metrics[stage] ?? { count: 0, totalMs: 0, minMs: value, maxMs: value };
  previous.count++; previous.totalMs += value;
  previous.minMs = Math.min(previous.minMs, value); previous.maxMs = Math.max(previous.maxMs, value);
  metrics[stage] = previous;
}
for (const event of report.events) {
  const id = typeof event.runId === 'string' ? event.runId : 'unknown';
  const run: Run = runs.get(id) ?? { first: event.at, last: event.at, requestSeen: false, metrics: {}, textFailures: 0, textSuccesses: 0, textModels: [], stopReasons: [], httpFailures: [] };
  run.last = event.at;
  const data = event.data ?? {};
  if (event.event === 'request') { run.requestSeen = true; run.requestAt = event.at; }
  if (event.event === 'result' && ['done', 'idle', 'blocked', 'stopped'].includes(data.status)) { run.terminalStatus = data.status; run.terminalAt = event.at; }
  if (event.event === 'fx_runtime' && data.type === 'transport.response' && Number.isInteger(data.status) && data.status >= 400 && data.status <= 599) run.httpFailures.push(data.status);
  if (event.event === 'text_model_start' && ['inception/mercury-2.5', 'deepseek/deepseek-v4.1-flash'].includes(data.model) && !run.textModels.includes(data.model)) run.textModels.push(data.model);
  if (event.event === 'text_model_error' || event.event === 'text_model_end') {
    if (event.event === 'text_model_error') run.textFailures++; else run.textSuccesses++;
    record(run.metrics, event.event, data.elapsedMs);
  }
  if (event.event === 'decision') record(run.metrics, 'jev_decision', data.detail?.latencyMs);
  if (event.event === 'verification_error') record(run.metrics, 'verification_error_elapsed', data.elapsedMs);
  if (event.event === 'verification_end') record(run.metrics, 'verification_completed_elapsed', data.elapsedMs);
  if (event.event === 'fx_turn_end') {
    if (['end_turn', 'refused', 'cancelled', 'error', 'max_tokens'].includes(data.stopReason)) run.stopReasons.push(data.stopReason);
    record(run.metrics, 'fx_turn', data.elapsedMs);
    record(run.metrics, 'fx_tools', data.toolsMs);
    record(run.metrics, 'fx_outside_tools', data.outsideToolsMs);
  }
  runs.set(id, run);
}
console.log(JSON.stringify({
  scope: 'Exported diagnostics only. Event buffers may omit starts or terminal outcomes. Timings overlap: tool, text, decision and verification durations must not be summed together. Verification durations are cumulative from check start, including retries. Outside-tool time includes model work and is not isolated FX runtime overhead.',
  runs: [...runs].map(([runId, run]) => ({ runId, ...run, completeEnvelope: run.requestSeen && !!run.terminalStatus,
    requestToTerminalMs: run.requestAt && run.terminalAt ? Date.parse(run.terminalAt) - Date.parse(run.requestAt) : undefined,
    predatesExportBuild: typeof report.build?.builtAt === 'string' ? Date.parse(run.first) < Date.parse(report.build.builtAt) : undefined,
    // Export build identifies the exporter; it cannot identify an older run's build.
    statusConflict: run.stopReasons.includes('refused') && ['done', 'idle'].includes(run.terminalStatus ?? ''),
  })),
}, null, 2));
