import { preservePartialResponse } from '../partial-response';
import { createFxGatewayFetch } from './gateway-policy';
import { userQuestionSchema, type UserQuestion } from './user-question';
import { WEB_BROWSING_SKILL } from "./skills/web-browsing";
import { modelElement } from "./model-context";
import { currentTimeContext, TIME_RULES } from "./time-context";
import { createFxAgent, supportsJspi, type FxTool } from "libfx/browser";
import { z } from "zod";
import { LANGUAGE_MODEL } from "./models";
import type { ConversationMessage } from "./conversation-message";
import { downloadQuery } from './downloads';
import { VerificationUnavailableError } from './outcome-verifier';
import type { WebMcpCall } from './webmcp';
import { extractRequestSchema } from './page-extractor';
import { observedActionReferenceSchema, type ObservedActionReference } from './observed-actions';
import { UrlProvenance } from './url-provenance';
import { personalizationInstruction } from './personalization';

export interface FxBrowserHost {
  webMcp?(input: WebMcpCall, signal: AbortSignal): Promise<unknown>;
  background?: boolean;
  askUser?(question: UserQuestion, signal: AbortSignal): Promise<unknown>;
  listDownloads?(input: unknown): Promise<unknown>;
  readPage?(query: string, offset: number): Promise<unknown>;
  extractPage?(input: z.infer<typeof extractRequestSchema>, signal: AbortSignal): Promise<unknown>;
  actAction?(input: { goal: string; action: ObservedActionReference }, signal: AbortSignal): Promise<unknown>;
  nativeTabs?(input: { operation: string; tabIds: number[]; title?: string; url?: string }): Promise<unknown>;
  observe(instruction?: string): Promise<unknown>;
  navigate(url: string, newTab: boolean): Promise<unknown>;
  act(goal: string, signal: AbortSignal): Promise<unknown>;
  verify(goal: string, evidence?: TaskEvidence[]): Promise<{ satisfied: boolean; evidence: string }>;
  log(event: string, data: unknown): void;
  progress(text: string): void;
  reasoning?(text: string): void;
}

export interface TaskEvidence { tool: string; observedAt: string; result: string }

const milestoneSchema = z.object({
  goal: z.string().trim().min(1).max(200),
  status: z.enum(['pending', 'in_progress', 'done']),
});
type Milestone = z.infer<typeof milestoneSchema>;

function agentCapabilityContext(host: FxBrowserHost): string {
  const capabilities = [
    "observe_browser", "navigate_browser", "browser_subgoal", "search_web", "plan_task", "complete_task",
    ...(host.webMcp ? ["webmcp_call"] : []),
    ...(host.askUser ? ["ask_user"] : []),
    ...(host.readPage ? ["read_page"] : []),
    ...(host.extractPage ? ["extract_page"] : []),
    ...(host.actAction ? ["act_action"] : []),
    ...(host.nativeTabs ? ["native_tabs"] : []),
    ...(host.listDownloads ? ["list_downloads"] : []),
  ];
  return [
    `Your capabilities in this run are exactly these tools: ${capabilities.join(", ")}.`,
    "Tool schemas and returned observations define browser state and available actions.",
    "Choose the next useful step for the latest user request. Track multi-step work with plan_task when useful.",
    "Call complete_task when the requested outcome is supported. The host also checks browser evidence if your turn ends first. Never claim completion without observed evidence.",
  ].join(" ");
}

