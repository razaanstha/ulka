import { reuseOpenTab, validateNavigationUrl } from './navigation';
import type { ChromeApi } from '../chrome';

type NativeTab = Awaited<ReturnType<ChromeApi['tabs']['query']>>[number];
interface NativeTabOptions {
  taskTabId?: () => number;
  approveClose?: (tabs: NativeTab[]) => Promise<boolean>;
  signal?: AbortSignal;
}

export class NativeTabs {
  private observed = new Set<number>();
  constructor(private api: Pick<ChromeApi, 'tabs' | 'tabGroups'>, private readonly background = false, private readonly options: NativeTabOptions = {}) {}
  async list() {
    const tabs = await this.api.tabs.query({ currentWindow: true });
    this.observed = new Set(tabs.flatMap(tab => tab.id === undefined ? [] : [tab.id]));
    const groups = (await this.api.tabGroups.query({})).filter(group => tabs.some(tab => tab.windowId === group.windowId));
    return { tabs, groups };
  }
  async execute(input: { operation: string; tabIds: number[]; title?: string; url?: string }) {
    this.options.signal?.throwIfAborted();
    if (input.operation === 'list') return this.list();
    if (input.operation === 'create') {
      const url = input.url ? new URL(validateNavigationUrl(input.url)) : undefined;
      if (url) {
        const existingId = await reuseOpenTab(this.api.tabs, url.href, this.background, this.options.taskTabId?.(), this.options.signal);
        if (existingId !== undefined) return { status: 'done', taskTabId: existingId, reused: true, ...await this.list() };
      }
      const tab = await this.api.tabs.create({ url: url?.href ?? 'about:blank', active: !this.background });
      if (!tab.id) throw new Error('Tab creation failed');
      const inventory = await this.list();
      if (!inventory.tabs.some(item => item.id === tab.id)) throw new Error('Created tab could not be verified');
      return { status: 'done', taskTabId: tab.id, ...inventory };
    }
    const ids = [...new Set(input.tabIds)];
    const current = await this.api.tabs.query({ currentWindow: true });
    if (!ids.length || ids.some(id => !this.observed.has(id) || !current.some(tab => tab.id === id))) throw new Error('List tabs first; requested tab is unavailable or unobserved');
    if (input.operation === 'close') {
      const taskTabId = this.options.taskTabId?.();
      const targets = current.filter(tab => ids.includes(tab.id!)).map(tab => ({ ...tab }));
      const validate = (tabs: NativeTab[]) => {
        if (ids.some(id => !tabs.some(tab => tab.id === id))) throw new Error('Requested tab is unavailable; list tabs again');
        if (!tabs.some(tab => !ids.includes(tab.id!))) throw new Error('Keep at least one tab open in this window so the task can continue');
        if (this.background && tabs.some(tab => ids.includes(tab.id!) && (tab.active || tab.id === taskTabId))) {
          throw new Error('Cannot close the visible or current task tab in background mode. Switch the task to another tab first; use foreground mode to close the visible tab.');
        }
      };
      validate(current);
      // Preserve the same close approval used by the page action executor.
      if (!await this.options.approveClose?.(targets)) return { status: 'blocked', reason: 'Closing tabs requires approval.' };
      this.options.signal?.throwIfAborted();
      const refreshed = await this.api.tabs.query({ currentWindow: true });
      validate(refreshed);
      if (targets.some(target => refreshed.find(tab => tab.id === target.id)?.url !== target.url)) throw new Error('A tab changed during approval; list tabs and review again');
      for (const id of ids) {
        this.options.signal?.throwIfAborted();
        const live = await this.api.tabs.query({ currentWindow: true });
        const target = live.find(tab => tab.id === id);
        if (!target || target.url !== targets.find(tab => tab.id === id)?.url) throw new Error('Tab changed during close; inspect remaining tabs before retrying');
        if (!live.some(tab => tab.id !== id)) throw new Error('Keep at least one tab open in this window so the task can continue');
        // Activation can change while a batch is closing.
        if (this.background && target.active) throw new Error('Tab became visible during background close; remaining tabs were not closed');
        this.options.signal?.throwIfAborted();
        await this.api.tabs.remove(id);
      }
      const inventory = await this.list();
      if (inventory.tabs.some(tab => ids.includes(tab.id!))) throw new Error('Tab closure not verified; inspect the remaining tabs before retrying');
      const successor = ids.includes(taskTabId!) ? inventory.tabs.find(tab => tab.active) ?? inventory.tabs[0] : undefined;
      return { status: 'done', closedTabIds: ids, ...(successor?.id === undefined ? {} : { taskTabId: successor.id }), ...inventory };
    }
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
