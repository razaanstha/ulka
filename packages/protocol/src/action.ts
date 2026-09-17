import type { AgentOperation } from "./snapshot";

export interface ActionRecord {
  step: number;
  operation: AgentOperation;
  target?: string;
  targetLabel?: string;
  text?: string;
  confidence?: number;
  url: string;
  pageChanged?: boolean;
  fingerprint?: string;
  executedAt: number;
}
