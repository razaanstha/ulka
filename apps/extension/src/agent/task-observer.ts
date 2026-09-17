import type { PageSnapshot } from '../../../../packages/protocol/src';
import type { ChromeApi } from '../chrome';
import type { CdpObserver } from './observer';

// Both observation paths return fresh tab metadata. Page-change polling deliberately
// compares document content only, never presence/absence of browser metadata.
export function createTaskObserver(
  observer: Pick<CdpObserver, 'observe' | 'waitForChange'>,
  queryTabs: () => ReturnType<ChromeApi['tabs']['query']>,
  beforeObserve: () => Promise<void>,
): Pick<CdpObserver, 'observe' | 'waitForChange'> {
  async function withTabs(snapshot: PageSnapshot): Promise<PageSnapshot> {
    const tabs = (await queryTabs()).filter((tab): tab is typeof tab & { id: number } => typeof tab.id === 'number');
    return {
      ...snapshot,
      tabs: tabs.map((tab, index) => ({ id: `t${index + 1}`, title: tab.title ?? '', url: tab.url ?? '', active: Boolean(tab.active) })),
      tabRefs: Object.fromEntries(tabs.map((tab, index) => [`t${index + 1}`, tab.id])),
    };
  }
  return {
    async observe() {
      await beforeObserve();
      return withTabs(await observer.observe());
    },
    async waitForChange(before, stopped = () => false, timeoutMs = 3000) {
      if (stopped()) return before;
      const after = await observer.waitForChange(before, stopped, timeoutMs);
      return stopped() ? after : withTabs(after);
    },
  };
}
