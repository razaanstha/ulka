import { snapshotFingerprint, type PageSnapshot } from '../../../../packages/protocol/src';

const INTERNAL_PAGES = new Set(['extensions', 'history', 'downloads', 'bookmarks', 'settings', 'newtab', 'version']);

export function validateNavigationUrl(value: string): string {
  const url = new URL(value);
  const internal = url.protocol === 'chrome:' && INTERNAL_PAGES.has(url.hostname) && !url.port;
  if ((!internal && (url.protocol !== 'https:' || !url.hostname)) || url.username || url.password) {
    throw new Error('Only HTTPS URLs or supported chrome:// pages (extensions, history, downloads, bookmarks, settings, newtab, version) are supported');
  }
  if (internal && !url.pathname) url.pathname = '/';
  return url.href;
}

// Browser-owned documents cannot be inspected through the page debugger.
// Tab metadata proves only which page is open, never a settings change.
export function internalPageSnapshot(tab: { id?: number; url?: string; title?: string; status?: string }): PageSnapshot | undefined {
  if (!tab.url?.startsWith('chrome://')) return;
  const page = {
    pageIdentity: String(tab.id), url: tab.url, title: tab.title ?? '',
    text: 'Browser tab metadata only. Load status: ' + (tab.status ?? 'unknown') + '. Internal document content and controls are unavailable. This evidence cannot verify settings changes or actions inside this page.',
    scroll: { y: 0, height: 0, viewportHeight: 0 }, elements: [], guards: {},
  };
  const fingerprint = snapshotFingerprint(page);
  return { ...page, fingerprint, snapshotId: 'tab:' + tab.id + ':' + fingerprint, createdAt: Date.now() };
}

export async function waitForNavigation(
  tabId: number,
  readTabs: () => Promise<Array<{ id?: number; url?: string; status?: string }>>,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const deadline = Date.now() + timeoutMs;
  const timeoutError = () => new Error(`Page did not finish loading within ${timeoutMs / 1000} seconds; task has not completed.`);
  if (timeoutMs <= 0) throw timeoutError();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => reject(timeoutError()), timeoutMs);
    onAbort = () => reject(signal!.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  try {
    while (true) {
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw timeoutError();
      // Browser APIs can stall independently of navigation. Race each wait so
      // Stop and the deadline release the caller even if a query never settles.
      const tabs = await Promise.race([readTabs(), interrupted]);
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw timeoutError();
      const tab = tabs.find(item => item.id === tabId);
      if (!tab) throw new Error("Task tab was closed during navigation.");
      if (tab.status === "complete" && tab.url) { validateNavigationUrl(tab.url); return; }
      await Promise.race([
        new Promise<void>(resolve => { pollTimer = setTimeout(resolve, 200); }),
        interrupted,
      ]);
    }
  } finally {
    clearTimeout(deadlineTimer);
    clearTimeout(pollTimer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

// Preserve query parameters and fragments: they may identify different searches
// or application routes. URL parsing normalizes host casing and default ports.
export function samePageUrl(left: string | undefined, right: string): boolean {
  if (!left) return false;
  try { return validateNavigationUrl(left) === validateNavigationUrl(right); } catch { return false; }
}

export async function reuseOpenTab(
  tabs: Pick<import('../chrome').ChromeApi['tabs'], 'query' | 'update'>,
  url: string,
  background: boolean,
  taskTabId?: number,
  signal?: AbortSignal,
): Promise<number | undefined> {
  signal?.throwIfAborted();
  const matches = (await tabs.query({ currentWindow: true })).filter(tab =>
    tab.id !== undefined && samePageUrl(tab.pendingUrl ?? tab.url, url));
  const existing = matches.find(tab => tab.id === taskTabId) ?? matches.find(tab => tab.active) ?? matches[0];
  signal?.throwIfAborted();
  if (existing?.id === undefined) return;
  if (!background && !existing.active) await tabs.update(existing.id, { active: true });
  return existing.id;
}
