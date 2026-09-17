export interface ChromeApi {
  runtime: {
    onMessage: { addListener(listener: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean | void): void };
    sendMessage(message: unknown): Promise<unknown>;
  };
  tabs: {
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    query(query: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number; title?: string; url?: string; active?: boolean; status?: string; windowId?: number; groupId?: number }>>;
    group(options: { tabIds: number[] }): Promise<number>;
    ungroup(tabIds: number[]): Promise<void>;
    update(tabId: number, properties: { url?: string; active?: boolean }): Promise<unknown>;
    create(properties: { url?: string; active?: boolean }): Promise<{ id?: number }>;
    remove(tabId: number): Promise<void>;
  };
  storage: { local: {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  } };
  tabGroups: {
    query(query: {}): Promise<Array<{ id: number; title?: string; color: string; collapsed: boolean; windowId: number }>>;
    update(id: number, properties: { title: string; collapsed?: boolean }): Promise<unknown>;
  };
  debugger: {
    attach(target: { tabId: number }, version: string): Promise<void>;
    detach(target: { tabId: number }): Promise<void>;
    sendCommand(target: { tabId: number }, method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
  sidePanel: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> };
  downloads: {
    search(query: { limit: number; orderBy: string[]; query?: string[]; state?: string }): Promise<Array<{ id: number; filename: string; state: string; bytesReceived: number; totalBytes: number; paused: boolean; startTime: string; endTime?: string; error?: string; danger: string; exists: boolean }>>;
    onChanged: { addListener(listener: (delta: { id: number; state?: { current?: string }; error?: { current?: string } }) => void): void };
  };
}
export const chromeApi = (globalThis as typeof globalThis & { chrome: ChromeApi }).chrome;
