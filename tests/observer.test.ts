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

test('loading text cannot settle before delayed editor mounts', async () => {
  let samples = 0;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: '', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target, method) => {
    if (method !== 'Runtime.evaluate') throw new Error('unsupported');
    samples++;
    return { result: { value: { ...raw, text: samples === 1 ? '' : samples < 6 ? 'Loading…' : 'Editor ready', elements: samples < 6 ? [] : [{ id: 'e1', nodeId: 1, role: 'textbox', label: 'Destination', operations: ['TYPE_TEXT'] }] } } };
  } }, { tabId: 1 }, async () => {});
  const after = await observer.waitForChange(await observer.observe());
  expect(after.elements.map(e => e.label)).toContain('Destination');
});

test('settling budget includes slow observation time', async () => {
  let now = 0, reads = 0;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: '', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target, method) => {
    if (method !== 'Runtime.evaluate') throw new Error('unsupported');
    now += 800; reads++;
    return { result: { value: raw } };
  } }, { tabId: 1 }, async ms => { now += ms; }, () => now);
  const before = await observer.observe();
  const start = now;
  await observer.waitForChange(before);
  // One already-started observation can cross the deadline, but no new poll may start.
  expect(now - start).toBeLessThan(3800);
  expect(reads).toBeLessThanOrEqual(4);
});

test('settling polls DOM but returns fresh accessibility semantics', async () => {
  let prepares = 0, domReads = 0;
  const pauses: number[] = [];
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: 'before', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target, method, params) => {
    if (method !== 'Runtime.evaluate') throw new Error('Unexpected protocol call');
    const ax = String(params?.expression).includes('const useAccessibility = true;');
    if (!ax) domReads++;
    return { result: { value: { ...raw, text: ax ? (prepares === 1 ? 'AX before' : 'AX ready') : (domReads === 1 ? 'before' : 'ready') } } };
  } }, { tabId: 1 }, async ms => { pauses.push(ms); });
  (observer as any).accessibility.prepare = async () => { prepares++; return { source: 'accessibility' }; };
  const before = await observer.observe();
  const after = await observer.waitForChange(before);
  expect(after.text).toBe('AX ready');
  expect(prepares).toBe(2);
  expect(domReads).toBeGreaterThanOrEqual(4);
  expect(pauses).toEqual([50, 50, 50]);
});

test('fast DOM settling waits through loading and returns a delayed editor', async () => {
  let now = 0, prepares = 0;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: '', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async () => ({ result: { value: {
    ...raw, text: now === 0 ? '' : now < 1400 ? 'Loading…' : 'Editor ready',
    elements: now < 1400 ? [] : [{ id: 'e1', nodeId: 1, role: 'textbox', label: 'Draft', operations: ['TYPE_TEXT'] }],
  } } }) }, { tabId: 1 }, async ms => { now += ms; }, () => now);
  (observer as any).accessibility.prepare = async () => { prepares++; return { source: 'accessibility' }; };
  const after = await observer.waitForChange(await observer.observe());
  expect(now).toBeGreaterThanOrEqual(1500);
  expect(after.elements[0].label).toBe('Draft');
  expect(prepares).toBe(2);
});

test('Stop during DOM settling skips the final accessibility refresh', async () => {
  let stopped = false, prepares = 0;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: '', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const observer = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async () => ({ result: { value: raw } }) }, { tabId: 1 }, async () => { stopped = true; });
  (observer as any).accessibility.prepare = async () => { prepares++; return { source: 'accessibility' }; };
  await observer.waitForChange(await observer.observe(), () => stopped);
  expect(prepares).toBe(1);
});
