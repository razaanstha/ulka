import { expect, test } from 'bun:test';
import { NativeTabs } from '../apps/extension/src/agent/native-tabs';

test('observation inventory authorizes switching only to live observed tabs', async () => {
  let tabs = [{ id: 1, active: true, windowId: 7 }, { id: 2, active: false, windowId: 7 }];
  const api = { tabs: {
    query: async () => tabs,
    update: async (id: number) => { tabs = tabs.map(tab => ({ ...tab, active: tab.id === id })); },
  }, tabGroups: { query: async () => [] } };
  const native = new NativeTabs(api as never);
  await native.list();
  expect(await native.execute({ operation: 'switch', tabIds: [2] })).toMatchObject({ status: 'done', taskTabId: 2 });
  tabs = tabs.filter(tab => tab.id !== 1);
  await expect(native.execute({ operation: 'switch', tabIds: [1] })).rejects.toThrow('unavailable');
  await expect(native.execute({ operation: 'switch', tabIds: [99] })).rejects.toThrow('unobserved');
});

function closeFixture(background = false, approved = true, taskTabId = 1) {
  let tabs = [1, 2, 3].map(id => ({ id, active: id === 1, windowId: 7, title: `Tab ${id}`, url: `https://example.test/${id}` }));
  const removed: number[] = [], reviewed: number[][] = [];
  const controller = new AbortController();
  const api = { tabs: {
    query: async () => tabs,
    remove: async (id: number) => {
      removed.push(id); tabs = tabs.filter(tab => tab.id !== id);
      if (!tabs.some(tab => tab.active) && tabs[0]) tabs[0].active = true;
    },
  }, tabGroups: { query: async () => [] } };
  const options = { taskTabId: () => taskTabId, signal: controller.signal,
    approveClose: async (targets: Array<{ id?: number }>) => { reviewed.push(targets.map(tab => tab.id!)); return approved; },
  };
  const native = new NativeTabs(api as never, background, options);
  return { native, removed, reviewed, api, options, controller };
}

test('native close removes only observed requested IDs and verifies remaining inventory', async () => {
  const { native, removed, reviewed } = closeFixture();
  await native.list();
  const result = await native.execute({ operation: 'close', tabIds: [2, 2, 3] });
  expect(result).toMatchObject({ status: 'done', closedTabIds: [2, 3], tabs: [{ id: 1 }] });
  expect(removed).toEqual([2, 3]); expect(reviewed).toEqual([[2, 3]]);
});

test('closing foreground task tab returns surviving task target', async () => {
  const { native } = closeFixture(); await native.list();
  expect(await native.execute({ operation: 'close', tabIds: [1] })).toMatchObject({ status: 'done', taskTabId: 2, closedTabIds: [1] });
});

test('denied close and unobserved IDs cause no removals', async () => {
  const { native, removed } = closeFixture(false, false);
  await expect(native.execute({ operation: 'close', tabIds: [2] })).rejects.toThrow('List tabs first');
  await native.list();
  expect(await native.execute({ operation: 'close', tabIds: [2] })).toMatchObject({ status: 'blocked', reason: 'Closing tabs requires approval.' });
  await expect(native.execute({ operation: 'close', tabIds: [99] })).rejects.toThrow('unavailable');
  expect(removed).toEqual([]);
});

test('background close protects visible and task tabs, permits other observed tabs', async () => {
  const { native, removed } = closeFixture(true, true, 2); await native.list();
  for (const id of [1, 2]) await expect(native.execute({ operation: 'close', tabIds: [id] })).rejects.toThrow('background mode');
  expect(await native.execute({ operation: 'close', tabIds: [3] })).toMatchObject({ status: 'done', closedTabIds: [3] });
  expect(removed).toEqual([3]);
});

test('native close cannot remove every window tab', async () => {
  const { native, removed, reviewed } = closeFixture(); await native.list();
  await expect(native.execute({ operation: 'close', tabIds: [1, 2, 3] })).rejects.toThrow('Keep at least one tab');
  expect(removed).toEqual([]); expect(reviewed).toEqual([]);
});

test('cancelled or changed approval targets cannot be closed', async () => {
  for (const cancel of [false, true]) {
    const { native, removed, api, options, controller } = closeFixture(); await native.list();
    options.approveClose = async () => {
      if (cancel) controller.abort();
      else (await api.tabs.query())[1].url = 'https://different.test';
      return true;
    };
    await expect(native.execute({ operation: 'close', tabIds: [2] })).rejects.toThrow();
    expect(removed).toEqual([]);
  }
});

test('native close rejects success when browser retains requested tab', async () => {
  const { native, api } = closeFixture(); await native.list();
  api.tabs.remove = async () => {};
  await expect(native.execute({ operation: 'close', tabIds: [2] })).rejects.toThrow('not verified');
});
