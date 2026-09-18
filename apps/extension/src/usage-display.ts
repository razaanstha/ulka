import type { UsageSummary } from './agent/model-usage';

export function renderUsage(element: HTMLElement, usage?: UsageSummary, running = false, incomplete = false) {
  element.className = 'usage-summary';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = !usage?.reports;
  if (!usage?.reports) {
    element.textContent = '';
  } else {
    const tokens = `${(usage.inputTokens + usage.outputTokens).toLocaleString('en-US')} tokens`;
    const breakdown = `${usage.inputTokens.toLocaleString('en-US')} in / ${usage.outputTokens.toLocaleString('en-US')} out`;
    const partial = incomplete || usage.missingUsageReports > 0 || usage.unpricedReports > 0;
    const cost = usage.estimatedCostUsd === null ? 'Cost unavailable' : usage.estimatedCostUsd > 0 && usage.estimatedCostUsd < 0.0001 ? 'Est. <$0.0001' : `Est. $${usage.estimatedCostUsd.toFixed(4)}`;
    element.textContent = `${tokens} · ${breakdown} · ${cost}${partial ? ' · Partial' : ''}${running ? ' · Updating' : ''}`;
  }
  element.title = 'Updates when model usage is reported; FX planner totals arrive at turn end. ' +
    (usage ? `${usage.coverage} ${usage.costBasis}` : 'No usage report received yet.') +
    (incomplete ? ' This run ended early; some usage may be missing.' : '');
}
