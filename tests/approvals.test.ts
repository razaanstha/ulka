import { expect, test } from "bun:test";
import { classifyAction } from "../apps/extension/src/agent/approvals";
import type { PageSnapshot } from "../packages/protocol/src";

const page = (role: string, label: string): PageSnapshot => ({ snapshotId: "s", fingerprint: "f", pageIdentity: "p", url: "https://x.test", title: "", text: "",
  scroll: { y: 0, height: 1, viewportHeight: 1 }, elements: [{ id: "e1", nodeId: 1, role, label, operations: ["TYPE_TEXT", "PRESS_ENTER"] }],
  guards: {}, createdAt: 1 });

test("approval policy prevents Enter and sensitive-field bypasses", () => {
  expect(classifyAction(page("searchbox", "Search"), { operation: "PRESS_ENTER", target: "e1", confidence: 1 })).toBe("safe");
  expect(classifyAction(page("textbox", "Message"), { operation: "PRESS_ENTER", target: "e1", confidence: 1 })).toBe("confirm");
  expect(classifyAction(page("textbox", "Card number"), { operation: "TYPE_TEXT", target: "e1", confidence: 1 })).toBe("confirm");
});
