import type { ActionRecord } from "./action";
import type { AgentDecision } from "./decision";
import type { PageSnapshot } from "./snapshot";

export interface DecideRequest { goal: string; snapshot: PageSnapshot; history: ActionRecord[] }
export interface DecideResponse { decision: AgentDecision }
