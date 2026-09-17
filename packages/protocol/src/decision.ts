import type { AgentOperation } from "./snapshot";

export interface AgentDecision {
  operation: AgentOperation;
  target?: string;
  option?: string;
  confidence: number;
  operationProbabilities?: Record<string, number>;
  targetProbabilities?: Record<string, number>;
  latencyMs?: number;
}
