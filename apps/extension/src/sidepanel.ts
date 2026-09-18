import { preservePartialResponse } from './partial-response';
import { createUserQuestionPanel } from './user-question-panel';
import type { PendingQuestion } from './agent/user-question';
import type { UsageSummary } from "./agent/model-usage";
import { renderUsage } from "./usage-display";
import { createChatScroll } from "./chat-scroll";
import { chromeApi } from "./chrome";
import { LOG_KEY, sanitize } from "./diagnostics";
import type { ConversationMessage } from "./agent/conversation";
import { renderMarkdown } from "./markdown";
import { formatApprovalRequest, type ApprovalRequest } from './agent/approval-request';
import { LANGUAGE_MODEL } from "./agent/models";

const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const apiKey = document.querySelector<HTMLInputElement>("#api-key")!;
document.querySelector<HTMLElement>("#model-name")!.textContent = LANGUAGE_MODEL;
const keyStatus = document.querySelector<HTMLElement>("#key-status")!;
const state = document.querySelector<HTMLElement>("#state")!;
const chat = document.querySelector<HTMLElement>("#chat")!;
const chatScroll = createChatScroll(chat);
const trace = document.querySelector<HTMLElement>("#trace")!;
type ChatMessage = ConversationMessage & { usage?: UsageSummary; usageIncomplete?: boolean; clarification?: { question: string; answer: string } };
const messages: ChatMessage[] = [];
let usageElement: HTMLElement | undefined;
let currentUsage: UsageSummary | undefined;
let usageRequestId: string | undefined;
type SavedChat = { id: string; title: string; messages: ChatMessage[] };
let conversations: SavedChat[] = [];
let currentId: string = crypto.randomUUID();
let historyReady = false;
let streamedText = '';
let committedReply = '';
let thinking: HTMLDetailsElement | undefined;
let thinkingBody: HTMLElement | undefined;
let thinkingText = '';
let thinkingScroll: ReturnType<typeof createChatScroll> | undefined;
let saveQueue = Promise.resolve();
// Large searchable history dropdown, keeping the existing local chat storage.
const header = document.querySelector('header')!;
const settingsPanel = document.querySelector<HTMLElement>('#settings')!;
const settingsButton = document.querySelector<HTMLButtonElement>('#settings-toggle')!;
header.append(settingsPanel);
function closeSettings(restoreFocus = false) {
  settingsPanel.hidden = true; settingsButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) settingsButton.focus();
}
document.addEventListener('click', event => {
  if (!settingsPanel.hidden && !settingsPanel.contains(event.target as Node) && !settingsButton.contains(event.target as Node)) closeSettings();
});
settingsPanel.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeSettings(true); }
});
settingsPanel.addEventListener('focusout', event => {
  if (event.relatedTarget && !settingsPanel.contains(event.relatedTarget as Node) && event.relatedTarget !== settingsButton) closeSettings();
});
const historyPanel = document.createElement('section'); historyPanel.id = 'history'; historyPanel.hidden = true;
historyPanel.setAttribute('aria-label', 'Previous chats');
const historyButton = document.createElement('button'); historyButton.id = 'history-toggle'; historyButton.textContent = 'Chats';
const historyChevron = document.createElement('span'); historyChevron.className = 'history-chevron'; historyChevron.setAttribute('aria-hidden', 'true'); historyButton.append(historyChevron); historyButton.setAttribute('aria-label', 'Open previous chats');
historyButton.setAttribute('aria-controls', 'history'); historyButton.setAttribute('aria-expanded', 'false');
const newButton = document.createElement('button'); newButton.id = 'new-chat'; newButton.textContent = '+'; newButton.title = 'New chat'; newButton.setAttribute('aria-label', 'New chat');
header.append(historyButton, newButton, historyPanel);
const historyHeading = document.createElement('div'); historyHeading.className = 'history-heading';
const historyTitle = document.createElement('strong'); historyTitle.textContent = 'Your chats';
const historyCount = document.createElement('span'); historyCount.className = 'hint';
historyHeading.append(historyTitle, historyCount);
const historySearch = document.createElement('input'); historySearch.type = 'search'; historySearch.placeholder = 'Search chats…'; historySearch.setAttribute('aria-label', 'Search previous chats');
const historyList = document.createElement('div'); historyList.className = 'history-list';
const historyNote = document.createElement('p'); historyNote.className = 'hint history-note';
historyPanel.append(historyHeading, historySearch, historyList, historyNote);
function closeHistory(restoreFocus = false) {
  historyPanel.hidden = true; historyButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) historyButton.focus();
}
historyButton.addEventListener('click', () => {
  if (!historyPanel.hidden) { closeHistory(); return; }
  historyPanel.hidden = false; historyButton.setAttribute('aria-expanded', 'true');
  document.querySelector<HTMLElement>('#settings')!.hidden = true;
  document.querySelector('#settings-toggle')!.setAttribute('aria-expanded', 'false');
  historySearch.value = ''; renderHistory(); historySearch.focus();
});
historySearch.addEventListener('input', renderHistory);
document.addEventListener('click', event => {
  if (!historyPanel.hidden && !historyPanel.contains(event.target as Node) && !historyButton.contains(event.target as Node)) closeHistory();
});
header.addEventListener('focusout', event => {
  if (event.relatedTarget && !header.contains(event.relatedTarget as Node)) closeHistory();
});
historyPanel.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeHistory(true); }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const items = Array.from(historyList.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    event.preventDefault();
    if (next < 0) historySearch.focus(); else items[Math.min(next, items.length - 1)]?.focus();
  }
});
newButton.addEventListener('click', () => { if (busy || !historyReady) return; currentId = crypto.randomUUID(); messages.length = 0; chat.replaceChildren(); chatScroll.bottom(); prompt.value = ''; closeHistory(); appendMessage('assistant', 'What would you like to do?'); prompt.focus(); });
function renderHistory() {
  historyList.replaceChildren();
  historyCount.textContent = `${conversations.length} saved`;
  historyNote.textContent = busy ? 'Task running. Switch chats when it finishes.' : 'Saved in this browser.';
  const query = historySearch.value.trim().toLocaleLowerCase();
  const entries = conversations.filter(entry => entry.title.toLocaleLowerCase().includes(query) || entry.messages.some(message => message.content.toLocaleLowerCase().includes(query)));
  if (!historyReady || !entries.length) {
    const empty = document.createElement('p'); empty.className = 'history-empty';
    empty.textContent = !historyReady ? 'Loading chats…' : conversations.length ? 'No chats match your search.' : 'No chats yet. Start a conversation below.';
    historyList.append(empty);
  }
  for (const entry of entries) {
    const button = document.createElement('button'); button.className = 'history-entry'; button.disabled = busy; button.setAttribute('aria-current', String(entry.id === currentId));
    const title = document.createElement('span'); title.className = 'history-entry-title'; title.textContent = entry.title;
    const preview = document.createElement('span'); preview.className = 'history-entry-preview'; preview.textContent = entry.messages.at(-1)?.content.replace(/\s+/g, ' ').slice(0, 160) ?? '';
    const copy = document.createElement('span'); copy.className = 'history-entry-copy'; copy.append(title, preview);
    const indicator = document.createElement('span'); indicator.className = 'history-entry-indicator'; indicator.setAttribute('aria-hidden', 'true'); indicator.textContent = entry.id === currentId ? '✓' : '›';
    button.append(copy, indicator); button.title = entry.title;
    button.addEventListener('click', () => { if (busy) return; currentId = entry.id; messages.splice(0, messages.length, ...entry.messages); chat.replaceChildren(); for (const message of messages) { appendMessage(message.role, message.content, false, message.clarification); if (message.role === "assistant") appendUsage(message.usage, false, message.usageIncomplete); } chatScroll.bottom(); closeHistory(); prompt.focus(); });
    historyList.append(button);
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
}).finally(() => { historyReady = true; renderHistory(); });
const approval = document.querySelector<HTMLDialogElement>("#approval")!;
const approvalText = document.querySelector<HTMLElement>("#approval-text")!;
let approvalId: string | undefined;
const engine = document.querySelector<HTMLSelectElement>("#engine")!;
const taskMode = document.querySelector<HTMLSelectElement>("#task-mode")!;
void chromeApi.storage.local.get("ulkaBackground").then(stored => { taskMode.value = stored.ulkaBackground === true ? "background" : "foreground"; });
taskMode.addEventListener("change", () => void chromeApi.storage.local.set({ ulkaBackground: taskMode.value === "background" }));
void chromeApi.storage.local.get("ulkaEngine").then(stored => { engine.value = stored.ulkaEngine === "classic" ? "classic" : "fx"; });
engine.addEventListener("change", () => void chromeApi.storage.local.set({ ulkaEngine: engine.value }));
const progress = document.querySelector<HTMLElement>("#activity-detail")!;
const diagnostics = document.querySelector<HTMLElement>("#diagnostics")!;
const send = document.querySelector<HTMLButtonElement>("#send")!;
const stop = document.querySelector<HTMLButtonElement>("#stop")!;
let busy = false;
const questionPanel = createUserQuestionPanel(document.querySelector<HTMLElement>('#user-question')!, message => chromeApi.runtime.sendMessage(message), (question, answer) => {
  chatScroll.update(() => {
    // Seal pre-question output before inserting the answer and continuing below it.
    if (streaming) {
      if (streamedText.trim()) {
        messages.push({ role: 'assistant', content: streamedText });
        streaming.classList.remove('streaming');
      } else streaming.remove();
      committedReply += streamedText; streamedText = '';
    }
    const content = `Answer to clarification ${JSON.stringify(question)}: ${answer}`;
    messages.push({ role: 'user', content, clarification: { question, answer } });
    appendMessage('user', content, false, { question, answer });
    if (busy) {
      streaming = appendMessage('assistant', ''); streaming.classList.add('streaming');
      if (usageElement) chat.append(usageElement);
    }
    saveConversation(); state.textContent = 'Continuing…';
  });
});
void chromeApi.runtime.sendMessage({ type: 'GET_USER_QUESTION' }).then(raw => {
  const response = raw as { question?: PendingQuestion };
  if (response?.question) { questionPanel.show(response.question); state.textContent = 'Waiting for your answer'; stop.hidden = false; send.disabled = true; }
}).catch(() => {});

