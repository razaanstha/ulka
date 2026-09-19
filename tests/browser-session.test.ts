import { expect, test } from 'bun:test';
import { AttachedBrowser, TaskBrowserSession } from '../apps/extension/src/agent/browser';

function fixture(signal = new AbortController().signal) {
  const events: string[] = [];
  const api = { attach: async ({ tabId }: { tabId: number }) => { events.push(`attach:${tabId}`); },
    detach: async ({ tabId }: { tabId: number }) => { events.push(`detach:${tabId}`); }, sendCommand: async () => ({}) };
  const session = new TaskBrowserSession(id => new AttachedBrowser(api, { tabId: id }), signal);
  return { session, events };
}

test('one task reuses its browser across observations, reads and subgoals', async () => {
  const { session, events } = fixture();
  const first = await session.get(1);
  for (let i = 0; i < 4; i++) expect(await session.get(1)).toBe(first);
  expect(events).toEqual(['attach:1']);
  await session.close(); await session.close();
  expect(events).toEqual(['attach:1', 'detach:1']);
  await expect(session.get(1)).rejects.toThrow('closed');
});

test('switching task tabs detaches the old tab before attaching the new one', async () => {
  const { session, events } = fixture();
  await session.get(1); const current = await session.get(2); await session.close();
  expect(current.tabId).toBe(2);
  expect(events).toEqual(['attach:1', 'detach:1', 'attach:2', 'detach:2']);
});

test('releasing before native tab closure avoids detaching a deleted tab later', async () => {
  const { session, events } = fixture();
  await session.get(1); await session.release(); await session.get(2); await session.close();
  expect(events).toEqual(['attach:1', 'detach:1', 'attach:2', 'detach:2']);
});

test('cancelled tasks cannot reuse or reopen a browser attachment', async () => {
  const controller = new AbortController(); const { session, events } = fixture(controller.signal);
  await session.get(1); controller.abort(new Error('Stopped'));
  await expect(session.get(2)).rejects.toThrow('Stopped');
  await session.close();
  expect(events).toEqual(['attach:1', 'detach:1']);
});

test('cancellation during attach still permits final cleanup', async () => {
  const controller = new AbortController(); let detached = 0;
  const api = { attach: async () => { controller.abort(new Error('Stopped')); },
    detach: async () => { detached++; }, sendCommand: async () => ({}) };
  const session = new TaskBrowserSession(id => new AttachedBrowser(api, { tabId: id }), controller.signal);
  await expect(session.get(1)).rejects.toThrow('Stopped');
  await session.close();
  expect(detached).toBe(1);
});
