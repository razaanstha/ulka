import { TextGenerationUnavailableError, TextTargetMismatchError, textGenerationContext } from './text-generator';
import { VerificationUnavailableError } from './outcome-verifier';
import type { ActionRecord, AgentDecision, PageSnapshot } from "../../../../packages/protocol/src/index";
import { classifyAction } from "./approvals";
import type { BrowserExecutor } from "./executor";
import { StaleDecisionError } from "./freshness";
import { hasIneffectiveRepetition, hasActionCycle, progressState, progressActionKey } from "./history";
import type { CdpObserver } from "./observer";
import { AgentStateMachine } from "./state-machine";
import { findCachedAction, rememberAction, type CachedAction } from "./action-cache";

export interface DecisionEngine { decide(goal: string, snapshot: PageSnapshot, history: ActionRecord[], feedback?: { evidence?: string; excludeDone?: boolean; exhaustedActions?: string[] }): Promise<AgentDecision> }
export interface TextEngine { generate(goal: string, field: PageSnapshot["elements"][number], page: PageSnapshot, history: ActionRecord[]): Promise<string> }
export interface VerificationEngine { verify(goal: string, page: PageSnapshot, history: ActionRecord[]): Promise<{ satisfied: boolean; evidence: string }> }
export interface TraceEvent { type: "observe" | "decision" | "text" | "execute" | "verify" | "stale" | "scroll_progress" | "action_progress"; step: number; detail: Record<string, unknown> }
export interface RunnerOptions {
  // Only FX may defer routine subgoal verification to its final task check.
  completionMode?: 'task' | 'subgoal';
  cancelRequests?: () => void;
  taskMemory?: TaskMemory;
  taskBudget?: TaskBudget;
  maxActions?: number;
  maxModelCalls?: number;
  initialDecision?: AgentDecision;
  approve?: (decision: AgentDecision, snapshot: PageSnapshot, text?: string) => Promise<boolean>;
  onTrace?: (event: TraceEvent) => void;
}
export interface TaskMemory {
  history: ActionRecord[];
  attempts: Map<string, number>;
  stateVisits?: Map<string, number>;
  actionCache?: Map<string, CachedAction>;
  budget?: TaskBudget;
}
// Shared across serial FX subgoals. A model step may include provider retries.
export interface TaskBudget { remainingActions: number; remainingModelSteps: number }
export interface AgentResult { status: "done" | "checkpoint" | "blocked" | "stopped"; reason?: string; failure?: 'verification_unavailable' | 'text_generation_unavailable' | 'task_budget_exhausted'; history: ActionRecord[] }

export class AgentRunner {
  readonly history: ActionRecord[] = [];
  private stopped = false;
  constructor(
    private readonly observer: Pick<CdpObserver, "observe" | "waitForChange">,
    private readonly decisions: DecisionEngine,
    private readonly executor: BrowserExecutor,
    readonly states = new AgentStateMachine(),
    private readonly options: RunnerOptions = {},
    private readonly textEngine?: TextEngine,
    private readonly verifier?: VerificationEngine,
  ) {}

  stop(): void { this.stopped = true; this.options.cancelRequests?.(); }

