import { UserQuestionGate } from './agent/user-question';
import { testModelConnection } from './agent/model-connection';
import { loadModelPrices } from "./agent/model-pricing";
import { ModelUsageLedger } from "./agent/model-usage";
import { AgentRunner, type TaskMemory } from "./agent/agent-runner";
import { ApprovalGate, createApprovalRequest } from './agent/approval-request';
import { createTaskObserver } from "./agent/task-observer";
import { AttachedBrowser } from "./agent/browser";
import { VercelJevDecisionEngine } from "./agent/vercel-jev";
import { AgentStateMachine } from "./agent/state-machine";
import { ConversationPlanner, type ConversationMessage } from "./agent/conversation";
import { TextGenerator } from "./agent/text-generator";
import { OutcomeVerifier } from "./agent/outcome-verifier";
import { PageAnswerer } from "./agent/page-answerer";
import { chromeApi } from "./chrome";
import { beginLog, log } from "./diagnostics";
import { reuseOpenTab, waitForNavigation, validateNavigationUrl, internalPageSnapshot } from "./agent/navigation";
import { LANGUAGE_MODEL } from "./agent/models";
import { runFxBrowser } from "./agent/fx-agent";
import { NativeTabs } from './agent/native-tabs';
import { listDownloads } from './agent/downloads';
import { readPageExpression } from './agent/read-page';
import { evaluate } from './agent/cdp';
import { WebMcpBridge } from './agent/webmcp';
import type { PageSnapshot } from "../../../packages/protocol/src";

let activeRunner: AgentRunner | undefined;
let activeFx: AbortController | undefined;
let busy = false;
let usageLedger = new ModelUsageLedger();
let usageRequestId: string | undefined;
const publishUsage = () => { void chromeApi.runtime.sendMessage({ type: 'MODEL_USAGE', requestId: usageRequestId, usage: usageLedger.summary() }).catch(() => {}); };
const reportUsage = (stage: string, usage: unknown) => { usageLedger.record(stage, usage); publishUsage(); };
const overlayTabs = new Set<number>();
async function showOverlay(tabId: number) {
  overlayTabs.add(tabId);
  await chromeApi.tabs.sendMessage(tabId, { type: 'ULKA_OVERLAY', active: true }).catch(() => {});
}
async function hideOverlays() {
  const ids = [...overlayTabs]; overlayTabs.clear();
  await Promise.all(ids.map(id => chromeApi.tabs.sendMessage(id, { type: 'ULKA_OVERLAY', active: false }).catch(() => {})));
}
const approvalGate = new ApprovalGate();
const userQuestions = new UserQuestionGate();
void chromeApi.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chromeApi.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete" || delta.error?.current) void chromeApi.runtime.sendMessage({ type: "DOWNLOAD_STATUS", id: delta.id, state: delta.state?.current, error: delta.error?.current }).catch(() => {});
});

chromeApi.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const message = raw as { type?: string; requestId?: string; goal?: string; messages?: ConversationMessage[]; approved?: boolean; approvalId?: string; questionId?: string; answer?: unknown };
  if (message.type === 'GET_USER_QUESTION') { sendResponse({ question: userQuestions.current }); return; }
  if (message.type === 'USER_ANSWER') { sendResponse({ ok: userQuestions.respond(message.questionId, message.answer) }); return; }
  if (message.type === "APPROVAL_RESPONSE") { sendResponse({ ok: approvalGate.respond(message.approvalId, message.approved === true) }); return; }
  if (message.type === "STOP") { void log("stop_requested"); activeFx?.abort(); userQuestions.cancel(); activeRunner?.stop(); approvalGate.cancel(); sendResponse({ ok: true }); return; }
  if (message.type === 'TEST_MODEL') {
    if (busy) { sendResponse({ ok: false, error: 'Wait for the current task to finish before testing the model.' }); return; }
    busy = true;
    beginLog('TEST_MODEL');
    void (async () => {
      const stored = await chromeApi.storage.local.get(['vercelAiGatewayApiKey']);
      const key = stored.vercelAiGatewayApiKey;
      if (typeof key !== 'string' || !key.trim()) throw new Error('Save Vercel AI Gateway API key first');
      const results = await testModelConnection(key);
      await log('model_connection_test', { results });
      return results;
    })().then(results => sendResponse({ ok: true, results }))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Model test failed' }))
      .finally(() => { busy = false; });
    return true;
  }
  if (message.type !== "CHAT" && message.type !== "START") return;
  if (busy) { sendResponse({ ok: false, error: "A task is already running. Stop it before starting another." }); return; }
  busy = true;
  beginLog(message.type);
  usageLedger = new ModelUsageLedger();
  usageRequestId = message.requestId;
  const ledger = usageLedger;
  const pricing = loadModelPrices().then(prices => { ledger.setPrices(prices); if (usageLedger === ledger) publishUsage(); });
  const task = message.type === "CHAT" ? chat(message.messages ?? []) : run(message.goal ?? "");
  void task
    .then(async (result) => { await pricing; await log("result", result); sendResponse({ ok: true, result, usage: ledger.summary() }); })
    .catch(async (error) => { await pricing; await log("error", error); void chromeApi.runtime.sendMessage({ type: "STATE", state: "ERROR" }).catch(() => {}); sendResponse({ ok: false, error: error instanceof Error ? error.message : "Agent failed", usage: ledger.summary() }); })
    .finally(async () => { await log("model_usage_summary", usageLedger.summary()); await hideOverlays(); busy = false; });
  return true;
});

