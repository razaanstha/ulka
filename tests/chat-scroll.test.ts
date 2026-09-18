import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createChatScroll } from '../apps/extension/src/chat-scroll';

function fixture() {
  const window = new Window();
  const element = window.document.createElement('div');
  let height = 1000, top = 600;
  Object.defineProperties(element, {
    scrollHeight: { get: () => height }, clientHeight: { get: () => 400 },
    scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(value, height - 400)); } },
  });
  const scroll = createChatScroll(element as unknown as HTMLElement);
  return { element, scroll, grow: () => { height += 100; }, move: (value: number) => {
    element.scrollTop = value; element.dispatchEvent(new window.Event('scroll'));
  }, up: () => element.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -20 })) };
}

test('stream follows bottom but small upward scroll holds reading position', () => {
  const f = fixture();
  f.scroll.update(f.grow); expect(f.element.scrollTop).toBe(700);
  f.move(680);
  f.scroll.update(f.grow); expect(f.element.scrollTop).toBe(680);
  f.move(800);
  f.scroll.update(f.grow); expect(f.element.scrollTop).toBe(900);
});

test('upward wheel stops following before delayed scroll event', () => {
  const f = fixture(); f.up();
  f.scroll.update(f.grow); expect(f.element.scrollTop).toBe(600);
  f.scroll.bottom(); expect(f.element.scrollTop).toBe(700);
  f.scroll.update(f.grow); expect(f.element.scrollTop).toBe(800);
});

test('replacing streamed content preserves paused scroll offset', () => {
  const f = fixture(); f.move(300);
  f.scroll.update(() => { f.element.scrollTop = 0; f.grow(); });
  expect(f.element.scrollTop).toBe(300);
});
