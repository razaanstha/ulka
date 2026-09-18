import { expect, test } from 'bun:test';
import { NativeTabs } from '../apps/extension/src/agent/native-tabs';

for (const background of [false, true]) {
  test(`${background ? 'background' : 'foreground'} tab creation and switching preserve mode`, async () => {
    let tabs = [{ id: 1, active: true, windowId: 7 }, { id: 2, active: false, windowId: 7 }];
    const activations: number[] = [];
    const api = { tabs: {
      query: async () => tabs,
      create: async ({ active }: { active: boolean }) => {
        if (active) tabs = tabs.map(tab => ({ ...tab, active: false }));
        tabs.push({ id: 3, active, windowId: 7 }); return { id: 3 };
      },
      update: async (id: number) => { activations.push(id); tabs = tabs.map(tab => ({ ...tab, active: tab.id === id })); },
    }, tabGroups: { query: async () => [] } };
    const native = new NativeTabs(api as never, background);
    await native.list();
    expect(await native.execute({ operation: 'switch', tabIds: [2] })).toMatchObject({ taskTabId: 2 });
    expect(activations).toEqual(background ? [] : [2]);
    expect(tabs.find(tab => tab.active)?.id).toBe(background ? 1 : 2);
    expect(await native.execute({ operation: 'create', tabIds: [], url: 'https://example.test' })).toMatchObject({ taskTabId: 3 });
    expect(tabs.find(tab => tab.active)?.id).toBe(background ? 1 : 3);
    await expect(native.execute({ operation: 'switch', tabIds: [99] })).rejects.toThrow('unobserved');
    tabs = tabs.filter(tab => tab.id !== 2);
    await expect(native.execute({ operation: 'switch', tabIds: [2] })).rejects.toThrow('unavailable');
  });
}
