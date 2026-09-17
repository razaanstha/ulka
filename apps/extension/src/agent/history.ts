import type { ActionRecord, PageSnapshot, AgentDecision } from "../../../../packages/protocol/src/index";

export function hasIneffectiveRepetition(history: ActionRecord[]): boolean {
  const recent = history.filter((action) => action.operation !== "WAIT").slice(-3);
  return recent.length === 3 && recent.every((action) => action.pageChanged === false);
}

export function hasActionCycle(history: ActionRecord[]): boolean {
  const recent = history.slice(-6);
  if (recent.length !== 6 || recent.some(action => !action.targetLabel || !['CLICK','RIGHT_CLICK','HOVER','SWITCH_TAB'].includes(action.operation))) return false;
  const key = (action: ActionRecord) => JSON.stringify([action.url, action.operation, action.targetLabel]);
  return recent.every((action, index) => index < 2 || key(action) === key(recent[index % 2]));
}

// Keep freshness checks strict; progress ignores transient node IDs, geometry and diagnostics.
export function progressState(page: PageSnapshot): string {
  return JSON.stringify({
    url: page.url, title: page.title, text: page.text,
    scroll: { y: page.scroll.y, targetY: page.scrollTarget?.y },
    elements: page.elements.map(element => ({
      role: element.role, label: element.label, value: element.value,
      checked: element.checked, selected: element.selected, expanded: element.expanded,
      operations: element.operations, options: element.options,
      enabled: page.guards[element.id]?.enabled,
    })),
  });
}

export function progressActionKey(page: PageSnapshot, decision: Pick<AgentDecision, 'operation' | 'target' | 'option'>): string | undefined {
  if (!['CLICK', 'RIGHT_CLICK', 'HOVER', 'PRESS_ENTER', 'SELECT', 'TYPE_TEXT'].includes(decision.operation)) return undefined;
  const index = page.elements.findIndex(element => element.id === decision.target?.split(':')[0]);
  if (index < 0) return undefined;
  const target = page.elements[index];
  // Match the control, not its page-wide position or unrelated live content.
  // Duplicate accessible names retain a local ordinal; unique names survive rerenders/reloads.
  const ordinal = page.elements.slice(0, index).filter(element => element.role === target.role && element.label === target.label).length;
  const state = { value: target.value, checked: target.checked, selected: target.selected, expanded: target.expanded };
  return 'progress:' + JSON.stringify([page.url, target.role, target.label, ordinal, state, decision.operation, decision.option]);
}
