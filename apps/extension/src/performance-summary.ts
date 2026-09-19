import type { LogEntry } from './diagnostics';

// Numeric, allowlisted metrics only: never expose prompts, page data or provider errors.
export function performanceSummary(events: LogEntry[]) {
  const runs = new Map<string, LogEntry[]>();
  for (const entry of events) {
    if (!entry || typeof entry.runId !== 'string') continue;
    const run = runs.get(entry.runId) ?? [];
    run.push(entry); runs.set(entry.runId, run);
  }
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  return [...runs.values()].filter(run => run.some(e => e.event === 'fx_start')).slice(-3).map(run => {
    const start = run.find(e => e.event === 'request');
    const terminal = [...run].reverse().find(e => e.event === 'result' || e.event === 'error');
    const data = (entry: LogEntry) => (entry.data ?? {}) as Record<string, any>;
    const stages = run.flatMap<Record<string, string | number | boolean | undefined>>(entry => {
      const d = data(entry);
      if (entry.event === 'fx_turn_end') return [{ stage: 'planner turn', ms: number(d.elapsedMs), toolsMs: number(d.toolsMs), outsideToolsMs: number(d.outsideToolsMs), reasoningChars: number(d.reasoningChars) }];
      if (entry.event === 'fx_tool_end') return [{ stage: ['observe_browser', 'read_page', 'browser_subgoal', 'navigate_browser', 'native_tabs', 'ask_user', 'webmcp_call', 'list_downloads'].includes(d.name) ? d.name : 'tool', ms: number(d.elapsedMs), previewBytes: number(d.plannerResultBytes) }];
      if (entry.event === 'verification_start') return [{ stage: 'verification input', inputChars: number(d.inputChars), rawInputChars: number(d.rawInputChars), evidenceCount: number(d.evidenceCount) }];
      if (entry.event === 'fx_final_verification') return [{ stage: 'final verification', ms: number(d.elapsedMs), satisfied: d.satisfied === true }];
      if (entry.event === 'text_model_end' || entry.event === 'text_model_error') return [{ stage: entry.event, ms: number(d.elapsedMs) }];
      if (entry.event === 'decision') return [{ stage: 'Jev decision', ms: number(d.detail?.latencyMs) }];
      return [];
    });
    return { startedAt: start?.at, completeEnvelope: !!start && !!terminal,
      totalMs: start && terminal ? number(terminal.elapsedMs - start.elapsedMs) : undefined,
      status: terminal?.event === 'error' ? 'error' : terminal && ['done', 'idle', 'blocked', 'stopped'].includes(data(terminal).status) ? data(terminal).status : 'incomplete',
      stages };
  });
}