export async function runFxBrowser(apiKey: string, messages: ConversationMessage[], host: FxBrowserHost, signal: AbortSignal, runtime = { createFxAgent, supportsJspi }, personalization = '') {
  const urls = new UrlProvenance(messages);
  signal.throwIfAborted();
  if (!runtime.supportsJspi()) throw new Error("FX requires WebAssembly JSPI. Update Helium or use a browser that supports JSPI.");
  const taskTime = currentTimeContext();
  let toolCalls = 0;
  let toolElapsedMs = 0;
  let activeToolStarted: number | undefined;
  const measuredToolMs = () => toolElapsedMs + (activeToolStarted === undefined ? 0 : performance.now() - activeToolStarted);
  let partialReply = '';
  let plan: Milestone[] | undefined;
  let toolLimit = 24;
  const unfinished = (reply: string, status: 'blocked' | 'stopped') => ({ reply: preservePartialResponse(partialReply, reply), status, partialReply, interruptionReason: reply });
  let acted = false;
  let usedBrowserTool = false;
  const evidence: TaskEvidence[] = [];
  let safetyStop: string | undefined;
  let blockedSubgoals = 0;
  let totalBlockedSubgoals = 0;
  let consecutiveToolErrors = 0;
  let gatewayFailure: { status: number; requestId?: string } | undefined;
  const gatewayFailureReason = () => {
    if (!gatewayFailure) return undefined;
    const guidance = gatewayFailure.status === 403
      ? ' Check Gateway key permissions and ZDR route eligibility. The response status alone does not identify which restriction failed.'
      : ' Check Gateway service and model access.';
    return `Gateway rejected the model request (HTTP ${gatewayFailure.status}).${guidance} Work remains incomplete.`;
  };
  let consecutiveNavigations = 0;
  let lastPlannerPageFingerprint: string | undefined;
  let completed = false;
  const terminal = new AbortController();
  const turnSignal = AbortSignal.any([signal, terminal.signal]);
  const stop = (reason: string) => { safetyStop = reason; terminal.abort(); };
  let pendingTool: Promise<unknown> = Promise.resolve();
  const tool = (name: string, description: string, schema: z.ZodType, execute: (input: any, signal: AbortSignal) => Promise<unknown>): FxTool => ({
    name, description, inputSchema: z.toJSONSchema(schema),
    execute(input, context) {
      const task = pendingTool.catch(() => {}).then(async () => {
      signal.throwIfAborted(); context.signal.throwIfAborted();
      if (safetyStop) throw new Error(safetyStop);
      turnSignal.throwIfAborted();
      if (++toolCalls > toolLimit) {
        stop("Browser tool limit reached. Work remains unverified; review the partial progress above.");
        host.log("fx_budget_exhausted", { toolCalls });
        throw new Error(safetyStop);
      }
      const started = performance.now();
      activeToolStarted = started;
      try {
        const parsed = schema.parse(input);
        host.log("fx_tool_start", { name, toolCalls, operation: (parsed as { operation?: string }).operation });
        let result: unknown;
        if ((name === 'navigate_browser' || name === 'search_web') && consecutiveNavigations >= 2) {
          const pageRead = compactToolResult(host.readPage ? await host.readPage('', 0) : await host.observe());
          result = { status: 'checkpoint', reason: 'Navigation paused after two destinations. Inspect this page evidence before choosing the next destination. Requested navigation was not executed.', pageRead };
          consecutiveNavigations = 0;
          host.log('fx_navigation_checkpoint', { toolCalls });
        } else {
          result = compactToolResult(await execute(parsed, AbortSignal.any([context.signal, turnSignal])));
          if (name === 'ask_user' && result && typeof result === 'object' && (result as { source?: string }).source === 'user_clarification') {
            const answer = (result as { answer?: unknown }).answer;
            if (typeof answer === 'string') urls.recordUserText(answer);
            else if (answer && typeof answer === 'object' && typeof (answer as { answer?: unknown }).answer === 'string') urls.recordUserText((answer as { answer: string }).answer);
          }
          if (name === 'navigate_browser' || name === 'search_web') consecutiveNavigations++;
          if (name === 'read_page' || name === 'browser_subgoal') consecutiveNavigations = 0;
        }
        // Supply reading evidence for recovery, but preserve explicit no-progress failures.
        const checkpoint = result as { status?: string; reason?: string } | null;
        if (name === 'browser_subgoal' && checkpoint?.status === 'blocked' &&
            /^(Scroll checkpoint|Wait checkpoint|Scrolling produced no new readable content)/.test(checkpoint.reason ?? '') && host.readPage) {
          signal.throwIfAborted(); context.signal.throwIfAborted();
          const reading = compactToolResult(await host.readPage('', 0));
          const status = checkpoint.reason?.startsWith('Scroll checkpoint') ? 'checkpoint' : 'blocked';
          result = { ...checkpoint, status, pageRead: reading };
          host.log('fx_checkpoint_read', { toolCalls, status });
        }
        // Only browser-captured URLs can authorize later navigation.
        if (['observe_browser', 'navigate_browser', 'search_web', 'read_page', 'native_tabs', 'browser_subgoal', 'act_action'].includes(name)) urls.recordBrowserResult(result);
        if (!['plan_task', 'ask_user', 'complete_task'].includes(name)) usedBrowserTool = true;
        // Host-captured evidence, never model-authored claims of completion.
        // Keep valid structured evidence. Cutting JSON mid-control loses late-page
        // outcomes; the verifier packs repeated tables without dropping them.
        if (name !== 'plan_task') evidence.push({ tool: name, observedAt: new Date().toISOString(), result: JSON.stringify(result) ?? "null" });
        if (result && typeof result === "object" && "status" in result) {
          const outcome = result as { status: string; reason?: string; failure?: string; recentActions?: Array<{ pageChanged?: boolean }> };
          if (outcome.failure === 'text_generation_unavailable') stop(outcome.reason ?? 'Text generation unavailable. No text entered.');
          if (outcome.failure === 'task_budget_exhausted') stop(outcome.reason ?? 'Browser task budget exhausted. Review partial progress before continuing.');
          if (outcome.failure === 'verification_unavailable') stop(outcome.reason ?? 'Completion check unavailable. Work remains unverified.');
          if (outcome.failure === 'webmcp_uncertain') stop(outcome.reason ?? 'WebMCP result uncertain. Work remains unverified.');
          if (name === "browser_subgoal") {
            if (outcome.status === 'blocked') { blockedSubgoals++; totalBlockedSubgoals++; }
            else if (outcome.status === 'done' || (outcome.status === 'checkpoint' && outcome.recentActions?.some(action => action.pageChanged === true))) blockedSubgoals = 0;
            if (blockedSubgoals >= 2) stop(`Stopped after two blocked subgoals. ${outcome.reason ?? "No verified progress."}`);
            else if (totalBlockedSubgoals >= 4) stop(`Recovery budget exhausted after four blocked subgoals. ${outcome.reason ?? ''}`);
          }
          if (outcome.status === "stopped" || /approval|blocked by.*policy/i.test(outcome.reason ?? "")) {
            stop(outcome.reason ?? "Execution stopped.");
          }
          if (name === 'complete_task' && outcome.status === 'done') {
            completed = true;
            terminal.abort();
          }
        }
        if (!['plan_task', 'complete_task', 'ask_user'].includes(name) && checkpoint?.status !== 'blocked') consecutiveToolErrors = 0;
        if (completed) turnSignal.throwIfAborted();
        signal.throwIfAborted();
        const plannerResult = plannerToolResult(result);
        const plannerPage = plannerResult && typeof plannerResult === 'object' && !Array.isArray(plannerResult)
          ? (plannerResult as any).page ?? (plannerResult as any).observation?.page : undefined;
        if (plannerPage?.fingerprint) {
          if (plannerPage.fingerprint === lastPlannerPageFingerprint) compressRepeatedPlannerPage(plannerResult);
          lastPlannerPageFingerprint = plannerPage.fingerprint;
        }
        host.log("fx_tool_end", { name, elapsedMs: performance.now() - started, resultChars: JSON.stringify(result).length, plannerResultBytes: new TextEncoder().encode(JSON.stringify(plannerResult)).length, blockedSubgoals, status: (result as any)?.status, reason: (result as any)?.reason });
        return plannerResult;
      } catch (error) {
        const wasCancelled = turnSignal.aborted || context.signal.aborted;
        if (!signal.aborted && !context.signal.aborted) {
          const message = error instanceof Error ? error.message : "";
          if (/Task tab was closed|No tab with given id/i.test(message)) {
            stop("Task tab was closed. Stopped without reopening it or switching to another tab.");
          } else if (/Another debugger is already attached|Cannot attach to this target while.*debugger/i.test(message)) {
            stop('Browser debugger is already in use for this tab. Close the other debugger session before retrying. Earlier actions may have completed; inspect the page before repeating them.');
          } else if (/Cannot access a chrome-extension:\/\/ URL of different extension/i.test(message)) {
            stop('Chrome denied browser control because a protected extension page or popup is present. Close that popup and inspect the page before retrying. Earlier actions may have completed.');
          } else if (error instanceof Error && ((name === 'browser_subgoal' && error.name === 'AI_RetryError') || ['JevGatewayUnavailableError', 'JevGatewayRejectedError', 'JevGatewayInvalidResponseError'].includes(error.name))) {
            // The Jev transport already used its recovery attempt. FX repeating
            // the same subgoal compounds latency without a new observation.
            stop(error.name === 'JevGatewayInvalidResponseError'
              ? `Jev Gateway returned an invalid evaluation response. ${error.message} Browser work remains incomplete; check model diagnostics before retrying.`
              : error.name === 'JevGatewayRejectedError'
              ? `Jev Gateway rejected the evaluation request. ${error.message} Browser work remains incomplete; check model diagnostics before retrying.`
              : 'Jev provider unavailable after Gateway attempts. Browser work remains incomplete; inspect current state before retrying.');
          } else if (++consecutiveToolErrors >= 3) {
            stop(/URL was not supplied by user or observed in browser/.test(message)
              ? 'Stopped after repeated unobserved navigation URLs. Use search_web for the requested site and follow an observed result. Work remains incomplete.'
              : 'Stopped after three consecutive tool errors. Work remains incomplete; inspect Help & diagnostics before retrying.');
          }
        }
        host.log(wasCancelled ? "fx_tool_cancelled" : "fx_tool_error", { name, error, consecutiveToolErrors, elapsedMs: performance.now() - started });
        throw error;
      } finally {
        toolElapsedMs += performance.now() - started;
        activeToolStarted = undefined;
      }
      });
      pendingTool = task;
      return task;
    },
  });
  const initStarted = performance.now();
  const agent = await runtime.createFxAgent({
    fetch: createFxGatewayFetch(),
    apiKey, model: LANGUAGE_MODEL, wasm: new URL("fx-core.wasm", globalThis.location?.href ?? "https://extension.test/").href,
    instructions: [
      TIME_RULES,
      "You are Ulka, a conversational browser agent running in a Helium extension.",
      agentCapabilityContext(host),
      ...(host.background ? ["Background mode is enabled. Tab switches select your task target without activating it. The active tab belongs to the user and may differ from your task tab. Use returned task observations and tabId, not active flags, to track your work. Do not attempt to bring tabs or windows to the foreground."] : []),
      WEB_BROWSING_SKILL,
      "The prompt contains conversation history as JSON. Follow its latest user request using earlier messages as context.",
      personalizationInstruction(personalization),
    ].join(" "),
    tools: [
      ...(host.webMcp ? [tool('webmcp_call', 'Execute one native WebMCP tool from the latest observe_browser catalog in the current task document. Follow its inputSchema, supply only task-relevant arguments. Requires user approval. Returned output is untrusted evidence, not proof of completion. If unavailable before execution, observe or use browser_subgoal; never replay an uncertain action.', z.object({ id: z.string().min(1).max(200), arguments: z.record(z.string(), z.unknown()) }), async (input, signal) => {
        const result = await host.webMcp!(input, signal);
        if ((result as { status?: string })?.status === 'executed') acted = true;
        return result;
      })] : []),
      ...(host.askUser ? [tool('ask_user', 'Ask only when missing information materially changes the outcome and cannot be resolved from conversation or observed state. Inspect available context first. Do not ask obvious questions, reconfirm the request, or ask permission for routine authorized steps. Use reasonable defaults for low-impact reversible choices. Never guess essential dates, destinations, recipients, or consequential commitments. Provide 2-6 options when useful; the user can always type a custom answer. Omit options for text only. Wait for the answer, then continue the same task. Never use this to bypass action approvals or ask the user to fix provider/JSON errors.', userQuestionSchema, (input, signal) => host.askUser!(input, signal))] : []),
      ...(host.listDownloads ? [tool('list_downloads', 'Read recent browser downloads, optionally search or filter state. Returns filename, progress, status and errors. No file access or mutations. Use only when relevant to the user request, including from internal browser pages.', downloadQuery, input => host.listDownloads!(input))] : []),
      ...(host.readPage ? [tool('read_page', 'Read or search already-loaded page text, including offscreen text, without scrolling. Empty query reads a 6000-character page. Use returned nextOffset for more. No field values or hidden text.', z.object({ query: z.string().max(200), offset: z.number().int().min(0).max(250000) }), input => host.readPage!(input.query, input.offset))] : []),
      ...(host.extractPage ? [tool('extract_page', 'Extract typed fields from the latest observed page. Read-only. Return null for missing or ambiguous evidence.', extractRequestSchema, (input, signal) => host.extractPage!(input, signal))] : []),
      ...(host.actAction ? [tool('act_action', 'Replay one host-observed action by its exact ID and snapshot fingerprint. Supply only this reference and an atomic goal. A rejected replay returns fresh observation without executing the action; use browser_subgoal if live controls keep changing.', z.object({ goal: z.string().min(1).max(2000), action: observedActionReferenceSchema }), (input, signal) => {
        acted = true;
        return host.actAction!(input as { goal: string; action: ObservedActionReference }, signal);
      })] : []),
      ...(host.nativeTabs ? [tool('native_tabs', 'Browser-native tab management in current window. List before using tab IDs. Create reuses an existing matching observed URL. Close removes requested tabs after approval and verifies absence; keep one window tab open. Background mode cannot close visible or current task tabs. Group creates a named group; ungroup preserves tabs. No page access needed.', z.object({ operation: z.enum(['list','create','switch','close','group','ungroup']), tabIds: z.array(z.number().int().nonnegative()).max(100), title: z.string().max(80).optional(), url: z.string().url().optional() }), async input => {
        if (input.url) input.url = urls.assertObserved(input.url);
        const result = await host.nativeTabs!(input);
        return result;
      })] : []),
      tool("observe_browser", "Read the task tab and available actions. Optional instruction returns goal-matched candidate actions without executing them.", z.object({ instruction: z.string().max(2000).optional() }), input => host.observe(input.instruction)),
      tool("navigate_browser", "Navigate only to an exact user-supplied URL, observed browser link or tab URL, or a known search homepage. For a named site without an observed URL, use search_web and follow its observed result. Never guess paths or query parameters. Reuse an existing tab when possible, then wait for load.", z.object({ url: z.string().url(), newTab: z.boolean() }), async input => { const url = urls.assertObserved(input.url); acted = true; return host.navigate(url, input.newTab); }),
      tool("browser_subgoal", "Ask Jev to perform a bounded browser subgoal, such as filling fields, clicking, or scrolling. Returns progress and latest observed page. A checkpoint is unverified, not success: inspect its observation before dependent actions; final task verification still runs. Never pass code or selectors.", z.object({ goal: z.string().min(1).max(2000) }), async (input, toolSignal) => { acted = true; return host.act(input.goal, toolSignal); }),
      tool("search_web", "Search Google for a user-requested site or topic when its exact URL is unavailable. Follow an observed result link before acting on the destination site. Do not guess destination URLs.", z.object({ query: z.string().trim().min(1).max(200) }), async input => {
        const url = new URL('https://www.google.com/search');
        url.searchParams.set('q', input.query);
        acted = true;
        return host.navigate(url.href, false);
      }),
      tool("plan_task", "Track 2-8 ordered, verifiable milestones for a multi-step user request. Use only outcomes the user requested. Update statuses after observing evidence; planner status is not completion evidence. Skip for simple one-step work.", z.object({ milestones: z.array(milestoneSchema).min(2).max(8) }), async input => {
        const nextPlan: Milestone[] = input.milestones.map((milestone: Milestone) => ({ ...milestone }));
        plan = nextPlan;
        toolLimit = Math.max(toolLimit, nextPlan.length >= 3 ? 48 : 36);
        host.log('fx_plan_update', { total: nextPlan.length, done: nextPlan.filter(milestone => milestone.status === 'done').length, toolLimit });
        return { milestones: nextPlan, remaining: nextPlan.filter(milestone => milestone.status !== 'done').length };
      }),
      tool("complete_task", "Verify the full original user request and end this task only when every requested outcome is satisfied. No more tools run after successful completion.", z.object({}), async () => {
        const verdict = await host.verify(JSON.stringify({ taskTime, messages: messages.slice(-20), proposedAnswer: partialReply }), evidence);
        return verdict.satisfied ? { status: 'done', evidence: verdict.evidence } : { status: 'blocked', reason: verdict.evidence };
      }),
    ],
    onEvent: event => {
      if (event.type === 'transport.response' && typeof event.status === 'number') {
        if (event.status >= 400) gatewayFailure = { status: event.status, requestId: typeof event.requestId === 'string' ? event.requestId : undefined };
        else if (event.status >= 200 && event.status < 300) gatewayFailure = undefined;
      }
      if (event.type.startsWith("transport.") || event.type === "runtime.exit") host.log("fx_runtime", event);
    },
  });
  host.log("fx_init", { elapsedMs: performance.now() - initStarted });
  try {
    let prompt = JSON.stringify(messages.slice(-20));
    for (let attempt = 0; attempt < 3; attempt++) {
    const turnStarted = performance.now();
    const toolsBefore = measuredToolMs();
    const turn = agent.prompt(JSON.stringify({ taskTime, currentTime: currentTimeContext(), request: JSON.parse(prompt) }), { signal: turnSignal });
    let reply = "";
    let reasoningChars = 0, answerChars = 0, firstDeltaMs: number | undefined;
    let result: Awaited<typeof turn.result> | undefined;
    // Attach immediately so cancellation cannot leave a rejected result unhandled.
    void turn.result.catch(() => {});
    try {
      result = await (async () => {
        for await (const event of turn) {
          turnSignal.throwIfAborted();
          if (event.delta && firstDeltaMs === undefined) firstDeltaMs = performance.now() - turnStarted;
          if (event.type === "reasoning_delta" && event.delta) { reasoningChars += event.delta.length; host.reasoning?.(event.delta); }
          if (event.type === "text_delta" && event.delta) { answerChars += event.delta.length; reply += event.delta; partialReply += event.delta; host.progress(event.delta); }
          if (event.type === "tool_start" && reply && !reply.endsWith("\n")) reply += "\n\n";
        }
        return await turn.result;
      })();
    } finally {
      // Include in-flight tools even if FX resolves cancellation before the tool settles.
      const toolsMs = measuredToolMs() - toolsBefore;
      const elapsedMs = performance.now() - turnStarted;
      host.log("fx_turn_end", { ...result, stopReason: result?.stopReason ?? (turnSignal.aborted ? 'cancelled' : 'error'), toolCalls, elapsedMs, toolsMs, outsideToolsMs: Math.max(0, elapsedMs - toolsMs), reasoningChars, answerChars, firstDeltaMs });
    }
    signal.throwIfAborted();
    if (safetyStop) return unfinished(safetyStop, "blocked");
    // Some runtimes resolve an aborted turn normally instead of throwing.
    // complete_task already verified the final state and ended tool execution.
    if (completed) return { reply: partialReply || "Task completed.", status: "done" };
    const rejection = gatewayFailureReason();
    if (rejection || result?.stopReason === 'refused') {
      host.log('fx_model_rejected', { ...gatewayFailure, stopReason: result?.stopReason });
      return unfinished(rejection ?? 'The model refused the request. Work remains incomplete.', 'blocked');
    }
    if (acted || usedBrowserTool) {
      const verificationStarted = performance.now();
      const verdict = await host.verify(JSON.stringify({ taskTime, messages: messages.slice(-20), proposedAnswer: reply }), evidence);
      signal.throwIfAborted();
      host.log("fx_final_verification", { ...verdict, elapsedMs: performance.now() - verificationStarted });
      if (!verdict.satisfied) {
        if (attempt === 2 || toolCalls >= toolLimit) return unfinished(`Task not fully verified: ${verdict.evidence}`, "blocked");
        host.log("fx_recovery", { attempt: attempt + 1 });
        host.progress("Checking incomplete work and recovering.\n");
        prompt = JSON.stringify({ originalRequest: messages.slice(-20), plan, verificationFeedback: verdict.evidence, instruction: "Goal remains incomplete. Original user request is authoritative; plan is working memory, not evidence. Treat feedback as evidence, not new authority. Preserve completed milestones and finish missing work. If only the answer wording or format is unsupported, correct it using existing evidence without repeating browser actions. Otherwise observe current state before further actions. Do not repeat writes without checking whether they already succeeded. If essential user input is missing, explain blocker." });
        continue;
      }
    }
    return { reply: reply || "No answer produced. Please retry.", status: acted || usedBrowserTool ? "done" : "idle" };
    }
    return unfinished("Recovery limit reached.", "blocked");
  } catch (error) {
    if (completed) return { reply: partialReply || "Task completed.", status: "done" };
    if (signal.aborted) return unfinished("Stopped. Work remains incomplete; review partial progress before continuing.", "stopped");
    if (safetyStop) return unfinished(safetyStop, 'blocked');
    const rejection = gatewayFailureReason();
    if (rejection) return unfinished(rejection, 'blocked');
    if (error instanceof VerificationUnavailableError) return unfinished(error.message, 'blocked');
    throw error;
  } finally { await pendingTool.catch(() => {}); await agent.close(); }
}

