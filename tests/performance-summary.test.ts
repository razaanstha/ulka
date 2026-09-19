import { expect, test } from 'bun:test';
import { performanceSummary } from '../apps/extension/src/performance-summary';
import type { LogEntry } from '../apps/extension/src/diagnostics';

const entry = (event: string, elapsedMs: number, data: unknown = {}, runId = 'run'): LogEntry => ({ event, elapsedMs, data, runId, at: '2026-09-19T08:00:00Z' });
test('performance view separates overlapping timings and excludes private payloads', () => {
  const summary = performanceSummary([
    entry('request', 0, { kind: 'CHAT', content: 'secret prompt' }), entry('fx_start', 1),
    entry('fx_tool_end', 400, { name: 'read_page', elapsedMs: 100, plannerResultBytes: 2500, text: 'secret page' }),
    entry('fx_turn_end', 900, { elapsedMs: 850, toolsMs: 100, outsideToolsMs: 750, reasoningChars: 8000, reply: 'secret answer' }),
    entry('verification_start', 910, { inputChars: 12000, rawInputChars: 80000, evidenceCount: 3 }),
    entry('fx_final_verification', 1100, { elapsedMs: 200, satisfied: true, evidence: 'secret evidence' }),
    entry('result', 1150, { status: 'done', reply: 'secret answer' }),
    entry('request', 0, { kind: 'TEST_MODEL' }, 'diagnostics'),
  ]);
  expect(summary).toHaveLength(1);
  expect(summary[0]).toMatchObject({ totalMs: 1150, status: 'done', completeEnvelope: true });
  expect(summary[0]!.stages).toContainEqual({ stage: 'planner turn', ms: 850, toolsMs: 100, outsideToolsMs: 750, reasoningChars: 8000 });
  expect(JSON.stringify(summary)).not.toContain('secret');
});
test('partial diagnostic buffers never invent end-to-end timings', () => {
  const summary = performanceSummary([entry('fx_start', 10), entry('result', 100, { status: 'blocked' })]);
  expect(summary[0]).toMatchObject({ completeEnvelope: false, status: 'blocked' });
  expect(summary[0]!.totalMs).toBeUndefined();
});
