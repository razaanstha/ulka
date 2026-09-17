import { test, expect } from 'bun:test';
import { listDownloads } from '../apps/extension/src/agent/downloads';
import { compactToolResult } from '../apps/extension/src/agent/fx-agent';

test('download listing filters, bounds results and removes directory paths', async () => {
  const result = await listDownloads({ search: async query => {
    expect(query).toEqual({ limit: 10, orderBy: ['-startTime'], query: ['report'], state: 'in_progress' });
    return [{ id: 1, filename: '/Users/private/Downloads/report.pdf', state: 'in_progress', bytesReceived: 50, totalBytes: 100, paused: false, startTime: '2026-09-17', danger: 'safe', exists: true }];
  } }, { limit: 10, query: 'report', state: 'in_progress' });
  expect(result.downloads[0].filename).toBe('report.pdf');
  expect(result.downloads[0].progressPercent).toBe(50);
  expect(JSON.stringify(compactToolResult(result))).not.toContain('/Users/');
  expect((compactToolResult(result) as any).downloads).toHaveLength(1);
});
test('invalid limits rejected before accessing downloads', async () => {
  let accessed = false;
  await expect(listDownloads({ search: async () => { accessed = true; return []; } }, { limit: 0 })).rejects.toThrow();
  expect(accessed).toBe(false);
});
