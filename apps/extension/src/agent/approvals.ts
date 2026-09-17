import type { AgentDecision, PageSnapshot } from "../../../../packages/protocol/src/index";

export type RiskLevel = "safe" | "confirm" | "blocked";
const BLOCKED = /\b(delete account|transfer money|wire transfer)\b/i;
const CONFIRM = /\b(send|submit|publish|purchase|buy|checkout|delete|remove|subscribe|confirm order|account)\b/i;
const SENSITIVE_FIELD = /\b(card|cvv|cvc|routing|account number|social security|ssn|passport|tax id)\b/i;

export function classifyAction(snapshot: PageSnapshot, decision: AgentDecision): RiskLevel {
  if (decision.operation === 'RIGHT_CLICK') return 'confirm';
  if (["HOVER", "SCROLL_ELEMENT_DOWN", "SCROLL_ELEMENT_UP"].includes(decision.operation)) return "safe";
  if (["ARROW_DOWN", "ARROW_UP"].includes(decision.operation)) return "confirm";
  const target = snapshot.elements.find((element) => element.id === decision.target?.split(":")[0]);
  if (decision.operation === "TYPE_TEXT") return SENSITIVE_FIELD.test(target?.label ?? "") ? "confirm" : "safe";
  if (decision.operation === "PRESS_ENTER") return ["searchbox", "combobox"].includes(target?.role ?? "") ? "safe" : "confirm";
  if (["SELECT", "PRESS_ESCAPE", "SCROLL_UP", "SCROLL_DOWN", "GO_BACK", "GO_FORWARD", "RELOAD", "WAIT", "DONE", "BLOCKED"].includes(decision.operation)) return "safe";
  if (["OPEN_TAB", "SWITCH_TAB"].includes(decision.operation)) return "safe";
  if (["CLOSE_TAB", "DOWNLOAD"].includes(decision.operation)) return "confirm";
  if (decision.operation !== "CLICK") return "blocked";
  const label = target?.label ?? "";
  if (BLOCKED.test(label)) return "blocked";
  if (CONFIRM.test(label)) return "confirm";
  return "safe";
}