  async run(goal: string): Promise<AgentResult> {
    const maxActions = this.options.maxActions ?? 30, maxModelCalls = this.options.maxModelCalls ?? 60;
    let calls = 0;
    const budget = this.options.taskBudget;
    const claimModelStep = (): AgentResult | undefined => {
      if (budget && budget.remainingModelSteps <= 0) return this.budgetExhausted('model-step');
      if (calls >= maxModelCalls) return this.blocked('Agent model-call limit reached.');
      calls++;
      if (budget) budget.remainingModelSteps--;
    };
    let nextSnapshot: PageSnapshot | undefined;
    let generatedTextCache: { key: string; text: string } | undefined;
    let staleAttempts = 0;
    let failedVerifications = 0;
    let requiresSubgoalVerification = false;
    let feedback: { evidence: string; excludeDone: boolean } | undefined;
    let scrollStreak = 0, emptyScrolls = 0;
    const seenContent = new Set<string>();
    const memory = this.options.taskMemory ?? { history: [], attempts: new Map<string, number>() };
    const actionCache = memory.actionCache ??= new Map<string, CachedAction>();
    const stateVisits = memory.stateVisits ??= new Map<string, number>();
    try {
      while (!this.stopped) {
        if (!budget && this.history.length >= maxActions) return this.blocked("Agent step limit reached.");
        const modelLimit = claimModelStep();
        if (modelLimit) return modelLimit;
        this.states.transition("OBSERVING");
        // Consume the settled observation once; stale retries and failed verification re-observe.
        const snapshot = nextSnapshot ?? await this.observer.observe();
        nextSnapshot = undefined;
        this.trace("observe", { url: snapshot.url, title: snapshot.title, elements: snapshot.elements.length, fingerprint: snapshot.fingerprint, snapshotId: snapshot.snapshotId, diagnostics: snapshot.diagnostics });
        this.states.transition("DECIDING");
        const exhaustedActions = [...memory.attempts].filter(([key, count]) => key.startsWith("progress:") && count >= 2).map(([key]) => key);
        // Cache replay is limited to a fresh run. This prevents one run from
        // replaying its own successful click while preserving cross-subgoal speedups.
        const cached = this.history.length === 0 && !feedback ? findCachedAction(actionCache, goal, snapshot) : undefined;
        const forced = this.history.length === 0 && !feedback ? this.options.initialDecision : undefined;
        calls += cached || forced ? 0 : 1;
        const decision = forced ?? cached ?? await this.decisions.decide(goal, snapshot, memory.history.slice(-10), exhaustedActions.length ? { ...feedback, exhaustedActions } : feedback);
        if (this.stopped) return this.stoppedResult();
        this.trace("decision", { operation: decision.operation, target: decision.target, confidence: decision.confidence, probabilities: decision.operationProbabilities, latencyMs: decision.latencyMs, cacheHit: Boolean(cached), observedAction: Boolean(forced) });
        if (decision.operation === "DONE") {
          if (this.options.completionMode === 'subgoal' && !requiresSubgoalVerification) {
            this.states.transition('CHECKPOINT');
            return { status: 'checkpoint', reason: 'Jev ended this subgoal; its outcome remains unverified. Inspect the returned observation before dependent actions. Final task verification is still required.', history: this.history };
          }
          if (!this.verifier) return this.blocked("Goal verifier unavailable.");
          const verificationLimit = claimModelStep();
          if (verificationLimit) return verificationLimit;
          this.states.transition("VERIFYING");
          const verification = await this.verifier.verify(goal, snapshot, this.history);
          if (this.stopped) return this.stoppedResult();
          this.trace("verify", verification);
          if (!verification.satisfied) {
            if (++failedVerifications >= 2) return this.blocked(`Goal verification failed: ${verification.evidence}`);
            feedback = { evidence: verification.evidence, excludeDone: true };
            continue;
          }
          this.states.transition("DONE"); return { status: "done", history: this.history };
        }
        if (decision.operation === "BLOCKED") return this.blocked("Jev found no supported action.");
        // At the action budget, allow DONE above but never another mutation or text call.
        if (budget && budget.remainingActions <= 0) return this.budgetExhausted('action');
        if (this.history.length >= maxActions) return this.blocked('Agent step limit reached.');
        const exhaustedWait = () => memory.history.slice(-2).length === 2 && memory.history.slice(-2).every(action => action.url === snapshot.url && action.operation === 'WAIT' && action.pageChanged === false);
        if (decision.operation === 'WAIT' && exhaustedWait()) return this.blocked('Wait checkpoint: two waits produced no observed change. Read the current page and choose a non-WAIT action, or report a loading/access blocker. Do not repeat waiting or navigate merely to reset retries.');
        const recentScrolls = memory.history.slice(-3);
        if (["SCROLL_UP", "SCROLL_DOWN"].includes(decision.operation) && recentScrolls.length === 3 &&
          recentScrolls.every(action => action.url === snapshot.url && ["SCROLL_UP", "SCROLL_DOWN"].includes(action.operation)) &&
          recentScrolls[0].operation === recentScrolls[2].operation && recentScrolls[1].operation === decision.operation && recentScrolls[0].operation !== decision.operation) {
          return this.blocked("Alternating scroll cycle detected. Inspect current content or choose a different strategy.");
        }
        const targeted = ["RIGHT_CLICK", "HOVER", "ARROW_DOWN", "ARROW_UP", "SCROLL_ELEMENT_DOWN", "SCROLL_ELEMENT_UP", "CLICK", "TYPE_TEXT", "SELECT", "PRESS_ENTER", "PRESS_ESCAPE", "DOWNLOAD"].includes(decision.operation);
        if (["SWITCH_TAB", "CLOSE_TAB"].includes(decision.operation) && (!decision.target || !snapshot.tabRefs?.[decision.target])) throw new Error("Decision tab target is invalid; no action executed.");
        const targetId = decision.target?.split(":")[0];
        const target = targetId ? snapshot.elements.find((element) => element.id === targetId) : undefined;
        const semanticLabel = target?.label ?? snapshot.tabs?.find(tab => tab.id === decision.target)?.url;
        const progressKey = progressActionKey(snapshot, decision);
        if (!progressKey && hasActionCycle([...memory.history, { step: 0, operation: decision.operation, targetLabel: semanticLabel, url: snapshot.url, executedAt: Date.now() }])) return this.blocked('Repeated action cycle detected despite page changes. Choose a different strategy.');
        if (targeted && (!target || !target.operations.includes(decision.operation))) throw new Error("Decision target is invalid; no action executed.");
        if (progressKey && (memory.attempts.get(progressKey) ?? 0) >= 2) return this.blocked("Repeated action in the same meaningful page state. Inspect current controls or choose a different action; navigation does not reset this checkpoint.");
        const attemptKey = JSON.stringify([snapshot.url, snapshot.fingerprint, decision.operation, target?.role, target?.label, decision.option]);
        const attempts = memory.attempts.get(attemptKey) ?? 0;
        if (attempts >= 3) return this.blocked("Repeated action in a previously visited page state. Choose a different strategy; do not repeat this action.");
        memory.attempts.set(attemptKey, attempts + 1);
        let text: string | undefined;
        if (decision.operation === "TYPE_TEXT") {
          if (!target || !this.textEngine) throw new Error("Text generator unavailable");
          const key = textGenerationContextKey(goal, target, snapshot, this.history);
          if (generatedTextCache?.key === key) text = generatedTextCache.text;
          else {
            const textLimit = claimModelStep();
            if (textLimit) return textLimit;
            this.states.transition("GENERATING_TEXT");
            try {
              text = await this.textEngine.generate(goal, target, snapshot, this.history);
            } catch (error) {
              if (!(error instanceof TextTargetMismatchError)) throw error;
              this.trace('text', { target: target.id, label: target.label, rejected: true, evidence: error.message });
              return this.blocked(`Text target rejected before typing: ${error.message}`);
            }
            if (this.stopped) return this.stoppedResult();
            generatedTextCache = { key, text };
          }
          this.trace("text", { target: target.id, label: target.label, text });
        }
        const risk = classifyAction(snapshot, decision);
        if (risk === "blocked") return this.blocked("Action blocked by approval policy.");
        if (risk === "confirm" && !(await this.options.approve?.(decision, snapshot, text))) return this.blocked("Action requires approval.");
        if (this.stopped) return this.stoppedResult();
        this.states.transition("VALIDATING");
        try {
          this.states.transition("EXECUTING");
          // Count attempts too: an executor can change focus before reporting a stale target.
          if (budget) budget.remainingActions--;
          await this.executor.execute(snapshot, decision, text);
          if (risk === "confirm") requiresSubgoalVerification = true;
          this.trace("execute", { operation: decision.operation, target: decision.target, snapshotId: snapshot.snapshotId, nodeId: target?.nodeId, role: target?.role });
        } catch (error) {
          if (error instanceof StaleDecisionError) {
            this.trace("stale", { message: error.message });
            // A trigger may open a popup and transfer focus before any text is
            // inserted. Re-observe and tell the model why the previous target
            // failed rather than silently choosing the same trigger again.
            feedback = { evidence: `Previous ${decision.operation} on ${target?.label ?? 'control'} was not completed: ${error.message}. Reinspect the current controls; if a popup opened, use its observed focused editor or options. No text may be assumed inserted.`, excludeDone: true };
            if (++staleAttempts >= 3) return this.blocked(`Repeated stale targets: ${error.message}. Re-observe or choose a different strategy.`);
            continue;
          }
          throw error;
        }
        const record: ActionRecord = { step: this.history.length + 1, operation: decision.operation, target: decision.target,
          targetLabel: semanticLabel, text, confidence: decision.confidence, url: snapshot.url, fingerprint: snapshot.fingerprint, executedAt: Date.now() };
        if (progressKey) memory.attempts.set(progressKey, (memory.attempts.get(progressKey) ?? 0) + 1);
        this.history.push(record);
        memory.history.push(record);
        rememberAction(actionCache, goal, snapshot, decision, record);
        if (feedback) feedback.excludeDone = false;
        if (memory.history.length > 30) memory.history.shift();
        staleAttempts = 0;
        generatedTextCache = undefined;
        this.states.transition("OBSERVING");
        const visiblyIdle = (page: PageSnapshot) => page.diagnostics?.busy === false &&
          !page.text.split('\n').some(line => /^(?:loading|fetching|searching|please wait)(?:\b|[\s.…!])/i.test(line.trim()) && line.trim().length < 100);
        const idleSubgoalWait = decision.operation === 'WAIT' && this.options.completionMode === 'subgoal' && visiblyIdle(snapshot);
        const after = this.observer.waitForChange
          ? await this.observer.waitForChange(snapshot, () => this.stopped, decision.operation === "WAIT" && !idleSubgoalWait ? 10000 : 3000)
          : await this.observer.observe();
        if (this.stopped) return this.stoppedResult();
        nextSnapshot = after;
        record.pageChanged = progressState(after) !== progressState(snapshot);
        this.trace("action_progress", { operation: decision.operation, target: decision.target, pageChanged: record.pageChanged, rawPageChanged: after.fingerprint !== snapshot.fingerprint });
        if (this.options.completionMode === 'subgoal' && after.url !== snapshot.url) {
          // A new document/search is a planning boundary, not proof of success.
          // Do not let the old interaction goal keep mutating the resulting page.
          this.states.transition('CHECKPOINT');
          return { status: 'checkpoint', reason: 'The page URL changed. Outcome remains unverified. Inspect the new page before continuing; do not repeat already committed controls. Final task verification is still required.', history: this.history };
        }
        if (idleSubgoalWait && !record.pageChanged && visiblyIdle(after)) {
          this.states.transition('CHECKPOINT');
          return { status: 'checkpoint', reason: 'Wait produced no change on a page without observed loading. Outcome remains unverified. Inspect this observation with the planner before any further wait; final task verification is still required.', history: this.history };
        }
        if (decision.operation.startsWith('SCROLL_')) {
          const chunks = (text: string) => text.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
          for (const line of chunks(snapshot.text)) seenContent.add(line);
          const fresh = chunks(after.text).filter(line => !seenContent.has(line));
          for (const line of fresh) seenContent.add(line);
          scrollStreak++; emptyScrolls = fresh.length ? 0 : emptyScrolls + 1;
          this.trace('scroll_progress', { snapshotId: after.snapshotId, consecutiveScrolls: scrollStreak, newTextChunks: fresh.length, unchangedContentScrolls: emptyScrolls });
          if (emptyScrolls >= 3) return this.blocked('Scrolling produced no new readable content. Read current page, inspect controls, or choose a different strategy; do not repeat this scroll subgoal.');
          if (scrollStreak >= 4) return this.blocked('Scroll checkpoint: inspect the newly observed content with read_page before requesting more scrolling. Scrolling alone does not verify the goal.');
        } else if (decision.operation !== 'WAIT') { scrollStreak = 0; emptyScrolls = 0; seenContent.clear(); }
        if (decision.operation === 'WAIT' && exhaustedWait()) return this.blocked('Wait checkpoint: two waits produced no observed change. Read the current page and choose a non-WAIT action, or report a loading/access blocker. Do not repeat waiting or navigate merely to reset retries.');
        if (hasIneffectiveRepetition(this.history)) return this.blocked("Three actions produced no page change.");
        // Count meaningful settled states across subgoals, not just changing DOM IDs.
        // WAIT has its own checkpoint; do not spend the cycle allowance on loading.
        if (decision.operation !== 'WAIT') {
          const key = progressState(after);
          const visits = (stateVisits.get(key) ?? 0) + 1;
          stateVisits.set(key, visits);
          if (visits >= 3) return this.blocked('Repeated page-state cycle across subgoals. The same observed state returned three times; inspect missing information or change strategy instead of repeating this interaction.');
        }
      }
      return this.stoppedResult();
    } catch (error) {
      if (this.stopped) return this.stoppedResult();
      if (error instanceof TextGenerationUnavailableError) return { ...this.blocked(error.message), failure: 'text_generation_unavailable' };
      if (error instanceof VerificationUnavailableError) return { ...this.blocked(error.message), failure: 'verification_unavailable' };
      this.states.transition("ERROR");
      throw error;
    }
  }

  private blocked(reason: string): AgentResult {
    this.states.transition("BLOCKED");
    return { status: "blocked", reason, history: this.history };
  }

  private budgetExhausted(kind: string): AgentResult {
    return { ...this.blocked(`Task ${kind} budget exhausted. Review partial progress before continuing.`), failure: 'task_budget_exhausted' };
  }

  private stoppedResult(): AgentResult {
    this.states.transition("STOPPED");
    return { status: "stopped", history: this.history };
  }

  private trace(type: TraceEvent["type"], detail: Record<string, unknown>): void {
    this.options.onTrace?.({ type, step: this.history.length + 1, detail });
  }
}

export function textGenerationContextKey(goal: string, field: PageSnapshot["elements"][number], page: PageSnapshot, history: ActionRecord[]): string {
  return JSON.stringify(textGenerationContext(goal, field, page, history));
}
