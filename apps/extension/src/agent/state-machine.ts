export type AgentState = "IDLE" | "ATTACHING" | "OBSERVING" | "DECIDING" | "GENERATING_TEXT" |
  "CHECKPOINT" | "VALIDATING" | "VERIFYING" | "EXECUTING" | "WAITING" | "PAUSED" | "DONE" | "BLOCKED" | "STOPPED" | "ERROR";

export class AgentStateMachine {
  private current: AgentState = "IDLE";
  constructor(private readonly onChange?: (state: AgentState) => void) {}
  get state(): AgentState { return this.current; }
  transition(next: AgentState): void { this.current = next; this.onChange?.(next); }
}
