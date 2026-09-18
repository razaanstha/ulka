import { expect, test } from 'bun:test';
import { reuseOpenTab, samePageUrl } from '../apps/extension/src/agent/navigation';
import { NativeTabs } from '../apps/extension/src/agent/native-tabs';

function fixture() {
  const updates: unknown[] = [], creates: unknown[] = [];
  const tabs = [{ id: 1, active: true, url: 'https://other.test/' }, { id: 2, active: false, url: 'https://example.test/' }];
  const api = { tabs: {
    query: async () => tabs,
    update: async (id: number, args: object) => { updates.push({ id, ...args }); },
    create: async (args: object) => { creates.push(args); tabs.push({ id: 3, active: true, url: 'https://new.test/' }); return { id: 3 }; },
  }, tabGroups: { query: async () => [] } };
  return { api, updates, creates, tabs };
}

test('matching URL reuses open tab; background reuse does not steal focus', async () => {
  const { api, updates } = fixture();
  expect(await reuseOpenTab(api.tabs, 'https://EXAMPLE.test:443', true, 1)).toBe(2);
  expect(updates).toHaveLength(0);
  expect(await reuseOpenTab(api.tabs, 'https://example.test/', false, 1)).toBe(2);
  expect(updates).toEqual([{ id: 2, active: true }]);
});

test('pending destination is reused but a tab navigating away is not', async () => {
  const api = { query: async () => [{ id: 2, url: 'https://old.test/', pendingUrl: 'https://new.test/' }], update: async () => {} };
  expect(await reuseOpenTab(api, 'https://new.test/', true)).toBe(2);
  expect(await reuseOpenTab(api, 'https://old.test/', true)).toBeUndefined();
});

test('different paths, queries and application fragments are distinct pages', () => {
  for (const url of ['https://example.test/other', 'https://example.test/?q=other', 'https://example.test/#other']) {
    expect(samePageUrl(url, 'https://example.test/')).toBe(false);
  }
});

test('native create reuses matching tab but creates a genuinely new destination', async () => {
  const { api, creates } = fixture();
  const native = new NativeTabs(api as never, true);
  expect(await native.execute({ operation: 'create', tabIds: [], url: 'https://example.test/' })).toMatchObject({ taskTabId: 2, reused: true });
  expect(creates).toHaveLength(0);
  expect(await native.execute({ operation: 'create', tabIds: [], url: 'https://new.test/' })).toMatchObject({ taskTabId: 3 });
  expect(creates).toHaveLength(1);
});

test('native create opens supported internal pages and reuses existing internal tabs', async () => {
  const { api, creates, tabs } = fixture();
  tabs[1]!.url = 'chrome://history';
  const native = new NativeTabs(api as never);
  expect(await native.execute({ operation: 'create', tabIds: [], url: 'chrome://history/' })).toMatchObject({ taskTabId: 2, reused: true });
  expect(creates).toHaveLength(0);
  await native.execute({ operation: 'create', tabIds: [], url: 'chrome://extensions' });
  expect(creates).toEqual([{ url: 'chrome://extensions/', active: true }]);
  await expect(native.execute({ operation: 'create', tabIds: [], url: 'chrome://quit' })).rejects.toThrow();
  expect(creates).toHaveLength(1);
});
