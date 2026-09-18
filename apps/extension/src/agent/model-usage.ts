import { LANGUAGE_MODEL } from './models';
import type { ModelPrices } from './model-pricing';

export type UsageReporter = (stage: string, usage: unknown) => void;
export type UsageSummary = ReturnType<ModelUsageLedger['summary']>;

// Unknown usage remains explicitly unknown, never counted as zero-cost work.
export class ModelUsageLedger {
  private prices: ModelPrices = {};
  setPrices(prices: ModelPrices) { this.prices = prices; }
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
    let estimatedCostUsd = 0, pricedReports = 0, unpricedReports = 0;
    for (const [stage, row] of Object.entries(stages)) {
      const price = this.prices[stage.startsWith('jev_') ? 'typesafe-ai/jev' : LANGUAGE_MODEL];
      if (!price) { unpricedReports += row.reports; continue; }
      // A missing report is not a measured zero-token request.
      if (row.missingUsageReports < row.reports || row.inputTokens > 0 || row.outputTokens > 0) pricedReports += row.reports;
      estimatedCostUsd += row.inputTokens * price.input + row.outputTokens * price.output;
    }
    return { stages, reports: rows.reduce((n, row) => n + row.reports, 0), inputTokens: rows.reduce((n, row) => n + row.inputTokens, 0), outputTokens: rows.reduce((n, row) => n + row.outputTokens, 0), missingUsageReports: rows.reduce((n, row) => n + row.missingUsageReports, 0),
      estimatedCostUsd: pricedReports ? estimatedCostUsd : null, unpricedReports,
      coverage: 'Reported usage only; failed requests and provider-internal retries may be absent.',
      costBasis: 'Estimated USD at catalog input/output rates. Cache discounts, provider routing, and extra fees may differ from your bill.' };
  }
}
