import { expect, test } from 'bun:test';
import { preservePartialResponse } from '../apps/extension/src/partial-response';

test('interruption retains complete streamed text and clearly marks it unverified', () => {
  const result = preservePartialResponse('First finding\n\nSecond finding', 'Stopped.');
  expect(result).toContain('First finding\n\nSecond finding');
  expect(result).toContain('Completion not verified');
  expect(result.endsWith('Stopped.')).toBe(true);
});

test('interruption before output displays only the reason', () => {
  expect(preservePartialResponse('  ', 'Connection lost')).toBe('Connection lost');
});

test('verification notice follows response with real paragraph breaks', () => {
  const result = preservePartialResponse('Useful finding', 'Verification unavailable.');
  expect(result.startsWith('Useful finding\n\n')).toBe(true);
  expect(result).not.toContain(String.raw`\n`);
});
