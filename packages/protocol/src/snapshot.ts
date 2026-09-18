export type AgentOperation =
  | "RIGHT_CLICK"
  | "HOVER" | "ARROW_DOWN" | "ARROW_UP" | "SCROLL_ELEMENT_DOWN" | "SCROLL_ELEMENT_UP"
  | "CLICK" | "TYPE_TEXT" | "SELECT" | "SCROLL_UP" | "SCROLL_DOWN"
  | "PRESS_ENTER" | "PRESS_ESCAPE" | "GO_BACK" | "GO_FORWARD" | "RELOAD"
  | "OPEN_TAB" | "SWITCH_TAB" | "CLOSE_TAB"
  | "DOWNLOAD"
  | "WAIT" | "DONE" | "BLOCKED";

export interface PageElement {
  id: string;
  nodeId: number;
  role: string;
  label: string;
  value?: string;
  valueTruncated?: boolean;
  valueLength?: number;
  inputType?: string;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  current?: string;
  focused?: boolean;
  multiline?: boolean;
  availability?: 'offscreen' | 'occluded' | 'disabled';
  context?: Array<{ id: string; role: string; label?: string; heading?: string }>;
  container?: { role: string; selected?: boolean; groupRole?: string; groupLabel?: string };
  optionIds?: string[];
  activeOptionId?: string;
  operations: AgentOperation[];
  options?: Array<{ id: string; label: string; value: string }>;
}

export interface PageSnapshot {
  snapshotId: string;
  fingerprint: string;
  pageIdentity: string;
  url: string;
  title: string;
  text: string;
  scroll: { y: number; height: number; viewportHeight: number };
  scrollTarget?: { nodeId: number; y: number; height: number; viewportHeight: number };
  elements: PageElement[];
  guards: Record<string, TargetGuard>;
  diagnostics?: { modalScoped: boolean; candidates: number; rejected: Record<string, number>; iframeCount: number; source?: 'accessibility' | 'dom-fallback'; axNodes?: number; unmapped?: number };
  tabs?: Array<{ id: string; title: string; url: string; active: boolean }>;
  tabRefs?: Record<string, number>;
  createdAt: number;
}

export interface TargetGuard {
  accessibility?: { backendNodeId: number; role: string; name: string };
  nodeId: number;
  role: string;
  label: string;
  value?: string;
  enabled: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export function snapshotFingerprint(input: Omit<PageSnapshot, "snapshotId" | "fingerprint" | "createdAt">): string {
  const value = JSON.stringify(input);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
