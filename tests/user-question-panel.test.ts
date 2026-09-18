import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createUserQuestionPanel } from '../apps/extension/src/user-question-panel';

test('question panel supports choices, custom answers, text-only input and cancellation', async () => {
  const window = new Window();
  const previous = globalThis.document;
  globalThis.document = window.document as unknown as Document;
  const sent: any[] = [], answers: string[] = [];
  try {
    const root = document.createElement('section'); document.body.append(root);
    const panel = createUserQuestionPanel(root, async message => { sent.push(message); return { ok: true }; }, (_, answer) => answers.push(answer));
    panel.show({ id: 'one', question: '<script>Which airport?</script>', options: ['Oslo', 'Bergen'] });
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelectorAll('input[type=radio]')).toHaveLength(2);
    expect(root.querySelector('input:checked')).toBeNull();
    root.querySelector('form')!.dispatchEvent(new window.Event('submit', { cancelable: true }) as unknown as Event);
    expect(sent).toHaveLength(0);
    const radio = root.querySelector<HTMLInputElement>('input')!; radio.checked = true;
    const text = root.querySelector('textarea')!; text.value = 'Trondheim'; text.dispatchEvent(new window.Event('input') as unknown as Event);
    expect(radio.checked).toBe(false);
    root.querySelector('form')!.dispatchEvent(new window.Event('submit', { cancelable: true }) as unknown as Event);
    await Promise.resolve();
    expect(sent[0]).toEqual({ type: 'USER_ANSWER', questionId: 'one', answer: 'Trondheim' });
    expect(answers).toEqual(['Trondheim']); expect(root.hidden).toBe(true);
    panel.show({ id: 'two', question: 'When?' });
    expect(root.querySelector('fieldset')).toBeNull();
    panel.close('one'); expect(root.hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('button[type=button]')!.click();
    expect(sent.at(-1)).toEqual({ type: 'STOP' });
    panel.close('two'); expect(root.hidden).toBe(true);
  } finally { globalThis.document = previous; await window.happyDOM.abort(); window.close(); }
});

test('question submission ignores duplicates and clears corrected validation errors', async () => {
  const window = new Window();
  const previous = globalThis.document;
  globalThis.document = window.document as unknown as Document;
  try {
    const root = document.createElement('section');
    let calls = 0;
    let resolve!: (value: unknown) => void;
    const panel = createUserQuestionPanel(root, async () => {
      calls++; return new Promise(done => { resolve = done; });
    }, () => {});
    panel.show({ id: 'q', question: 'Where?' });
    const form = root.querySelector('form')!;
    const submit = () => form.dispatchEvent(new window.Event('submit', { cancelable: true }) as unknown as Event);
    submit();
    expect(root.querySelector('[role=status]')!.textContent).toContain('enter an answer');
    const input = root.querySelector('textarea')!;
    input.value = 'Oslo'; input.dispatchEvent(new window.Event('input') as unknown as Event);
    expect(root.querySelector('[role=status]')!.textContent).toBe('');
    submit(); submit();
    expect(calls).toBe(1);
    expect(root.querySelector('button[type=submit]')!.textContent).toBe('Sending…');
    resolve({ ok: true }); await Promise.resolve(); await Promise.resolve();
  } finally { globalThis.document = previous; await window.happyDOM.abort(); window.close(); }
});
