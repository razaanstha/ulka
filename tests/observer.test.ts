import { expect, test } from "bun:test";
import { CdpObserver } from "../apps/extension/src/agent/observer";

test("observer retries until document body becomes available", async () => {
  let calls = 0;
  const raw = { pageIdentity: "p", url: "https://google.com", title: "Google", text: "",
    scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const api = {
    attach: async () => {}, detach: async () => {},
    sendCommand: async (_target: unknown, method: string) => { if (method !== 'Runtime.evaluate') throw new Error('unsupported'); return ({ result: { value: ++calls === 1 ? null : raw } }); },
  };
  const observer = new CdpObserver(api, { tabId: 1 }, async () => {});
  expect((await observer.observe()).url).toBe("https://google.com");
  expect(calls).toBe(2);
});

test("waits through delayed updates until changed page settles", async () => {
  let samples = 0, pauses = 0;
  const raw = { pageIdentity: "p", url: "https://example.test", title: "", text: "before", scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string) => { if (method !== 'Runtime.evaluate') throw new Error('unsupported'); return ({ result: { value: { ...raw, text: ++samples >= 4 ? "loaded" : "before" } } }); } }, { tabId: 1 }, async () => { pauses++; });
  const before = await observer.observe();
  expect((await observer.waitForChange(before)).text).toBe("loaded");
  expect(pauses).toBe(5);
  const count = samples;
  await observer.waitForChange(before, () => true);
  expect(samples).toBe(count);
});

test("unchanged pages have bounded wait", async () => {
  let pauses = 0;
  const raw = { pageIdentity: "p", url: "https://example.test", title: "", text: "", scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string) => { if (method !== 'Runtime.evaluate') throw new Error('unsupported'); return ({ result: { value: raw } }); } }, { tabId: 1 }, async () => { pauses++; });
  await observer.waitForChange(await observer.observe());
  expect(pauses).toBe(12);
});

test('layout churn cannot end waiting before a delayed control arrives', async () => {
  let samples = 0, pauses = 0;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: 'Loading', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string) => { if (method !== 'Runtime.evaluate') throw new Error('unsupported'); return ({ result: { value: { ...raw, diagnostics: { candidates: samples++ < 4 ? 1 : 2 }, text: samples >= 18 ? 'Search ready' : 'Loading' } } }); } }, { tabId: 1 }, async () => { pauses++; });
  expect((await observer.waitForChange(await observer.observe(), () => false, 10000)).text).toBe('Search ready');
  expect(pauses).toBeLessThan(40);
});

test('explicit wait stays bounded on unchanged content and cancels between samples', async () => {
  let pauses = 0, cancelled = false;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: '', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string) => { if (method !== 'Runtime.evaluate') throw new Error('unsupported'); return ({ result: { value: raw } }); } }, { tabId: 1 }, async () => { pauses++; if (pauses === 42) cancelled = true; });
  const before = await observer.observe();
  await observer.waitForChange(before, () => cancelled, 10000);
  expect(pauses).toBe(40);
  await observer.waitForChange(before, () => cancelled, 10000);
  expect(pauses).toBe(42);
});

test('tab metadata on input cannot manufacture page progress', async () => {
  let pauses = 0;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: 'Same page', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string) => { if (method !== 'Runtime.evaluate') throw new Error('unsupported'); return ({ result: { value: raw } }); } }, { tabId: 1 }, async () => { pauses++; });
  const before = { ...await observer.observe(), tabs: [{ id: 't1', url: raw.url, title: '', active: true }], tabRefs: { t1: 1 } };
  await observer.waitForChange(before);
  expect(pauses).toBe(12);
});

test('trigger focus alone cannot settle before delayed chat appears', async () => {
  let sample = 0;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: '', scroll: { y: 0, height: 100, viewportHeight: 100 }, guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target, method) => {
    if (method !== 'Runtime.evaluate') throw new Error('unsupported');
    sample++;
    return { result: { value: { ...raw, elements: [
      { id: 'e1', nodeId: 1, role: 'button', label: 'Message', operations: ['CLICK'], ...(sample > 1 ? { focused: true } : {}) },
      ...(sample >= 6 ? [{ id: 'e2', nodeId: 2, role: 'textbox', label: 'Write a message', operations: ['TYPE_TEXT'] }] : []),
    ] } } };
  } }, { tabId: 1 }, async () => {});
  const after = await observer.waitForChange(await observer.observe());
  expect(after.elements.map(e => e.label)).toEqual(['Message', 'Write a message']);
  expect(sample).toBe(8);
});
