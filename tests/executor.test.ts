import { describe, expect, test } from "bun:test";
import { BrowserExecutor } from "../apps/extension/src/agent/executor";
import type { PageSnapshot } from "../packages/protocol/src";

const snapshot: PageSnapshot = { snapshotId: "s", fingerprint: "f", pageIdentity: "p", url: "https://x.test", title: "", text: "",
  scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {}, tabs: [{ id: "t1", title: "One", url: "https://x.test", active: true }], tabRefs: { t1: 42 }, createdAt: 1 };

test("hover and Escape never click; targeted scroll uses validated coordinates", async () => {
  const calls: any[] = [];
  const api = { attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string, params?: any) => { calls.push({ method, ...params }); return { result: { value: true } }; } };
  const page = { ...snapshot, guards: { e1: { nodeId: 1, role: "button", label: "Menu", enabled: true, rect: { x: 0, y: 0, width: 20, height: 20 } } } };
  const executor = new BrowserExecutor(api, { tabId: 1 }, { validateSnapshot: async () => true, validateTarget: async () => ({ x: 10, y: 10 }) } as never);
  await executor.execute(page, { operation: "HOVER", target: "e1", confidence: 1 });
  await executor.execute(page, { operation: "PRESS_ESCAPE", target: "e1", confidence: 1 });
  await executor.execute(page, { operation: "SCROLL_ELEMENT_DOWN", target: "e1", confidence: 1 });
  expect(calls.some(call => call.type === "mousePressed")).toBe(false);
  expect(calls.find(call => call.type === "mouseWheel")).toMatchObject({ x: 10, y: 10, deltaY: 420 });
  expect(calls.find(call => call.type === "keyDown").key).toBe("Escape");
  await executor.execute(page, { operation: "RIGHT_CLICK", target: "e1", confidence: 1 });
  expect(calls.filter(call => call.button === 'right').map(call => call.type)).toEqual(['mousePressed','mouseReleased']);
});

describe("tab executor", () => {
  test("opens and switches using local tab reference map", async () => {
    const calls: string[] = [];
    const tabs = { open: async () => { calls.push("open"); }, switch: async (id: number) => { calls.push(`switch:${id}`); }, close: async () => {} };
    const executor = new BrowserExecutor({ sendCommand: async () => ({}), attach: async () => {}, detach: async () => {} }, { tabId: 1 }, {} as never, tabs);
    await executor.execute(snapshot, { operation: "OPEN_TAB", confidence: 1 });
    await executor.execute(snapshot, { operation: "SWITCH_TAB", target: "t1", confidence: 1 });
    expect(calls).toEqual(["open", "switch:42"]);
  });

  test("rejects unobserved tab target", async () => {
    const tabs = { open: async () => {}, switch: async () => {}, close: async () => {} };
    const executor = new BrowserExecutor({ sendCommand: async () => ({}), attach: async () => {}, detach: async () => {} }, { tabId: 1 }, {} as never, tabs);
    await expect(executor.execute(snapshot, { operation: "SWITCH_TAB", target: "t999", confidence: 1 })).rejects.toThrow("Unknown tab");
  });
});

test("native date typing uses validated local node and dispatches events", async () => {
  const expressions: string[] = [];
  const api = { attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string, params?: any) => {
    if (method === "Runtime.evaluate") { expressions.push(params.expression); return { result: { value: true } }; }
    return {};
  } };
  const dated: PageSnapshot = { ...snapshot, elements: [{ id: "e1", nodeId: 7, role: "textbox", label: "Departure", inputType: "date", operations: ["TYPE_TEXT"] }],
    guards: { e1: { nodeId: 7, role: "textbox", label: "Departure", enabled: true, rect: { x: 0, y: 0, width: 20, height: 20 } } } };
  const freshness = { validateSnapshot: async () => true, validateTarget: async () => ({ x: 10, y: 10 }) };
  const executor = new BrowserExecutor(api, { tabId: 1 }, freshness as never);
  await executor.execute(dated, { operation: "TYPE_TEXT", target: "e1", confidence: 1 }, "2026-10-20");
  expect(expressions.some((expression) => expression.includes("2026-10-20") && expression.includes("dispatchEvent"))).toBe(true);
});

