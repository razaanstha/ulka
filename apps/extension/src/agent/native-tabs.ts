import type { ChromeApi } from '../chrome';

export class NativeTabs {
  private observed = new Set<number>();
  constructor(private api: Pick<ChromeApi, 'tabs' | 'tabGroups'>, private readonly background = false) {}
  async list() {
    const tabs = await this.api.tabs.query({ currentWindow: true });
    this.observed = new Set(tabs.flatMap(tab => tab.id === undefined ? [] : [tab.id]));
    const groups = (await this.api.tabGroups.query({})).filter(group => tabs.some(tab => tab.windowId === group.windowId));
    return { tabs, groups };
  }
  async execute(input: { operation: string; tabIds: number[]; title?: string; url?: string }) {
    if (input.operation === 'list') return this.list();
    if (input.operation === 'create') {
      const url = input.url ? new URL(input.url) : undefined;
      if (url && (url.protocol !== 'https:' || url.username || url.password)) throw new Error('Only HTTPS URLs or an empty new tab are supported');
      const tab = await this.api.tabs.create({ url: url?.href ?? 'about:blank', active: !this.background });
      if (!tab.id) throw new Error('Tab creation failed');
      const inventory = await this.list();
      if (!inventory.tabs.some(item => item.id === tab.id)) throw new Error('Created tab could not be verified');
      return { status: 'done', taskTabId: tab.id, ...inventory };
    }
    const ids = [...new Set(input.tabIds)];
    const current = await this.api.tabs.query({ currentWindow: true });
    if (!ids.length || ids.some(id => !this.observed.has(id) || !current.some(tab => tab.id === id))) throw new Error('List tabs first; requested tab is unavailable or unobserved');
    if (input.operation === 'switch') {
      if (ids.length !== 1) throw new Error('Switch requires exactly one tab');
      if (!this.background) await this.api.tabs.update(ids[0], { active: true });
      const inventory = await this.list();
      if (!inventory.tabs.some(tab => tab.id === ids[0] && (this.background || tab.active))) throw new Error('Tab switch not verified');
      return { status: 'done', taskTabId: ids[0], ...inventory };
    }
    if (input.operation === 'group') {
      if (!input.title?.trim()) throw new Error('Group title required');
      const groupId = await this.api.tabs.group({ tabIds: ids });
      await this.api.tabGroups.update(groupId, { title: input.title.trim() });
      const inventory = await this.list();
      if (!ids.every(id => inventory.tabs.some(tab => tab.id === id && tab.groupId === groupId)) || !inventory.groups.some(group => group.id === groupId && group.title === input.title!.trim())) throw new Error('Group membership or title not verified');
      return { status: 'done', ...inventory };
    }
    if (input.operation === 'ungroup') {
      await this.api.tabs.ungroup(ids);
      const inventory = await this.list();
      if (!ids.every(id => inventory.tabs.some(tab => tab.id === id && tab.groupId === -1))) throw new Error('Ungrouping not verified');
      return { status: 'done', ...inventory };
    }
    throw new Error('Unsupported native tab action');
  }
}
