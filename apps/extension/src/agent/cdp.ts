export interface Debuggee { tabId: number }
export interface ChromeDebuggerApi {
  attach(target: Debuggee, version: string): Promise<void>;
  detach(target: Debuggee): Promise<void>;
  sendCommand(target: Debuggee, method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface RuntimeResult {
  result?: { value?: unknown; description?: string };
  exceptionDetails?: unknown;
}

export async function evaluate<T>(api: ChromeDebuggerApi, target: Debuggee, expression: string): Promise<T> {
  const response = await api.sendCommand(target, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }) as RuntimeResult;
  if (response.exceptionDetails || !response.result || !("value" in response.result)) {
    throw new Error(response.result?.description ?? "Chrome evaluation failed");
  }
  return response.result.value as T;
}
