import type { AgentDecision, AgentOperation, PageSnapshot } from '../../../../packages/protocol/src';
import { buildActionSpace } from './action-space';
import { z } from 'zod';

export interface ObservedAction {
  id: string;
  operation: AgentOperation;
  target?: string;
  option?: string;
  label?: string;
  role?: string;
  description: string;
  snapshotFingerprint: string;
}

export const observedActionSchema = z.object({
  id: z.string().min(1).max(300),
  operation: z.enum(['RIGHT_CLICK', 'HOVER', 'ARROW_DOWN', 'ARROW_UP', 'SCROLL_ELEMENT_DOWN', 'SCROLL_ELEMENT_UP', 'CLICK', 'TYPE_TEXT', 'SELECT', 'SCROLL_UP', 'SCROLL_DOWN', 'PRESS_ENTER', 'PRESS_ESCAPE', 'GO_BACK', 'GO_FORWARD', 'RELOAD', 'OPEN_TAB', 'SWITCH_TAB', 'CLOSE_TAB', 'DOWNLOAD', 'WAIT']),
  target: z.string().optional(), option: z.string().optional(), label: z.string().optional(), role: z.string().optional(),
  description: z.string().min(1), snapshotFingerprint: z.string().min(1),
});

export function observeActions(page: PageSnapshot): ObservedAction[] {
  const space = buildActionSpace(page);
  const actions: ObservedAction[] = [];
  for (const [operation, targets] of Object.entries(space.targets)) {
    for (const [target, descriptor] of Object.entries(targets ?? {})) {
      const option = operation === 'SELECT' ? target.split(':').slice(1).join(':') : undefined;
      actions.push({
        id: `observed:${operation}:${target}`,
        operation: operation as AgentOperation,
        target,
        ...(option ? { option } : {}),
        label: descriptor.element,
        role: descriptor.role,
        description: space.operations[operation] ?? descriptor.element,
        snapshotFingerprint: page.fingerprint,
      });
    }
  }
  for (const operation of ['SCROLL_UP', 'SCROLL_DOWN', 'GO_BACK', 'GO_FORWARD', 'RELOAD', 'OPEN_TAB', 'WAIT'] as AgentOperation[]) {
    if (space.operations[operation]) actions.push({ id: `observed:${operation}`, operation, description: space.operations[operation], snapshotFingerprint: page.fingerprint });
  }
  return actions;
}

export function decisionFromObservedAction(action: ObservedAction): AgentDecision {
  return { operation: action.operation, target: action.target, option: action.option, confidence: 1 };
}
