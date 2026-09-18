import { expect, test } from 'bun:test';
import { decisionFromObservedAction, observeActions } from '../apps/extension/src/agent/observed-actions';
import type { PageSnapshot } from '../packages/protocol/src';

const page = (): PageSnapshot => ({
  snapshotId: 's', fingerprint: 'fp', pageIdentity: 'p', url: 'https://example.test', title: '', text: '',
  scroll: { y: 0, height: 100, viewportHeight: 100 }, createdAt: 0,
  elements: [{ id: 'e1', nodeId: 1, role: 'button', label: 'Sign in', operations: ['CLICK'] }],
  guards: { e1: { nodeId: 1, role: 'button', label: 'Sign in', enabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } } },
});

test('observe returns replayable action with snapshot guard', () => {
  const action = observeActions(page()).find(item => item.operation === 'CLICK');
  expect(action).toMatchObject({ target: 'e1', snapshotFingerprint: 'fp' });
  expect(decisionFromObservedAction(action!)).toMatchObject({ operation: 'CLICK', target: 'e1', confidence: 1 });
});
