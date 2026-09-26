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

export const observedActionReferenceSchema = z.object({
  id: z.string().min(1).max(300),
  snapshotFingerprint: z.string().min(1),
});
export type ObservedActionReference = z.infer<typeof observedActionReferenceSchema>;

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

// Resolve to the host's descriptor. Model-authored targets or operations never
// define execution; the reference must belong to the latest captured catalog.
export function resolveObservedAction(reference: ObservedActionReference, catalog: ObservedAction[]): ObservedAction | undefined {
  return catalog.find(item => item.id === reference.id && item.snapshotFingerprint === reference.snapshotFingerprint);
}