async function chat(messages: ConversationMessage[]) {
  const stored = await chromeApi.storage.local.get(["vercelAiGatewayApiKey", "ulkaEngine", "ulkaBackground"]);
  const apiKey = stored.vercelAiGatewayApiKey;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Save Vercel AI Gateway API key first");
  const background = stored.ulkaBackground === true;
  const [taskTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (stored.ulkaEngine !== "classic") return fxChat(messages, apiKey, taskTab?.id, background);
  void log("planner_start", { model: LANGUAGE_MODEL });
  const intent = await new ConversationPlanner(apiKey, undefined, reportUsage).interpret(messages);
  void log("planner_result", intent);
  if (intent.shouldReadPage) {
    const page = await observeTaskPage(taskTab?.id);
    const answer = await new PageAnswerer(apiKey, undefined, reportUsage).answer(messages, page);
    return { reply: answer.answer, evidence: answer.evidence };
  }
  if (!intent.shouldAct) return { reply: intent.reply };
  if (intent.navigationUrl) {
    const url = validateNavigationUrl(intent.navigationUrl);
    if (!taskTab?.id) throw new Error("No active tab");
    void log("navigation_start", { url, tabId: taskTab.id });
    await chromeApi.tabs.update(taskTab.id, { url });
    await waitForNavigation(taskTab.id, () => chromeApi.tabs.query({}));
    void log("navigation_ready", { tabId: taskTab.id, continueTask: true });
  }
  const result = await run(intent.goal, apiKey, taskTab?.id, undefined, undefined, background);
  const outcome = result.status === "done"
    ? "Done."
    : result.status === "stopped"
      ? "Stopped."
      : `I couldn't complete that: ${result.reason ?? "no supported action"}`;
  return { reply: `${intent.reply} ${outcome}`.trim(), goal: intent.goal, result };
}

async function fxChat(messages: ConversationMessage[], apiKey: string, initialTabId?: number, background = false) {
  if (!initialTabId) throw new Error("No active tab");
  let taskTabId = initialTabId;
  const taskMemory: TaskMemory = { history: [], attempts: new Map() };
  const controller = new AbortController(); activeFx = controller;
  const nativeTabs = new NativeTabs(chromeApi, background, {
    taskTabId: () => taskTabId, signal: controller.signal,
    approveClose: async tabs => {
      controller.signal.throwIfAborted();
      const request = {
        id: crypto.randomUUID(), operation: 'CLOSE_TAB',
        label: tabs.map(tab => `${tab.title || tab.url || 'Untitled'} (tab ${tab.id})`).join(', '),
        origin: [...new Set(tabs.map(tab => { try { const url = new URL(tab.url ?? 'about:blank'); return url.origin === 'null' ? url.protocol : url.origin; } catch { return 'Unknown'; } }))].join(', '),
      };
      const cancel = () => approvalGate.cancel();
      controller.signal.addEventListener('abort', cancel, { once: true });
      try { return await approvalGate.request(request.id, () => chromeApi.runtime.sendMessage({ type: 'APPROVAL_REQUIRED', request })); }
      finally {
        controller.signal.removeEventListener('abort', cancel);
        void chromeApi.runtime.sendMessage({ type: 'APPROVAL_CLOSED', approvalId: request.id }).catch(() => {});
      }
    },
  });
  // Chrome API activity keeps the MV3 worker alive during streamed model responses.
  const keepAlive = setInterval(() => void chromeApi.storage.local.get("ulkaEngine"), 20_000);
  const observe = async () => {
    controller.signal.throwIfAborted();
    await showOverlay(taskTabId);
    const { tabs } = await nativeTabs.list();
    const tab = tabs.find(item => item.id === taskTabId);
    if (!tab) throw new Error("Task tab was closed.");
    if (!tab.url?.startsWith("http")) return { tabId: taskTabId, page: { url: tab.url, notice: "Internal browser page. Navigate to a website before observing its document." }, tabs };
    const browser = new AttachedBrowser(chromeApi.debugger, { tabId: taskTabId });
    await browser.attach();
    try {
      const page = await browser.observer.observe();
      const webmcp = await new WebMcpBridge(chromeApi.debugger, { tabId: taskTabId }).discover(controller.signal);
      return { tabId: taskTabId, page: { url: page.url, title: page.title, text: page.text, elements: page.elements }, tabs, webmcp };
    } finally { await browser.detach(); }
  };
  try {
    void log("fx_start", { model: LANGUAGE_MODEL, background });
    const result = await runFxBrowser(apiKey, messages, {
      background,
      webMcp: async (input, signal) => {
        signal.throwIfAborted();
        const target = { tabId: taskTabId };
        const browser = new AttachedBrowser(chromeApi.debugger, target);
        await browser.attach();
        let result;
        try {
          result = await new WebMcpBridge(chromeApi.debugger, target).execute(input, signal, async request => {
            const cancel = () => approvalGate.cancel();
            signal.addEventListener('abort', cancel, { once: true });
            try { return await approvalGate.request(request.id, () => chromeApi.runtime.sendMessage({ type: 'APPROVAL_REQUIRED', request })); }
            finally {
              signal.removeEventListener('abort', cancel);
              void chromeApi.runtime.sendMessage({ type: 'APPROVAL_CLOSED', approvalId: request.id }).catch(() => {});
            }
          });
        } finally { await browser.detach(); }
        signal.throwIfAborted();
        return result;
      },
      askUser: async (question, signal) => {
        let questionId: string | undefined;
        try {
          const answer = await userQuestions.ask(question, signal, async request => {
            questionId = request.id;
            await chromeApi.runtime.sendMessage({ type: 'USER_QUESTION', question: request });
            void log('user_question_pending', { questionId, optionCount: request.options?.length ?? 0 });
          });
          signal.throwIfAborted();
          messages.push({ role: 'user', content: `Answer to clarification ${JSON.stringify(question.question)}: ${answer}` });
          return { source: 'user_clarification', question: question.question, answer };
        } finally {
          void chromeApi.runtime.sendMessage({ type: 'USER_QUESTION_CLOSED', questionId }).catch(() => {});
        }
      },
      listDownloads: async input => {
        controller.signal.throwIfAborted();
        return listDownloads(chromeApi.downloads, input);
      },
      readPage: async (query, offset) => {
        controller.signal.throwIfAborted();
        const tab = (await chromeApi.tabs.query({})).find(tab => tab.id === taskTabId);
        if (!tab?.url || !/^https?:/.test(tab.url)) return { reading: { notice: 'Cannot read internal browser pages. Use native tab tools or navigate to a website.' } };
        const target = { tabId: taskTabId };
        const browser = new AttachedBrowser(chromeApi.debugger, target);
        await browser.attach();
        try { return await evaluate(chromeApi.debugger, target, readPageExpression(query, offset)); }
        finally { await browser.detach(); }
      },
      nativeTabs: async input => {
        controller.signal.throwIfAborted();
        const result = await nativeTabs.execute(input);
        if ('taskTabId' in result && typeof result.taskTabId === 'number') taskTabId = result.taskTabId;
        return result;
      },
      observe,
      navigate: async (value, newTab) => {
        controller.signal.throwIfAborted();
        const url = validateNavigationUrl(value);
        const existingId = await reuseOpenTab(chromeApi.tabs, url, background, taskTabId, controller.signal);
        if (existingId !== undefined) {
          taskTabId = existingId;
          void log('navigation_reused_tab', { tabId: existingId });
        } else if (newTab) {
          const created = await chromeApi.tabs.create({ url, active: !background });
          if (!created.id) throw new Error("Could not create tab"); taskTabId = created.id;
        } else await chromeApi.tabs.update(taskTabId, { url });
        await waitForNavigation(taskTabId, () => chromeApi.tabs.query({}));
        return observe();
      },
      act: async (goal, signal) => {
        controller.signal.throwIfAborted(); signal.throwIfAborted();
        const result = await run(goal, apiKey, taskTabId, signal, taskMemory, background);
        taskTabId = result.tabId;
        return { ...result, observation: await observe() };
      },
      verify: async (goal, evidence) => {
        controller.signal.throwIfAborted();
        return await new OutcomeVerifier(apiKey, controller.signal, reportUsage, { log: (event, data) => { void log(event, data); } }).verify(goal, await observeTaskPage(taskTabId), [], evidence);
      },
      log: (event, data) => {
        if (event === "fx_turn_end") reportUsage("fx_turn", (data as { usage?: unknown }).usage);
        void log(event, data);
      },
      progress: text => { void chromeApi.runtime.sendMessage({ type: "FX_PROGRESS", text }).catch(() => {}); },
      reasoning: text => { void chromeApi.runtime.sendMessage({ type: "FX_REASONING", text }).catch(() => {}); },
    }, controller.signal);
    void chromeApi.runtime.sendMessage({ type: "STATE", state: result.status.toUpperCase() }).catch(() => {});
    return result;
  } finally { clearInterval(keepAlive); activeFx = undefined; }
}

async function observeTaskPage(tabId?: number): Promise<PageSnapshot> {
  const tab = (await chromeApi.tabs.query({})).find(tab => tab.id === tabId);
  if (!tab?.id) throw new Error("No active tab");
  const internal = internalPageSnapshot(tab);
  if (internal) return internal;
  const browser = new AttachedBrowser(chromeApi.debugger, { tabId: tab.id });
  await browser.attach();
  try { return await browser.observer.observe(); } finally { await browser.detach(); }
}

export { validateNavigationUrl } from "./agent/navigation";

async function run(goal: string, suppliedApiKey?: string, taskTabId?: number, signal?: AbortSignal, taskMemory?: TaskMemory, backgroundMode?: boolean) {
  if (!goal.trim()) throw new Error("Goal required");
  const stored = suppliedApiKey ? {} : await chromeApi.storage.local.get(["vercelAiGatewayApiKey", "ulkaBackground"]);
  const background = backgroundMode ?? stored.ulkaBackground === true;
  const apiKey = suppliedApiKey ?? stored.vercelAiGatewayApiKey;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Save Vercel AI Gateway API key first");
  activeRunner?.stop();
  const tab = taskTabId ? (await chromeApi.tabs.query({})).find(item => item.id === taskTabId) : (await chromeApi.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) throw new Error("No active tab");
  let browser!: AttachedBrowser;
  const tabController = {
    open: async () => { const created = await chromeApi.tabs.create({ url: "about:blank", active: !background }); if (!created.id) throw new Error("Chrome did not create tab"); await browser.switchTo(created.id); },
    switch: async (tabId: number) => { if (!background) await chromeApi.tabs.update(tabId, { active: true }); await browser.switchTo(tabId); },
    close: async (tabId: number) => {
      if (background) {
        const tabs = await chromeApi.tabs.query({});
        if (tabs.some(tab => tab.id === tabId && tab.active)) throw new Error("Cannot close the visible tab in background mode. Switch tabs or use foreground mode.");
        if (browser.tabId === tabId) throw new Error("Switch the task to another tab before closing its current tab in background mode.");
      }
      const closingCurrent = browser.tabId === tabId; if (closingCurrent) await browser.detach(); await chromeApi.tabs.remove(tabId);
      if (closingCurrent) { const [next] = await chromeApi.tabs.query({ active: true, currentWindow: true }); if (!next?.id) throw new Error("No tab remains"); await browser.switchTo(next.id); }
    },
  };
  browser = new AttachedBrowser(chromeApi.debugger, { tabId: tab.id }, tabController);
  const states = new AgentStateMachine((state) => { void log("state", { state }); void chromeApi.runtime.sendMessage({ type: "STATE", state }).catch(() => {}); });
  states.transition("ATTACHING");
  await browser.attach();
  try {
    await showOverlay(browser.tabId);
    const observer = createTaskObserver(browser.observer,
      () => chromeApi.tabs.query({ currentWindow: true }),
      () => showOverlay(browser.tabId));
    const requests = new AbortController();
    const runner = new AgentRunner(observer, new VercelJevDecisionEngine(apiKey, undefined, requests.signal, reportUsage), browser.executor, states, {
      cancelRequests: () => requests.abort(),
      taskMemory,
      maxActions: signal ? 8 : 30,
      maxModelCalls: signal ? 16 : 60,
      onTrace: (event) => { void log(event.type, event); void chromeApi.runtime.sendMessage({ type: "TRACE", event }).catch(() => {}); },
      approve: async (decision, snapshot, text) => {
        const request = createApprovalRequest(decision, snapshot, text);
        try {
          return await approvalGate.request(request.id, () => chromeApi.runtime.sendMessage({ type: 'APPROVAL_REQUIRED', request }));
        } finally {
          void chromeApi.runtime.sendMessage({ type: 'APPROVAL_CLOSED', approvalId: request.id }).catch(() => {});
        }
      },
    }, new TextGenerator(apiKey, requests.signal, reportUsage, undefined, (event, data) => { void log(event, data); }), new OutcomeVerifier(apiKey, requests.signal, reportUsage, { log: (event, data) => { void log(event, data); } }));
    activeRunner = runner;
    const stop = () => { runner.stop(); approvalGate.cancel(); };
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) runner.stop();
    try { return { ...await runner.run(goal), tabId: browser.tabId }; }
    finally { signal?.removeEventListener("abort", stop); }
  } finally {
    activeRunner = undefined;
    await browser.detach();
  }
}
