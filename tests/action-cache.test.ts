import { describe, expect, test } from "bun:test";
import { findCachedAction, rememberAction, type CachedAction } from "../apps/extension/src/agent/action-cache";
import type { ActionRecord, PageSnapshot } from "../packages/protocol/src";

function page(label = "Continue"): PageSnapshot {
  return {
    snapshotId: "s", fingerprint: "f", pageIdentity: "p", url: "https://example.test/checkout", title: "",
    text: "", scroll: { y: 0, height: 100, viewportHeight: 100 }, createdAt: 0,
    elements: [{ id: "e1", nodeId: 1, role: "button", label, operations: ["CLICK"] }],
    guards: { e1: { nodeId: 1, role: "button", label, enabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } } },
  };
}

describe("action cache", () => {
  test("replays semantic target with fresh browser-local ID", () => {
    const cache = new Map<string, CachedAction>();
    const before = page();
    rememberAction(cache, "Continue checkout", before, { operation: "CLICK", target: "e1", confidence: 1 }, { step: 1, operation: "CLICK", target: "e1", targetLabel: "Continue", url: before.url, pageChanged: true, executedAt: 1 });
    const after = { ...page(), elements: [{ ...page().elements[0], id: "e99", nodeId: 99 }], guards: { e99: { ...page().guards.e1, nodeId: 99 } } };
    expect(findCachedAction(cache, "Continue checkout", after)).toMatchObject({ operation: "CLICK", target: "e99", confidence: 1 });
  });

  test("does not cache text or unchanged actions", () => {
    const cache = new Map<string, CachedAction>();
    const current = page();
    const record: ActionRecord = { step: 1, operation: "CLICK", target: "e1", url: current.url, pageChanged: false, executedAt: 1 };
    rememberAction(cache, "Continue", current, { operation: "CLICK", target: "e1", confidence: 1 }, record);
    rememberAction(cache, "Continue", current, { operation: "TYPE_TEXT", target: "e1", confidence: 1 }, { ...record, operation: "TYPE_TEXT", pageChanged: true });
    expect(cache).toHaveLength(0);
  });

  test("does not replay when page state changed", () => {
    const cache = new Map<string, CachedAction>();
    const current = page();
    rememberAction(cache, "Continue", current, { operation: "CLICK", target: "e1", confidence: 1 }, { step: 1, operation: "CLICK", target: "e1", url: current.url, pageChanged: true, executedAt: 1 });
    const changed = { ...page("Continue now"), elements: [{ ...page("Continue now").elements[0], id: "e99", nodeId: 99 }], guards: { e99: { ...page("Continue now").guards.e1, nodeId: 99 } } };
    expect(findCachedAction(cache, "Continue", changed)).toBeUndefined();
  });
});
