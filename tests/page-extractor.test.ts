import { describe, expect, test } from 'bun:test';
import { PageExtractor } from '../apps/extension/src/agent/page-extractor';
import type { PageSnapshot } from '../packages/protocol/src';

const page = (): PageSnapshot => ({
  snapshotId: 's', fingerprint: 'f', pageIdentity: 'p', url: 'https://example.test', title: 'Example', text: 'Price $12',
  scroll: { y: 0, height: 100, viewportHeight: 100 }, createdAt: 0, elements: [], guards: {},
});

describe('page extractor', () => {
  test('builds typed schema and returns validated structured data', async () => {
    let request: any;
    const extractor = new PageExtractor('key', async input => {
      request = input;
      return { output: { price: 12, available: true }, usage: { inputTokens: 1, outputTokens: 1 } };
    });
    await expect(extractor.extract({ instruction: 'Read product details', fields: [
      { name: 'price', description: 'Price in dollars', type: 'number' },
      { name: 'available', description: 'Whether available', type: 'boolean' },
    ] }, page())).resolves.toEqual({ price: 12, available: true });
    expect(request.prompt).toContain('Price $12');
  });

  test('rejects malformed extracted output', async () => {
    const extractor = new PageExtractor('key', async () => ({ output: { price: 'twelve' } }));
    await expect(extractor.extract({ instruction: 'Read price', fields: [{ name: 'price', description: 'Price', type: 'number' }] }, page())).rejects.toThrow();
  });
});
