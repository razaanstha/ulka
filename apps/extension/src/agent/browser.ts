import { BrowserExecutor } from "./executor";
import { FreshnessValidator } from "./freshness";
import { CdpObserver } from "./observer";
import type { ChromeDebuggerApi, Debuggee } from "./cdp";
import type { TabController } from "./executor";

export class AttachedBrowser {
  readonly observer: CdpObserver;
  readonly executor: BrowserExecutor;
  private attached = false;
  constructor(private readonly api: ChromeDebuggerApi, private readonly target: Debuggee, tabs?: TabController) {
    const freshness = new FreshnessValidator(api, target);
    this.observer = new CdpObserver(api, target);
    this.executor = new BrowserExecutor(api, target, freshness, tabs);
  }
  async attach(): Promise<void> { if (!this.attached) { await this.api.attach(this.target, "1.3"); this.attached = true; } }
  async detach(): Promise<void> { if (this.attached) { await this.api.detach(this.target); this.attached = false; } }
  async switchTo(tabId: number): Promise<void> {
    await this.detach(); this.target.tabId = tabId; await this.attach();
  }
  get tabId(): number { return this.target.tabId; }
}

// FX host tools are serialized. Reuse their attachment, not their page snapshots.
export class TaskBrowserSession {
  private browser?: AttachedBrowser;
  private closed = false;
  constructor(private readonly createBrowser: (tabId: number) => AttachedBrowser, private readonly signal: AbortSignal) {}
  async get(tabId: number): Promise<AttachedBrowser> {
    if (this.closed) throw new Error('Browser task session is closed');
    this.signal.throwIfAborted();
    this.browser ??= this.createBrowser(tabId);
    if (this.browser.tabId !== tabId) await this.browser.switchTo(tabId);
    else await this.browser.attach();
    this.signal.throwIfAborted();
    return this.browser;
  }
  async release(): Promise<void> {
    if (!this.browser) return;
    await this.browser.detach();
    this.browser = undefined;
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.release();
  }
}
