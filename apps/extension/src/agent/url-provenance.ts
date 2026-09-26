import { validateNavigationUrl } from './navigation';
import type { ConversationMessage } from './conversation-message';

// Search starts may be known. Destination paths and query strings must come
// from the user or an observed browser link, tab, or loaded page.
const SEARCH_STARTS = ['https://www.google.com/', 'https://www.bing.com/', 'https://duckduckgo.com/'];

export class UrlProvenance {
  private readonly allowed = new Set(SEARCH_STARTS.map(validateNavigationUrl));

  constructor(messages: ConversationMessage[]) {
    for (const message of messages.filter(item => item.role === 'user')) this.recordUserText(message.content);
  }

  recordUserText(content: string): void {
    for (const match of content.matchAll(/(?:https:\/\/|chrome:\/\/)[^\s<>"'`]+/gi)) {
      this.add(match[0].replace(/[),.;!?]+$/, ''));
    }
  }

  private add(value: unknown): void {
    if (typeof value !== 'string') return;
    try { this.allowed.add(validateNavigationUrl(value)); } catch { /* Ignore untrusted or unsupported URLs. */ }
  }

  recordBrowserResult(result: unknown): void {
    if (!result || typeof result !== 'object') return;
    const value = result as Record<string, any>;
    this.add(value.page?.url);
    this.add(value.reading?.url);
    for (const tab of Array.isArray(value.tabs) ? value.tabs : []) this.add(tab?.url);
    for (const control of Array.isArray(value.page?.controls) ? value.page.controls : []) this.add(control?.href);
    if (value.observation) this.recordBrowserResult(value.observation);
  }

  assertObserved(value: string): string {
    const url = validateNavigationUrl(value);
    if (!this.allowed.has(url)) throw new Error('URL was not supplied by user or observed in browser. Use search_web for a named site, then open its observed result; never guess destination paths or query parameters.');
    return url;
  }
}
