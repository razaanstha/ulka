import { expect, test, spyOn } from 'bun:test';
import { ApprovalGate, createApprovalRequest, formatApprovalRequest } from '../apps/extension/src/agent/approval-request';
import type { PageSnapshot } from '../packages/protocol/src';

const page = {
  url: 'https://shop.example/checkout?private=hidden',
  elements: [{ id: 'e1', label: 'Purchase now' }],
  tabs: [{ id: 't1', title: 'Other account', url: 'https://account.example/private' }],
} as PageSnapshot;

test('approval identifies actual page control, origin and exact proposed text', () => {
  const request = createApprovalRequest({ operation: 'TYPE_TEXT', target: 'e1', confidence: 1 }, page, '<b>literal</b>\nSecond line');
  expect(request.label).toBe('Purchase now');
  expect(request.origin).toBe('https://shop.example');
  expect(request.text).toBe('<b>literal</b>\nSecond line');
  const displayed = formatApprovalRequest(request);
  expect(displayed).toContain('Purchase now');
  expect(displayed).toContain('https://shop.example');
  expect(displayed).toContain('<b>literal</b>\nSecond line');
  expect(displayed).not.toContain('private=hidden');
});

test('tab approval uses target tab origin rather than current page', () => {
  const request = createApprovalRequest({ operation: 'CLOSE_TAB', target: 't1', confidence: 1 }, page);
  expect(request.label).toBe('Other account');
  expect(request.origin).toBe('https://account.example');
});

test('late approval cannot authorize a replacement request', async () => {
  const gate = new ApprovalGate();
  const first = gate.request('first', async () => {});
  const next = gate.request('next', async () => {});
  expect(await first).toBe(false);
  expect(gate.respond('first', true)).toBe(false);
  expect(gate.respond(undefined, true)).toBe(false);
  expect(gate.respond('next', true)).toBe(true);
  expect(await next).toBe(true);
  expect(gate.respond('next', true)).toBe(false);
});

test('approval expiration and publication failures fail closed', async () => {
  const gate = new ApprovalGate();
  expect(await gate.request('expired', async () => {}, 1)).toBe(false);
  expect(gate.respond('expired', true)).toBe(false);
  expect(await gate.request('failed', async () => { throw new Error('panel closed'); })).toBe(false);
  const pending = gate.request('stopped', async () => {});
  gate.cancel();
  expect(await pending).toBe(false);
});

test('default approval waits for an explicit choice without an expiry timer', async () => {
  const gate = new ApprovalGate();
  const timers = spyOn(globalThis, 'setTimeout');
  try {
    const pending = gate.request('human-choice', async () => {});
    expect(timers).not.toHaveBeenCalled();
    expect(gate.respond('human-choice', true)).toBe(true);
    expect(await pending).toBe(true);
  } finally { gate.cancel(); timers.mockRestore(); }
});
