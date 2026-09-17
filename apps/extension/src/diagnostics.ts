import { chromeApi } from "./chrome";

export const LOG_KEY = "ulkaDiagnosticsV1";
export interface LogEntry { at: string; runId: string; elapsedMs: number; event: string; data: unknown }
let queue = Promise.resolve();
let runId = "startup";
let started = Date.now();

export function sanitize(value: unknown, key = "", secrets: string[] = []): unknown {
  if (/^(text|value|currentValue|goal|content|messages|reply|evidence|title|label|targetLabel|authorization|apiKey|password|token)$/i.test(key)) return "[redacted]";
  if (value instanceof Error) return { name: value.name, message: sanitize(value.message, "message", secrets), stack: sanitize(value.stack, "stack", secrets) };
  if (typeof value === "string") {
    let clean = value;
    for (const secret of secrets) if (secret) clean = clean.split(secret).join("[redacted]");
    return clean.replace(/\b(?:vck_|sk-)[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/https?:\/\/[^\s"<>]+/g, url => { try { return new URL(url).origin + "/[path-redacted]"; } catch { return "[url-redacted]"; } })
      .slice(0, 4000);
  }
  if (Array.isArray(value)) return value.slice(-400).map(item => sanitize(item, "", secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k, secrets)]));
  return value;
}

export function beginLog(kind: string): void {
  runId = crypto.randomUUID(); started = Date.now();
  log("request", { kind });
}

export function log(event: string, data: unknown = {}): Promise<void> {
  const entry = { at: new Date().toISOString(), runId, elapsedMs: Date.now() - started, event };
  queue = queue.catch(() => {}).then(async () => {
    const stored = await chromeApi.storage.local.get([LOG_KEY, "vercelAiGatewayApiKey"]);
    const secrets = typeof stored.vercelAiGatewayApiKey === "string" ? [stored.vercelAiGatewayApiKey] : [];
    const entries = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] as LogEntry[] : [];
    entries.push({ ...entry, data: sanitize(data, "", secrets) });
    await chromeApi.storage.local.set({ [LOG_KEY]: entries.slice(-400) });
  });
  return queue.catch(error => console.warn("Ulka diagnostic storage failed", error?.name));
}