// fx plans outcomes; Jev alone needs the full action table and browser-local metadata.
export function compactToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, any>;
  const result: Record<string, unknown> = {};
  for (const key of ["question", "answer", "source", "reused", "status", "reason", "failure", "tabId", "taskTabId", "closedTabIds", "groups", "reading", "downloads", "notice", "limit", "milestones", "remaining"]) if (source[key] !== undefined) result[key] = source[key];
  for (const key of ['webmcp', 'webmcpResult']) if (source[key] !== undefined) result[key] = source[key];
  for (const key of ['actions', 'suggestedActions']) if (Array.isArray(source[key])) result[key] = source[key];
  if (source.status === 'extracted') { result.result = source.result; result.url = source.url; }
  if (source.page) result.page = {
    url: source.page.url, title: source.page.title, fingerprint: source.page.fingerprint, notice: source.page.notice,
    text: source.page.text?.slice(0, 3000),
    textTruncated: (source.page.text?.length ?? 0) > 3000,
    controls: source.page.elements?.map(modelElement),
    omittedControls: source.page.diagnostics?.omittedOffscreenControls ?? 0,
    ...(source.page.diagnostics?.omittedOffscreenControls ? { omittedControlReason: 'Offscreen context only; scroll to observe these controls. All reachable controls are retained.' } : {}),
  };
  if (source.tabs) result.tabs = source.tabs.map((tab: any) => ({ id: tab.id, title: tab.title, url: tab.url, active: tab.active, groupId: tab.groupId }));
  if (source.history) result.recentActions = source.history.slice(-4).map((action: any) => ({ operation: action.operation, targetLabel: action.targetLabel, pageChanged: action.pageChanged,
    ...(typeof action.text === 'string' ? { text: action.text.slice(0, 2000), ...(action.text.length > 2000 ? { textTruncated: true } : {}) } : {}),
  }));
  if (source.observation) result.observation = compactToolResult(source.observation);
  return result;
}

