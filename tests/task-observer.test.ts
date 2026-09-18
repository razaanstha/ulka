import { expect, test } from 'bun:test';
import { CdpObserver } from '../apps/extension/src/agent/observer';
import { createTaskObserver } from '../apps/extension/src/agent/task-observer';
import { progressState } from '../apps/extension/src/agent/history';
import { AgentRunner } from '../apps/extension/src/agent/agent-runner';

function setup() {
  let pauses = 0, reads = 0;
  const raw = { pageIdentity: 'p', url: 'https://example.test', title: '', text: 'Same page', scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {} };
  const cdp = new CdpObserver({ attach: async () => {}, detach: async () => {}, sendCommand: async (_target: unknown, method: string) => { if (method !== 'Runtime.evaluate') throw new Error('unsupported'); reads++; return { result: { value: raw } }; } }, { tabId: 7 }, async () => { pauses++; });
  const observer = createTaskObserver(cdp, async () => [{ id: 7, url: raw.url, active: true }, { title: 'No id' }], async () => {});
  return { observer, pauses: () => pauses, reads: () => reads };
}

test('production wrapper forwards explicit wait budget without false tab progress', async () => {
  const { observer, pauses } = setup();
  const before = await observer.observe();
  const after = await observer.waitForChange(before, () => false, 10000);
  expect(pauses()).toBe(40);
  expect(progressState(after)).toBe(progressState(before));
  expect(after.tabs).toEqual(before.tabs);
  expect(after.tabRefs).toEqual({ t1: 7 });
});

test('runner through production wrapper stops after two unchanged waits', async () => {
  const { observer, pauses } = setup();
  const runner = new AgentRunner(observer, { decide: async () => ({ operation: 'WAIT', confidence: 1 }) }, { execute: async () => {} } as never);
  expect((await runner.run('Wait for results')).reason).toContain('Wait checkpoint');
  expect(runner.history.map(action => action.pageChanged)).toEqual([false, false]);
  expect(pauses()).toBe(80);
});

test('cancelled wrapper wait performs no polling or tab queries', async () => {
  const { observer, reads, pauses } = setup();
  const before = await observer.observe();
  expect(await observer.waitForChange(before, () => true, 10000)).toBe(before);
  expect(reads()).toBe(1);
  expect(pauses()).toBe(0);
});

test('wait result refreshes tab references without mutating prior observation', async () => {
  const base = setup();
  let tabId = 7;
  const observer = createTaskObserver(base.observer, async () => [{ id: tabId, url: 'https://example.test', active: true }], async () => {});
  const before = await observer.observe();
  tabId = 9;
  const after = await observer.waitForChange(before);
  expect(before.tabRefs).toEqual({ t1: 7 });
  expect(after.tabRefs).toEqual({ t1: 9 });
  expect(progressState(after)).toBe(progressState(before));
});
