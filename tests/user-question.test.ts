import { expect, test } from 'bun:test';
import { UserQuestionGate } from '../apps/extension/src/agent/user-question';

test('question waits for matching nonempty answer, accepting custom text without a deadline', async () => {
  const gate = new UserQuestionGate();
  const controller = new AbortController();
  let settled = false;
  const pending = gate.ask({ question: 'Which airport?', options: ['Oslo', 'Bergen'] }, controller.signal, async () => {});
  void pending.then(() => { settled = true; });
  await Bun.sleep(15);
  expect(settled).toBe(false);
  const id = gate.current!.id;
  expect(gate.respond('old-question', 'Oslo')).toBe(false);
  expect(gate.respond(id, ' ')).toBe(false);
  expect(gate.respond(id, 'Trondheim')).toBe(true);
  expect(await pending).toBe('Trondheim');
  expect(gate.current).toBeUndefined();
  expect(gate.respond(id, 'Bergen')).toBe(false);
});

test('Stop rejects pending question and stale answers cannot resume the next question', async () => {
  const gate = new UserQuestionGate(), controller = new AbortController();
  const first = gate.ask({ question: 'Dates?' }, controller.signal, async () => {});
  void first.catch(() => {});
  const id = gate.current!.id;
  controller.abort(new Error('User stopped'));
  await expect(first).rejects.toThrow('User stopped');
  const second = gate.ask({ question: 'New dates?' }, new AbortController().signal, async () => {});
  expect(gate.respond(id, 'Tomorrow')).toBe(false);
  gate.respond(gate.current!.id, 'October 5');
  expect(await second).toBe('October 5');
});

test('failed question publication releases pending state', async () => {
  const gate = new UserQuestionGate();
  await expect(gate.ask({ question: 'Dates?' }, new AbortController().signal, async () => { throw new Error('Panel unavailable'); })).rejects.toThrow('Panel unavailable');
  expect(gate.current).toBeUndefined();
});