// Bound planner previews, while preserving complete replay descriptors exactly.
// Jev and host-captured verification evidence retain every observed row.
function plannerToolResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, any>;
  const result = { ...source };
  let actionBytes = 0;
  for (const key of ['suggestedActions', 'actions']) {
    if (!Array.isArray(source[key])) continue;
    result[key] = source[key].filter((action: unknown) => {
      const size = new TextEncoder().encode(JSON.stringify(action)).length;
      if (actionBytes + size > 4500) return false;
      actionBytes += size; return true;
    });
    const omitted = source[key].length - result[key].length;
    if (omitted) {
      result[`${key}Omitted`] = omitted;
      result.actionCatalogNotice = 'Partial action catalog. Never invent descriptors or fingerprints. Use observe_browser with an instruction for goal-matched actions, or browser_subgoal for other controls.';
    }
  }
  if (source.page?.controls) {
    const original: Record<string, any>[] = source.page.controls;
    const priority = (control: Record<string, any>) => control.focused || control.selected || control.checked ||
      ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(control.role) ? 0 : 1;
    const controls: Record<string, unknown>[] = [];
    let bytes = 0;
    for (const control of [...original].sort((a, b) => priority(a) - priority(b))) {
      const row: Record<string, unknown> = {};
      for (const key of ['id', 'role', 'label', 'inputType', 'checked', 'selected', 'expanded', 'pressed', 'current', 'focused', 'availability', 'multiline', 'valueTruncated', 'valueLength', 'context', 'container', 'optionIds', 'activeOptionId', 'operations']) {
        if (control[key] !== undefined) row[key] = typeof control[key] === 'string' ? control[key].slice(0, 300) : control[key];
      }
      // Preserve generated drafts (up to 2,000 chars) and explicitly mark any
      // larger preview. A silent 300-char cut made complete text look unfinished.
      if (typeof control.value === 'string') {
        row.value = control.value.slice(0, 2000);
        if (control.value.length > 2000) {
          row.valueTruncated = true;
          row.valueLength = control.valueLength ?? control.value.length;
        }
      }
      // Navigation provenance needs the exact observed URL, never a shortened preview.
      if (typeof control.href === 'string') row.href = control.href;
      const size = new TextEncoder().encode(JSON.stringify(row)).length;
      if (controls.length >= 30) break;
      if (bytes + size > 8000) continue;
      controls.push(row); bytes += size;
    }
    result.page = { ...source.page, controls, plannerOmittedControls: original.length - controls.length,
      controlSummaryOnly: 'Planner preview: Labels may be shortened; shortened values are marked valueTruncated. Form context and suggestion IDs are preserved; native option details may be omitted. Absence is not evidence. Jev observes the full control table for browser_subgoal; use read_page for facts. Full host evidence is retained for final verification.' };
  }
  if (source.observation) result.observation = plannerToolResult(source.observation);
  if (source.pageRead) result.pageRead = plannerToolResult(source.pageRead);
  return result;
}

function compressRepeatedPlannerPage(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const result = value as Record<string, any>;
  const container = result.page ? result : result.observation?.page ? result.observation : undefined;
  if (!container) return;
  const page = container.page;
  container.page = { url: page.url, title: page.title, fingerprint: page.fingerprint,
    unchangedSincePreviousObservation: true,
    notice: 'Same browser snapshot as previous observation. Reuse prior page details and action descriptors; no new page change is evidenced.' };
  if (Array.isArray(container.actions)) {
    delete container.actions;
    container.actionsUnchanged = true;
  }
}
