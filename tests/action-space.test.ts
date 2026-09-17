import { describe, expect, test } from "bun:test";
import { buildActionSpace } from "../apps/extension/src/agent/action-space";
import type { PageSnapshot } from "../packages/protocol/src";

const snapshot: PageSnapshot = {
  snapshotId: "s", fingerprint: "f", pageIdentity: "p", url: "https://example.test", title: "Example", text: "",
  scroll: { y: 0, height: 800, viewportHeight: 800 }, createdAt: 1,
  elements: [
    { id: "e1", nodeId: 1, role: "button", label: "About", operations: ["CLICK"] },
    { id: "e2", nodeId: 2, role: "textbox", label: "Search", operations: ["TYPE_TEXT"] },
  ],
  guards: { e1: { nodeId: 1, role: "button", label: "About", enabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } } },
};

describe("CLICK action space", () => {
  test("new interactions expose compatible targets only", () => {
    const space = buildActionSpace({ ...snapshot, elements: [
      { ...snapshot.elements[0], operations: ["HOVER", "SCROLL_ELEMENT_DOWN"] },
      { ...snapshot.elements[1], operations: ["ARROW_DOWN", "ARROW_UP"] },
    ] });
    expect(Object.keys(space.targets.HOVER!)).toEqual(["e1"]);
    expect(Object.keys(space.targets.ARROW_DOWN!)).toEqual(["e2"]);
    expect(Object.keys(space.targets.SCROLL_ELEMENT_DOWN!)).toEqual(["e1"]);
    expect(space.targets.SCROLL_ELEMENT_UP).toBeUndefined();
  });
  test("offers only compatible targets", () => {
    const space = buildActionSpace(snapshot);
    expect(Object.keys(space.targets.CLICK!)).toEqual(["e1"]);
    expect(space.operations).toMatchObject({ CLICK: expect.any(String), TYPE_TEXT: expect.any(String), WAIT: expect.any(String), GO_BACK: expect.any(String), RELOAD: expect.any(String), DONE: expect.any(String), BLOCKED: expect.any(String) });
  });

  test("emits JSON-compatible target criteria without undefined fields", () => {
    const target = buildActionSpace(snapshot).targets.CLICK!.e1;
    expect(Object.prototype.hasOwnProperty.call(target, "currentValue")).toBe(false);
  });

  test("constrains tab operations to local tab IDs", () => {
    const space = buildActionSpace({ ...snapshot, tabs: [
      { id: "t1", title: "Google", url: "https://google.com", active: true },
      { id: "t2", title: "Wikipedia", url: "https://wikipedia.org", active: false },
    ], tabRefs: { t1: 81, t2: 94 } });
    expect(Object.keys(space.targets.SWITCH_TAB!)).toEqual(["t1", "t2"]);
    expect(JSON.stringify(space)).not.toContain("81");
    expect(JSON.stringify(space)).not.toContain("94");
    expect(space.operations.OPEN_TAB).toBeDefined();
  });

  test("keeps downloads separate from ordinary click targets", () => {
    const space = buildActionSpace({ ...snapshot, elements: [
      { id: "e9", nodeId: 9, role: "link", label: "Export CSV", operations: ["DOWNLOAD"] },
    ] });
    expect(Object.keys(space.targets.DOWNLOAD!)).toEqual(["e9"]);
    expect(space.targets.CLICK).toBeUndefined();
  });
});
