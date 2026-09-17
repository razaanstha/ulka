import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderMarkdown } from '../apps/extension/src/markdown';
test('renders GFM tables, nested lists, emphasis and incomplete code fences', () => {
  const window = new Window(); const target = window.document.createElement('div');
  renderMarkdown(target as unknown as HTMLElement, '| Name | Value |\n| --- | --- |\n| *One* | ~~Old~~ |\n\n- Parent\n  - Child\n\n```ts\nconst value = 1;');
  expect(target.querySelectorAll('th')).toHaveLength(2);
  expect(target.querySelector('em')?.textContent).toBe('One');
  expect(target.querySelector('del')?.textContent).toBe('Old');
  expect(target.querySelector('li ul li')?.textContent).toBe('Child');
  expect(target.querySelector('pre code')?.textContent).toContain('const value = 1;');
});
test('renders formatting without interpreting HTML or unsafe links', () => {
  const window = new Window(); const target = window.document.createElement('div');
  renderMarkdown(target as unknown as HTMLElement, '# Result\n**Done**\n- First\n- Second\n```js\n<script>bad()</script>\n```\n[Source](https://example.com)\n[unsafe](javascript:alert(1))\n<img src=x onerror=bad()>');
  expect(target.querySelector('h3')?.textContent).toBe('Result');
  expect(target.querySelectorAll('li')).toHaveLength(2);
  expect(target.querySelector('strong')?.textContent).toBe('Done');
  expect(target.querySelectorAll('a')).toHaveLength(1);
  expect(target.querySelector('script,img')).toBeNull();
});