let streaming: HTMLElement | undefined;
document.querySelector("#settings-toggle")!.addEventListener("click", event => {
  const settings = document.querySelector<HTMLElement>("#settings")!;
  settings.hidden = !settings.hidden;
  closeHistory();
  (event.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!settings.hidden));
  if (!settings.hidden) settings.querySelector<HTMLInputElement>("input")?.focus();
});
document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach(button => button.addEventListener("click", () => { prompt.value = button.dataset.prompt!; prompt.focus(); }));
const logStatus = diagnostics.querySelector<HTMLElement>("#log-status")!;
diagnostics.querySelector<HTMLButtonElement>('#test-model')!.addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  logStatus.textContent = 'Testing model connection…';
  try {
    const response = await chromeApi.runtime.sendMessage({ type: 'TEST_MODEL' }) as {
      ok: boolean; error?: string; results?: Array<{ check: string; status: string; transport: { status?: number } }>;
    };
    if (!response.ok) throw new Error(response.error ?? 'Model test failed');
    logStatus.textContent = response.results!.map(result => `${result.check}: ${result.status}${result.transport.status ? ` (HTTP ${result.transport.status})` : ''}`).join('; ') + '. Copy logs for details.';
  } catch (error) { logStatus.textContent = error instanceof Error ? error.message : 'Model test failed'; }
  finally { button.disabled = false; }
});
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
  busy = true; document.body.dataset.busy = "true"; send.disabled = true; engine.disabled = true; taskMode.disabled = true; stop.hidden = false;
  const started = Date.now();
  const timer = setInterval(() => { document.querySelector("#elapsed")!.textContent = `${Math.floor((Date.now() - started) / 1000)}s`; }, 1000);
  messages.push({ role: "user", content }); appendMessage("user", content); chatScroll.bottom(); prompt.value = ""; prompt.style.height = ""; state.textContent = "Thinking"; trace.textContent = ""; progress.textContent = "Understanding your request";
  thinking = document.createElement('details'); thinking.className = 'thinking-box'; thinking.open = true; thinking.hidden = true;
  const thinkingSummary = document.createElement('summary'); thinkingSummary.textContent = 'Thinking';
  thinkingBody = document.createElement('div'); thinkingBody.className = 'thinking-content'; thinkingBody.textContent = 'Working on your request…';
  thinkingScroll = createChatScroll(thinkingBody);
  thinking.append(thinkingSummary, thinkingBody); chat.append(thinking); thinkingText = '';
  streaming = appendMessage("assistant", ""); streaming.classList.add("streaming");
  currentUsage = undefined; usageRequestId = crypto.randomUUID();
  usageElement = appendUsage(undefined, true);
  streamedText = ''; committedReply = ''; saveConversation(); newButton.disabled = true; renderHistory();
  let response: { ok?: boolean; result?: { reply?: string; partialReply?: string; interruptionReason?: string; status?: string; result?: { status?: string } }; error?: string; usage?: UsageSummary };
  try { response = await chromeApi.runtime.sendMessage({ type: "CHAT", requestId: usageRequestId, messages: messages.map(({ role, content }) => ({ role, content })) }) as typeof response; }
  catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : "Extension connection lost" };
    void chromeApi.storage.local.set({ ulkaLastPanelError: { at: new Date().toISOString(), error: sanitize(error, "", [apiKey.value]) } }).catch(() => {});
    logStatus.textContent = "Connection failed. Download logs and include this error.";
  }
  currentUsage = response.usage ?? currentUsage;
  const runStatus = response.result?.status ?? response.result?.result?.status;
  const usageIncomplete = !response.ok || runStatus === 'stopped' || runStatus === 'blocked';
  renderUsage(usageElement!, currentUsage, false, usageIncomplete);
  usageElement = undefined; usageRequestId = undefined;
  const remainingReply = (text: string) => committedReply && text.startsWith(committedReply) ? text.slice(committedReply.length).trimStart() : text;
  const finalReply = response.ok ? remainingReply(response.result?.reply ?? "Done.") : response.error ?? "Request failed";
  const partial = response.result?.partialReply ? remainingReply(response.result.partialReply) : streamedText;
  const reply = usageIncomplete
    ? response.result?.interruptionReason
      ? preservePartialResponse(partial, response.result.interruptionReason)
      : preservePartialResponse(partial, finalReply)
    : finalReply;
  chatScroll.update(() => {
  if (thinkingBody && thinkingText) renderMarkdown(thinkingBody, thinkingText);
  if (thinking) {
    thinking.open = usageIncomplete && !!thinkingText;
    thinking.querySelector('summary')!.textContent = usageIncomplete ? 'Thinking interrupted' : 'Thinking finished';
  }
  thinking = undefined; thinkingBody = undefined; thinkingScroll = undefined;
  messages.push({ role: "assistant", content: reply, usage: currentUsage, usageIncomplete }); renderMarkdown(streaming!, reply); streaming!.classList.remove("streaming"); streaming!.classList.toggle("error", !response.ok); streaming = undefined;
  saveConversation(); newButton.disabled = false;
  clearInterval(timer); busy = false; renderHistory(); document.body.dataset.busy = "false"; send.disabled = false; engine.disabled = false; taskMode.disabled = false; stop.hidden = true;
  if (approval.open) approval.close();
  questionPanel.close();
  state.textContent = runStatus === "stopped" ? "Stopped" : usageIncomplete ? "Needs attention" : "Ready";
  progress.textContent = usageIncomplete ? "Run incomplete. Partial response preserved above." : "Run finished. Review the response above.";
  });
});
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); (document.querySelector("#send") as HTMLButtonElement).click(); }
});
prompt.addEventListener('input', () => { prompt.style.height = 'auto'; prompt.style.height = `${Math.min(prompt.scrollHeight, 180)}px`; });
stop.addEventListener("click", () => { state.textContent = "Stopping…"; void chromeApi.runtime.sendMessage({ type: "STOP" }); });
chromeApi.runtime.onMessage.addListener((raw) => {
  const message = raw as { type?: string; requestId?: string; usage?: UsageSummary; state?: string; event?: unknown; operation?: string; label?: string; id?: number; error?: string; text?: string; request?: ApprovalRequest; approvalId?: string; question?: PendingQuestion; questionId?: string };
  if (message.type === 'USER_QUESTION' && message.question) {
    questionPanel.show(message.question); state.textContent = 'Waiting for your answer';
    progress.textContent = 'Answer below to continue. Your task progress is preserved.';
  }
  if (message.type === 'USER_QUESTION_CLOSED') { questionPanel.close(message.questionId); if (!busy) { send.disabled = false; stop.hidden = true; } }
  if (message.type === 'MODEL_USAGE' && message.requestId === usageRequestId && busy && usageElement && message.usage) {
    currentUsage = message.usage;
    chatScroll.update(() => renderUsage(usageElement!, currentUsage, true));
  }
  if (message.type === 'FX_REASONING'  && message.text && busy && thinkingBody) {
    thinkingText += message.text;
    if (thinking && thinkingText.trim()) thinking.hidden = false;
    chatScroll.update(() => thinkingScroll?.update(() => renderMarkdown(thinkingBody!, thinkingText)));
  }
  if (message.type === "FX_PROGRESS" && message.text && streaming) {
    streamedText += message.text;
    chatScroll.update(() => renderMarkdown(streaming!, streamedText));
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

function appendMessage(role: "user" | "assistant", content: string, error = false, clarification?: { question: string; answer: string }) {
  const element = document.createElement("div");
  element.className = `message ${role}${error ? " error" : ""}`;
  if (clarification) {
    element.className = 'message clarification';
    const label = document.createElement('span'); label.className = 'clarification-label'; label.textContent = 'Answered';
    const question = document.createElement('div'); question.className = 'clarification-question'; question.textContent = clarification.question;
    const answer = document.createElement('div'); answer.className = 'clarification-answer'; answer.textContent = clarification.answer;
    element.append(label, question, answer);
  } else if (role === 'assistant') renderMarkdown(element, content); else element.textContent = content;
  chatScroll.update(() => chat.append(element));
  return element;
}

function appendUsage(usage?: UsageSummary, running = false, incomplete = false) {
  const element = document.createElement('div');
  renderUsage(element, usage, running, incomplete);
  chatScroll.update(() => chat.append(element));
  return element;
}
