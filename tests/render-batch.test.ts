import { expect, test } from 'bun:test';
import { createRenderBatch } from '../apps/extension/src/render-batch';

function fixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  let source = '';
  const painted: string[] = [];
  const batch = createRenderBatch(() => painted.push(source), callback => {
    frames.set(++next, callback); return next;
  }, id => { frames.delete(id); });
  return { batch, frames, painted, append(text: string) { source += text; batch.request(); },
    paint() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); } };
}

test('stream bursts render once per frame with every accumulated chunk', () => {
  const f = fixture();
  for (let i = 0; i < 400; i++) f.append('chunk ');
  expect(f.frames.size).toBe(1);
  expect(f.painted).toEqual([]);
  f.paint();
  expect(f.painted).toEqual(['chunk '.repeat(400)]);
  f.append('next'); f.paint();
  expect(f.painted[1]).toBe('chunk '.repeat(400) + 'next');
});

test('clarification flush paints pending output once before moving messages', () => {
  const f = fixture(); f.append('Before question'); f.batch.flush();
  expect(f.painted).toEqual(['Before question']);
  expect(f.frames.size).toBe(0);
  f.batch.flush(); f.paint();
  expect(f.painted).toHaveLength(1);
});

test('completion cancels pending paints and allows the next run to schedule', () => {
  const f = fixture(); f.append('Old output'); f.batch.cancel(); f.paint();
  expect(f.painted).toEqual([]);
  f.append(' New output'); f.paint();
  expect(f.painted).toEqual(['Old output New output']);
});