test("stale scroll decision executes no wheel input", async () => {
  let commands = 0;
  const api = { attach: async () => {}, detach: async () => {}, sendCommand: async () => { commands++; return {}; } };
  const executor = new BrowserExecutor(api, { tabId: 1 }, { validateSnapshot: async () => false } as never);
  await expect(executor.execute(snapshot, { operation: "SCROLL_DOWN", confidence: 1 })).rejects.toThrow("Page changed");
  expect(commands).toBe(0);
});

test('Enter accepts combobox suggestion without clicking and collapsing popup', async () => {
  const calls: any[] = [];
  const api = { attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string, params?: any) => {
    calls.push({ method, ...params }); return { result: { value: true } };
  } };
  const page = { ...snapshot, guards: { e1: { nodeId: 1, role: 'combobox', label: 'Destination', enabled: true, rect: { x: 0, y: 0, width: 20, height: 20 } } } };
  const executor = new BrowserExecutor(api, { tabId: 1 }, { validateSnapshot: async () => true, validateTarget: async () => ({ x: 10, y: 10 }) } as never);
  await executor.execute(page, { operation: 'PRESS_ENTER', target: 'e1', confidence: 1 });
  expect(calls.some(call => call.method === 'Input.dispatchMouseEvent')).toBe(false);
  expect(calls.filter(call => call.method === 'Input.dispatchKeyEvent').map(call => [call.type, call.key])).toEqual([['keyDown', 'Enter'], ['keyUp', 'Enter']]);
});

test('typing stops when click redirects focus or selecting the full value fails', async () => {
  for (const checks of [[false, false], [false, true, false]]) {
    const calls: string[] = [];
    const api = { attach: async () => {}, detach: async () => {}, sendCommand: async (_: unknown, method: string) => {
      calls.push(method);
      return method === 'Runtime.evaluate' ? { result: { value: checks.shift() } } : {};
    } };
    const page = { ...snapshot, guards: { e1: { nodeId: 1, role: 'textbox', label: 'Return', enabled: true, rect: { x: 0, y: 0, width: 20, height: 20 } } } };
    const executor = new BrowserExecutor(api, { tabId: 1 }, { validateSnapshot: async () => true, validateTarget: async () => ({ x: 10, y: 10 }) } as never);
    await expect(executor.execute(page, { operation: 'TYPE_TEXT', target: 'e1', confidence: 1 }, 'Oct 10')).rejects.toThrow(/focus|selected/);
    expect(calls).not.toContain('Input.insertText');
  }
});

test('typing into an already focused popup editor never clicks its toggle again', async () => {
  const calls: Array<{ method: string; params: any }> = [];
  const api = { attach: async () => {}, detach: async () => {}, sendCommand: async (_: unknown, method: string, params?: any) => {
    calls.push({ method, params });
    return { result: { value: true } };
  } };
  const page = { ...snapshot, guards: { e1: { nodeId: 2, role: 'combobox', label: 'Where to?', enabled: true, rect: { x: 0, y: 0, width: 20, height: 20 } } } };
  const executor = new BrowserExecutor(api, { tabId: 1 }, { validateSnapshot: async () => true, validateTarget: async () => ({ x: 10, y: 10 }) } as never);
  await executor.execute(page, { operation: 'TYPE_TEXT', target: 'e1', confidence: 1 }, 'Vienna');
  expect(calls.filter(c => c.method === 'Input.dispatchMouseEvent')).toHaveLength(0);
  expect(calls.find(c => c.method === 'Input.insertText')?.params.text).toBe('Vienna');
});
