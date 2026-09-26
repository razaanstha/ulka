import { expect, test } from 'bun:test';
import { UrlProvenance } from '../apps/extension/src/agent/url-provenance';

test('navigation accepts exact user URLs, observed links and known search homepages', () => {
  const urls = new UrlProvenance([{ role: 'user', content: 'Open https://example.test/report?year=2026.' }]);
  expect(urls.assertObserved('https://example.test/report?year=2026')).toBe('https://example.test/report?year=2026');
  expect(urls.assertObserved('https://www.google.com/')).toBe('https://www.google.com/');
  urls.recordBrowserResult({ page: { url: 'https://example.test/report?year=2026', controls: [{ href: 'https://example.test/detail/7' }] }, tabs: [{ url: 'https://other.test/' }] });
  expect(urls.assertObserved('https://example.test/detail/7')).toBe('https://example.test/detail/7');
  expect(urls.assertObserved('https://other.test/')).toBe('https://other.test/');
  urls.recordUserText('Use https://example.test/follow-up');
  expect(urls.assertObserved('https://example.test/follow-up')).toBe('https://example.test/follow-up');
});

test('navigation rejects guessed paths, query strings and model extracted URLs', () => {
  const urls = new UrlProvenance([{ role: 'user', content: 'Search example.test' }]);
  urls.recordBrowserResult({ status: 'extracted', result: { url: 'https://example.test/invented' } });
  expect(() => urls.assertObserved('https://example.test/invented')).toThrow('URL was not supplied');
  urls.recordBrowserResult({ page: { url: 'https://example.test/', controls: [{ href: 'https://example.test/items' }] } });
  expect(() => urls.assertObserved('https://example.test/items?page=2')).toThrow('URL was not supplied');
  expect(() => urls.assertObserved('https://example.test/other')).toThrow('URL was not supplied');
});
