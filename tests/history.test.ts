import { expect, test } from "bun:test";
import { hasIneffectiveRepetition, hasActionCycle, progressState } from "../apps/extension/src/agent/history";

const action = (changed: boolean) => ({ step: 1, operation: "CLICK" as const, url: "x", executedAt: 1, pageChanged: changed });
test("detects three ineffective non-wait actions", () => {
  expect(hasIneffectiveRepetition([action(false), action(false), action(false)])).toBe(true);
  expect(hasIneffectiveRepetition([action(false), action(true), action(false)])).toBe(false);
});
test('detects semantic pairs even when every action changes page', () => {
  const history = ['Open menu','Close menu','Open menu','Close menu','Open menu','Close menu'].map(targetLabel => ({ ...action(true), targetLabel }));
  expect(hasActionCycle(history)).toBe(true);
  history[5].targetLabel = 'Save';
  expect(hasActionCycle(history)).toBe(false);
});


test('progress ignores layout, diagnostics and node identity but preserves control state', () => {
  const page = { snapshotId: 's', fingerprint: 'f', createdAt: 0, pageIdentity: 'p', url: 'https://example.test', title: '', text: 'Search',
    scroll: { y: 0, height: 100, viewportHeight: 100 },
    elements: [{ id: 'e1', nodeId: 1, role: 'button', label: '', expanded: false, operations: ['CLICK' as const] }],
    guards: { e1: { nodeId: 1, role: 'button', label: '', enabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } } } };
  const changed = { ...page, pageIdentity: 'reload', fingerprint: 'noise', diagnostics: { candidates: 99, modalScoped: false, iframeCount: 4, rejected: {} },
    elements: [{ ...page.elements[0], id: 'e9', nodeId: 99 }],
    guards: { e9: { ...page.guards.e1, nodeId: 99, rect: { x: 12, y: 24, width: 50, height: 20 } } } };
  expect(progressState(changed)).toBe(progressState(page));
  changed.elements[0].expanded = true;
  expect(progressState(changed)).not.toBe(progressState(page));
});
