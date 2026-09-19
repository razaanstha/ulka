import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { ModelUsageLedger } from '../apps/extension/src/agent/model-usage';
import { parseModelPrices } from '../apps/extension/src/agent/model-pricing';
import { LANGUAGE_MODEL } from '../apps/extension/src/agent/models';
import { renderUsage } from '../apps/extension/src/usage-display';

test('catalog rates use USD per token and retain free output pricing', () => {
  const prices = parseModelPrices({ data: [
    { id: LANGUAGE_MODEL, pricing: { input: '0.000002', output: '0.000006' } },
    { id: 'typesafe-ai/jev', pricing: { input: '0.00000004', output: '0' } },
    { id: 'invalid', pricing: { input: '', output: null } },
    { id: 'negative', pricing: { input: -1, output: 1 } },
  ] });
  expect(prices.invalid).toBeUndefined(); expect(prices.negative).toBeUndefined();
  const ledger = new ModelUsageLedger();
  ledger.record('fx_turn', { inputTokens: 1000, outputTokens: 100 });
  ledger.record('jev_operation', { inputTokens: 500, outputTokens: 0 });
  expect(ledger.summary().estimatedCostUsd).toBeNull();
  ledger.setPrices(prices);
  expect(ledger.summary().estimatedCostUsd).toBeCloseTo(0.00262, 8);
  expect(ledger.summary().unpricedReports).toBe(0);
  expect(ledger.summary().reports).toBe(2);
});

test('missing pricing and usage remain partial; previous snapshots stay immutable', () => {
  const ledger = new ModelUsageLedger();
  ledger.setPrices({ [LANGUAGE_MODEL]: { input: 0.001, output: 0.002 } });
  ledger.record('fx_turn', { inputTokens: 10, outputTokens: 2 });
  const previous = ledger.summary();
  ledger.record('jev_operation', undefined);
  const summary = ledger.summary();
  expect(previous.reports).toBe(1);
  expect(summary).toMatchObject({ reports: 2, missingUsageReports: 1, unpricedReports: 1 });
  expect(summary.estimatedCostUsd).toBeCloseTo(0.014);
  const element = new Window().document.createElement('div') as unknown as HTMLElement;
  renderUsage(element, summary, true);
  expect(element.textContent).toContain('12 tokens');
  expect(element.textContent).toContain('Partial');
  expect(element.textContent).toContain('Updating');
  renderUsage(element, JSON.parse(JSON.stringify(summary)), false, false, 62000);
  expect(element.textContent).not.toContain('Updating');
  expect(element.textContent).toContain('Est. $0.0140 · 1m 02s');
});

test('pending usage stays hidden until reported data exists', () => {
  const element = new Window().document.createElement('div') as unknown as HTMLElement;
  renderUsage(element, undefined, true);
  expect(element.hidden).toBe(true);
  expect(element.textContent).toBe('');
  renderUsage(element);
  expect(element.hidden).toBe(true);
  const missing = new ModelUsageLedger();
  missing.setPrices({ [LANGUAGE_MODEL]: { input: 0.001, output: 0.002 } });
  missing.record('fx_turn', undefined);
  expect(missing.summary().estimatedCostUsd).toBeNull();
  const ledger = new ModelUsageLedger();
  ledger.record('fx_turn', { inputTokens: 100, outputTokens: 20 });
  renderUsage(element, ledger.summary(), false, true);
  expect(element.hidden).toBe(false);
  expect(element.textContent).toContain('Cost unavailable');
  expect(element.textContent).toContain('Partial');
  expect(element.title).toContain('ended early');
});
