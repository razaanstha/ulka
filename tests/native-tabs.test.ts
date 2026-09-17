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
