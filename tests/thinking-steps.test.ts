import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { renderThinkingSteps } from '../apps/extension/src/thinking-steps';

test('only latest thinking step remains while streaming and after completion', () => {
  const window = new Window();
  const root = window.document.createElement('div') as unknown as HTMLElement;
  renderThinkingSteps(root, 'Checking tabs. Reading the');
  const spinner = root.querySelector('.thinking-spinner');
  expect(root.textContent).toBe('Reading the');
  renderThinkingSteps(root, 'Checking tabs. Reading the page.');
  expect(root.textContent).toBe('Reading the page.');
  expect(root.querySelector('.thinking-spinner')).toBe(spinner);
  expect(root.querySelectorAll('.thinking-latest-text')).toHaveLength(1);
  renderThinkingSteps(root, 'Checking tabs. Reading the page.', true);
  expect(root.querySelector('.is-finished')).not.toBeNull();
  expect(root.textContent).toBe('Reading the page.');
  window.close();
});

test('latest list item retains safe formatting without earlier steps', () => {
  const window = new Window();
  const root = window.document.createElement('div') as unknown as HTMLElement;
  renderThinkingSteps(root, '- Inspect tabs\n- **Read** page\n\n<script>alert(1)</script>');
  expect(root.textContent).toBe('Read page');
  expect(root.querySelector('strong')?.textContent).toBe('Read');
  expect(root.querySelector('script')).toBeNull();
  window.close();
});

test('WAAPI animates step changes, avoids token restarts, and cancels on finish', () => {
  const window = new Window();
  const originalAnimate = window.HTMLElement.prototype.animate;
  const calls: Array<{ name: string; cancelled: boolean }> = [];
  try {
    window.HTMLElement.prototype.animate = function (this: { className: string }) {
      const call = { name: this.className, cancelled: false }; calls.push(call);
      return { cancel: () => { call.cancelled = true; } } as unknown as Animation;
    } as any;
    const root = window.document.createElement('div') as unknown as HTMLElement;
    renderThinkingSteps(root, 'Checking tabs. Reading');
    expect(calls.map(call => call.name)).toEqual(['thinking-spinner', 'thinking-latest-text']);
    renderThinkingSteps(root, 'Checking tabs. Reading page.');
    expect(calls).toHaveLength(2);
    renderThinkingSteps(root, 'Checking tabs. Reading page. Comparing results.');
    expect(calls).toHaveLength(3);
    expect(calls[1].cancelled).toBe(true);
    renderThinkingSteps(root, 'Checking tabs. Reading page. Comparing results.', true);
    expect(calls.every(call => call.cancelled)).toBe(true);
  } finally {
    window.HTMLElement.prototype.animate = originalAnimate;
    window.close();
  }
});

test('reduced motion renders latest text without WAAPI', () => {
  const window = new Window();
  const originalAnimate = window.HTMLElement.prototype.animate;
  const originalMatchMedia = window.matchMedia;
  try {
    window.matchMedia = (() => ({ matches: true })) as any;
    window.HTMLElement.prototype.animate = (() => { throw new Error('Unexpected animation'); }) as any;
    const root = window.document.createElement('div') as unknown as HTMLElement;
    renderThinkingSteps(root, 'First step. Latest step.');
    expect(root.textContent).toBe('Latest step.');
  } finally {
    window.HTMLElement.prototype.animate = originalAnimate;
    window.matchMedia = originalMatchMedia;
    window.close();
  }
});
