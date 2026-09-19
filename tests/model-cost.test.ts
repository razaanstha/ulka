import { expect, test } from 'bun:test';
import { ModelUsageLedger } from '../apps/extension/src/agent/model-usage';
import { modelElement, modelHistory } from '../apps/extension/src/agent/model-context';

test('model context preserves widget meaning while dropping execution metadata', () => {
  const field = { id: 'e1', nodeId: 99, role: 'combobox', label: 'Destination', value: 'Paris', expanded: true, optionIds: ['e2'], activeOptionId: 'e2', operations: ['CLICK' as const] };
  const { nodeId, ...meaning } = field;
  expect(modelElement(field)).toEqual(meaning);
  expect(JSON.stringify(modelElement(field))).not.toContain('nodeId');
  const recent = modelHistory([{ step: 1, operation: 'CLICK', target: 'e2', targetLabel: 'Paris', url: 'https://example.test', fingerprint: 'opaque', executedAt: 123, confidence: 0.9, pageChanged: true }]);
  expect(recent).toEqual([{ operation: 'CLICK', targetLabel: 'Paris', url: 'https://example.test', pageChanged: true }]);
});

test('usage ledger aggregates stages and flags missing usage without inventing totals', () => {
  const ledger = new ModelUsageLedger();
  ledger.record('fx_turn', { inputTokens: 100, outputTokens: 10 });
  ledger.record('fx_turn', { inputTokens: 200, outputTokens: 20 });
  ledger.record('verification', { inputTokens: 40, outputTokens: 4 });
  ledger.record('jev_target', undefined);
  ledger.record('jev_operation', { inputTokens: 5 });
  expect(ledger.summary()).toMatchObject({ inputTokens: 345, outputTokens: 34, missingUsageReports: 2,
    stages: { fx_turn: { reports: 2, inputTokens: 300, outputTokens: 30, missingUsageReports: 0 } } });
});

test('field generation and review use the configured model prices', () => {
  const ledger = new ModelUsageLedger();
  ledger.setPrices({ 'inception/mercury-2.5': { input: 0.001, output: 0.002 }, 'deepseek/deepseek-v4.1-flash': { input: 1, output: 2 } });
  ledger.record('text_generation', { inputTokens: 10, outputTokens: 5 });
  ledger.record('text_content_review', { inputTokens: 10, outputTokens: 5 });
  expect(ledger.summary().estimatedCostUsd).toBeCloseTo(40);
});
