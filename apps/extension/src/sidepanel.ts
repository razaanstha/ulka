import { chromeApi } from "./chrome";
import { LOG_KEY, sanitize } from "./diagnostics";
import type { ConversationMessage } from "./agent/conversation";
import { renderMarkdown } from "./markdown";
import { formatApprovalRequest, type ApprovalRequest } from './agent/approval-request';

const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const apiKey = document.querySelector<HTMLInputElement>("#api-key")!;
const keyStatus = document.querySelector<HTMLElement>("#key-status")!;
const state = document.querySelector<HTMLElement>("#state")!;
const chat = document.querySelector<HTMLElement>("#chat")!;
const trace = document.querySelector<HTMLElement>("#trace")!;
const messages: ConversationMessage[] = [];
type SavedChat = { id: string; title: string; messages: ConversationMessage[] };
let conversations: SavedChat[] = [];
let currentId: string = crypto.randomUUID();
let historyReady = false;
let streamedText = '';
let thinking: HTMLDetailsElement | undefined;
let thinkingBody: HTMLElement | undefined;
let thinkingText = '';
let saveQueue = Promise.resolve();
const historyPanel = document.createElement('section'); historyPanel.id = 'history'; historyPanel.hidden = true;
document.querySelector('header')!.after(historyPanel);
const historyButton = document.createElement('button'); historyButton.textContent = 'Chats'; historyButton.setAttribute('aria-label', 'Chat history');
const newButton = document.createElement('button'); newButton.textContent = '+'; newButton.setAttribute('aria-label', 'New chat');
document.querySelector('header')!.append(historyButton, newButton);
historyButton.setAttribute('aria-expanded', 'false');
historyButton.addEventListener('click', () => { historyPanel.hidden = !historyPanel.hidden; historyButton.setAttribute('aria-expanded', String(!historyPanel.hidden)); document.querySelector<HTMLElement>('#settings')!.hidden = true; renderHistory(); });
newButton.addEventListener('click', () => { if (busy || !historyReady) return; currentId = crypto.randomUUID(); messages.length = 0; chat.replaceChildren(); prompt.value = ''; historyPanel.hidden = true; appendMessage('assistant', 'What would you like to do?'); prompt.focus(); });
function renderHistory() {
  historyPanel.replaceChildren();
  const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Chats saved on this device. Switching is available after the current run.'; historyPanel.append(note);
  for (const entry of conversations) {
    const button = document.createElement('button'); button.textContent = entry.title; button.disabled = busy; button.setAttribute('aria-current', String(entry.id === currentId));
    button.addEventListener('click', () => { if (busy) return; currentId = entry.id; messages.splice(0, messages.length, ...entry.messages); chat.replaceChildren(); for (const message of messages) appendMessage(message.role, message.content); historyPanel.hidden = true; });
    historyPanel.append(button);
  }
}
function saveConversation() {
  const entry = { id: currentId, title: messages.find(message => message.role === 'user')?.content.slice(0, 65) ?? 'New chat', messages: messages.map(message => ({ ...message })) };
  conversations = [entry, ...conversations.filter(chat => chat.id !== currentId)];
  const saved = structuredClone(conversations);
  saveQueue = saveQueue.catch(() => {}).then(() => chromeApi.storage.local.set({ ulkaChats: saved })).catch(() => { progress.textContent = 'Chat could not be saved on this device.'; });
}
void chromeApi.storage.local.get('ulkaChats').then(stored => {
  if (Array.isArray(stored.ulkaChats)) conversations = stored.ulkaChats.filter((entry: any) => typeof entry?.id === 'string' && typeof entry.title === 'string' && Array.isArray(entry.messages) && entry.messages.every((message: any) => ['user','assistant'].includes(message.role) && typeof message.content === 'string'));
}).finally(() => { historyReady = true; });
const approval = document.querySelector<HTMLDialogElement>("#approval")!;
const approvalText = document.querySelector<HTMLElement>("#approval-text")!;
let approvalId: string | undefined;
const engine = document.querySelector<HTMLSelectElement>("#engine")!;
void chromeApi.storage.local.get("ulkaEngine").then(stored => { engine.value = stored.ulkaEngine === "classic" ? "classic" : "fx"; });
engine.addEventListener("change", () => void chromeApi.storage.local.set({ ulkaEngine: engine.value }));
const progress = document.querySelector<HTMLElement>("#activity-detail")!;
const diagnostics = document.querySelector<HTMLElement>("#diagnostics")!;
const send = document.querySelector<HTMLButtonElement>("#send")!;
const stop = document.querySelector<HTMLButtonElement>("#stop")!;
let busy = false;
let streaming: HTMLElement | undefined;
document.querySelector("#settings-toggle")!.addEventListener("click", event => {
  const settings = document.querySelector<HTMLElement>("#settings")!;
  settings.hidden = !settings.hidden;
  historyPanel.hidden = true; historyButton.setAttribute('aria-expanded', 'false');
  (event.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!settings.hidden));
});
document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach(button => button.addEventListener("click", () => { prompt.value = button.dataset.prompt!; prompt.focus(); }));
const logStatus = diagnostics.querySelector<HTMLElement>("#log-status")!;
async function report(): Promise<string> {
  const stored = await chromeApi.storage.local.get([LOG_KEY, "vercelAiGatewayApiKey", "ulkaLastPanelError"]);
  const build = await fetch("manifest.json").then(response => response.json());
  const buildInfo = await fetch("build-info.json").then(response => response.json()).catch(() => null);
  return JSON.stringify({ format: "ulka-diagnostics-v1", exportedAt: new Date().toISOString(), version: build.version, build: buildInfo, browser: navigator.userAgent, panelError: stored.ulkaLastPanelError ?? null, events: sanitize(stored[LOG_KEY] ?? [], "", [String(stored.vercelAiGatewayApiKey ?? "")]) }, null, 2);
}
diagnostics.querySelector("#download-logs")!.addEventListener("click", async () => {
  try {
    const url = URL.createObjectURL(new Blob([await report()], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `ulka-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    logStatus.textContent = "Logs downloaded. Review and remove private data before sharing.";
  } catch { logStatus.textContent = "Could not export logs. Try reopening Ulka."; }
});
diagnostics.querySelector("#copy-logs")!.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(await report()); logStatus.textContent = "Logs copied."; }
  catch { logStatus.textContent = "Clipboard unavailable. Use Download logs."; }
});
void chromeApi.storage.local.get("vercelAiGatewayApiKey").then((stored) => {
  if (typeof stored.vercelAiGatewayApiKey === "string" && stored.vercelAiGatewayApiKey) {
    apiKey.value = stored.vercelAiGatewayApiKey; keyStatus.textContent = "Saved";
  }
});
document.querySelector("#save-key")!.addEventListener("click", async () => {
  const value = apiKey.value.trim();
  if (!value) { keyStatus.textContent = "Key required"; return; }
  await chromeApi.storage.local.set({ vercelAiGatewayApiKey: value });
  keyStatus.textContent = "Saved";
});
document.querySelector("#send")!.addEventListener("click", async () => {
  const content = prompt.value.trim();
  if (!content || busy || !historyReady) return;
  document.querySelector("#welcome")?.remove();
  busy = true; document.body.dataset.busy = "true"; send.disabled = true; engine.disabled = true; stop.hidden = false;
  const started = Date.now();
  const timer = setInterval(() => { document.querySelector("#elapsed")!.textContent = `${Math.floor((Date.now() - started) / 1000)}s`; }, 1000);
  messages.push({ role: "user", content }); appendMessage("user", content); prompt.value = ""; state.textContent = "Thinking"; trace.textContent = ""; progress.textContent = "Understanding your request";
  thinking = document.createElement('details'); thinking.className = 'thinking-box'; thinking.open = true;
  const thinkingSummary = document.createElement('summary'); thinkingSummary.textContent = 'Thinking';
  thinkingBody = document.createElement('div'); thinkingBody.className = 'thinking-content'; thinkingBody.textContent = 'Working on your request. Reasoning appears here when provided by the model.';
  thinking.append(thinkingSummary, thinkingBody); chat.append(thinking); thinkingText = '';
  streaming = appendMessage("assistant", ""); streaming.classList.add("streaming");
  streamedText = ''; saveConversation(); newButton.disabled = true; renderHistory();
  let response: { ok?: boolean; result?: { reply?: string }; error?: string };
  try { response = await chromeApi.runtime.sendMessage({ type: "CHAT", messages }) as typeof response; }
  catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : "Extension connection lost" };
    void chromeApi.storage.local.set({ ulkaLastPanelError: { at: new Date().toISOString(), error: sanitize(error, "", [apiKey.value]) } }).catch(() => {});
    logStatus.textContent = "Connection failed. Download logs and include this error.";
  }
  const reply = response.ok ? response.result?.reply ?? "Done." : response.error ?? "Request failed";
  if (thinking) { thinking.open = false; thinking.querySelector('summary')!.textContent = response.ok ? 'Thinking finished' : 'Thinking stopped'; }
  thinking = undefined; thinkingBody = undefined;
  messages.push({ role: "assistant", content: reply }); renderMarkdown(streaming, reply); streaming.classList.remove("streaming"); streaming.classList.toggle("error", !response.ok); streaming = undefined;
  saveConversation(); newButton.disabled = false;
  clearInterval(timer); busy = false; document.body.dataset.busy = "false"; send.disabled = false; engine.disabled = false; stop.hidden = true;
  if (approval.open) approval.close();
  state.textContent = response.ok ? "Ready" : "Needs attention";
  progress.textContent = response.ok ? "Run finished. Review the response above." : "Request failed. Diagnostics available in settings.";
});
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); (document.querySelector("#send") as HTMLButtonElement).click(); }
});
prompt.addEventListener('input', () => { prompt.style.height = 'auto'; prompt.style.height = `${Math.min(prompt.scrollHeight, 180)}px`; });
stop.addEventListener("click", () => { state.textContent = "Stopping…"; void chromeApi.runtime.sendMessage({ type: "STOP" }); });
chromeApi.runtime.onMessage.addListener((raw) => {
  const message = raw as { type?: string; state?: string; event?: unknown; operation?: string; label?: string; id?: number; error?: string; text?: string; request?: ApprovalRequest; approvalId?: string };
  if (message.type === 'FX_REASONING' && message.text && busy && thinkingBody) {
    thinkingText += message.text; renderMarkdown(thinkingBody, thinkingText);
  }
  if (message.type === "FX_PROGRESS" && message.text && streaming) {
    const follow = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
    streamedText += message.text; renderMarkdown(streaming, streamedText);
    if (follow) chat.scrollTop = chat.scrollHeight;
  }
  if (message.type === "STATE" && message.state && busy) state.textContent = message.state.toLowerCase().replaceAll("_", " ");
  if (message.type === "TRACE" && message.event) {
    trace.textContent = `${trace.textContent}${JSON.stringify(message.event)}\n`.slice(-40000);
    const event = message.event as { type?: string; step?: number; detail?: { operation?: string; elements?: number } };
    if (busy) progress.textContent = event.type === "observe" ? `Checking page · ${event.detail?.elements ?? 0} controls` : event.type === "execute" ? `Step ${event.step} · ${event.detail?.operation?.toLowerCase().replaceAll("_", " ")}` : event.type === "stale" ? "Page changed. Checking again…" : progress.textContent;
  }
  if (message.type === 'APPROVAL_CLOSED' && message.approvalId === approvalId) {
    approvalId = undefined;
    if (approval.open) approval.close();
  }
  if (message.type === "APPROVAL_REQUIRED" && message.request) {
    approvalId = message.request.id;
    approvalText.textContent = formatApprovalRequest(message.request);
    if (!approval.open) approval.showModal();
  }
  if (message.type === "DOWNLOAD_STATUS") appendMessage("assistant", message.error ? `Download failed: ${message.error}` : `Download ${message.id ?? ""} completed.`);
});
document.querySelector("#approve")!.addEventListener("click", () => respondToApproval(true));
document.querySelector("#deny")!.addEventListener("click", () => respondToApproval(false));
approval.addEventListener("cancel", event => { event.preventDefault(); respondToApproval(false); });

function respondToApproval(approved: boolean) {
  const id = approvalId;
  approvalId = undefined;
  approval.close();
  if (id) void chromeApi.runtime.sendMessage({ type: "APPROVAL_RESPONSE", approvalId: id, approved });
}

function appendMessage(role: "user" | "assistant", content: string, error = false) {
  const element = document.createElement("div");
  element.className = `message ${role}${error ? " error" : ""}`;
  if (role === 'assistant') renderMarkdown(element, content); else element.textContent = content;
  chat.append(element); chat.scrollTop = chat.scrollHeight;
  return element;
}
