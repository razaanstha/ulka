export type UsageReporter = (stage: string, usage: unknown) => void;

// Unknown usage remains explicitly unknown, never counted as zero-cost work.
export class ModelUsageLedger {
  private stages = new Map<string, { reports: number; inputTokens: number; outputTokens: number; missingUsageReports: number }>();
  record(stage: string, usage: unknown) {
    const value = usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
    const count = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    const input = value?.inputTokens, output = value?.outputTokens;
    const row = this.stages.get(stage) ?? { reports: 0, inputTokens: 0, outputTokens: 0, missingUsageReports: 0 };
    row.reports++;
    if (count(input)) row.inputTokens += input;
    if (count(output)) row.outputTokens += output;
    if (!count(input) || !count(output)) row.missingUsageReports++;
    this.stages.set(stage, row);
  }
  summary() {
    const stages = Object.fromEntries([...this.stages].map(([stage, row]) => [stage, { ...row }]));
    const rows = Object.values(stages);
    return { stages, inputTokens: rows.reduce((n, row) => n + row.inputTokens, 0), outputTokens: rows.reduce((n, row) => n + row.outputTokens, 0), missingUsageReports: rows.reduce((n, row) => n + row.missingUsageReports, 0), coverage: 'Reported usage only; failed requests and provider-internal retries may be absent.' };
  }
}
