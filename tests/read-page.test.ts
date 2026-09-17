import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { readPageExpression } from '../apps/extension/src/agent/read-page';

test('reads offscreen text but excludes hidden content and editable values', () => {
  const window = new Window({ url: 'https://example.test' });
  Object.defineProperty(window.HTMLElement.prototype, 'getClientRects', { configurable: true, value: () => [{ y: 10000, width: 200, height: 20 }] });
  window.document.body.innerHTML = '<p>Delivery takes three days</p><div style="display:none"><p>Hidden secret</p></div><textarea>Private input</textarea><div contenteditable="true">Private draft</div>';
  const result = window.eval(readPageExpression('Delivery', 0)).reading;
  expect(result.text).toContain('Delivery takes three days');
  const all = window.eval(readPageExpression('', 0)).reading.text;
  expect(all).not.toContain('Hidden secret');
  expect(all).not.toContain('Private');
  expect(window.scrollY).toBe(0);
});
test('paginates loaded text and treats query as data', () => {
  const window = new Window();
  Object.defineProperty(window.HTMLElement.prototype, 'getClientRects', { configurable: true, value: () => [{}] });
  window.document.body.textContent = 'a'.repeat(6500);
  const result = window.eval(readPageExpression('', 0)).reading;
  expect(result.text.length).toBe(6000);
  expect(result.nextOffset).toBe(6000);
  expect(window.eval(readPageExpression('', 6000)).reading.text.length).toBe(500);
  expect(window.eval(readPageExpression('";throw Error();', 0)).reading.matches).toBe(0);
});
