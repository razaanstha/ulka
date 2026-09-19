import { expect, test } from 'bun:test';
import { formatConnectionChecks } from '../apps/extension/src/model-connection-summary';

test('synthetic Gateway failure details remain visible without clipboard export', () => {
  expect(formatConnectionChecks([
    { check: 'plain', status: 'passed', transport: { status: 200 } },
    { check: 'schema', status: 'failed', transport: { status: 403, responseBody: JSON.stringify({ error: { message: 'Synthetic access restriction' } }) } },
  ])).toContain('First failure (schema): Synthetic access restriction');
});

test('diagnostic summary handles plain errors and successful checks without fabricated detail', () => {
  expect(formatConnectionChecks([{ check: 'plain', status: 'failed', transport: {}, error: { message: 'Connection timed out' } }])).toContain('Connection timed out');
  expect(formatConnectionChecks([{ check: 'plain', status: 'passed', transport: { status: 200 } }])).not.toContain('First failure');
});
