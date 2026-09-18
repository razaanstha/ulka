import type { ActionRecord, AgentDecision, PageSnapshot, AgentOperation } from "../../../../packages/protocol/src";
import { progressState } from "./history";

// Stagehand-inspired direction: cache successful semantic actions, not DOM selectors.
// Replays still pass through current snapshot validation and approval policy.

export interface CachedAction {
  goalKey: string;
  url: string;
  operation: AgentOperation;
  option?: string;
  role: string;
  label: string;
  ordinal: number;
  precondition: string;
  cachedAt: number;
}

// Only actions with a stable, observable result are replayable. Text input and
// context-sensitive keyboard/pointer actions must reach the planner again.
const CACHEABLE: AgentOperation[] = ["CLICK", "SELECT"];

function goalKey(goal: string): string {
  return goal.trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, 500);
}

function targetOrdinal(page: PageSnapshot, targetId: string, role: string, label: string): number {
  const index = page.elements.findIndex(element => element.id === targetId);
  return index < 0 ? -1 : page.elements.slice(0, index).filter(element => element.role === role && element.label === label).length;
}

function semanticTarget(page: PageSnapshot, decision: Pick<AgentDecision, "target">): CachedAction | undefined {
  const targetId = decision.target?.split(":")[0];
  const target = targetId ? page.elements.find(element => element.id === targetId) : undefined;
  if (!target || target.availability || !target.operations.length) return undefined;
  return {
    goalKey: "",
    url: page.url,
    operation: "CLICK",
    role: target.role,
    label: target.label,
    ordinal: targetOrdinal(page, target.id, target.role, target.label),
    precondition: progressState(page),
    cachedAt: Date.now(),
  };
}

export function cacheKey(action: Pick<CachedAction, "goalKey" | "url" | "operation" | "option" | "role" | "label" | "ordinal" | "precondition">): string {
  return JSON.stringify([action.goalKey, action.url, action.operation, action.option, action.role, action.label, action.ordinal, action.precondition]);
}

export function rememberAction(cache: Map<string, CachedAction>, goal: string, page: PageSnapshot, decision: AgentDecision, record: ActionRecord): void {
  if (!CACHEABLE.includes(decision.operation) || decision.operation === "TYPE_TEXT" || record.pageChanged !== true) return;
  const target = semanticTarget(page, decision);
  if (!target) return;
  const action: CachedAction = { ...target, goalKey: goalKey(goal), operation: decision.operation, option: decision.option };
  cache.set(cacheKey(action), action);
}

export function findCachedAction(cache: Map<string, CachedAction>, goal: string, page: PageSnapshot): AgentDecision | undefined {
  const wantedGoal = goalKey(goal);
  for (const action of cache.values()) {
    if (action.goalKey !== wantedGoal || action.url !== page.url || action.precondition !== progressState(page)) continue;
    const matches = page.elements.filter(element => element.role === action.role && element.label === action.label && !element.availability);
    const target = matches[action.ordinal];
    if (!target || !target.operations.includes(action.operation)) continue;
    return { operation: action.operation, target: action.operation === "SELECT" ? `${target.id}:${action.option}` : target.id, option: action.option, confidence: 1 };
  }
  return undefined;
}
