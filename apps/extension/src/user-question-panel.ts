import type { PendingQuestion } from './agent/user-question';

export function createUserQuestionPanel(root: HTMLElement, send: (message: unknown) => Promise<unknown>, onAnswer: (question: string, answer: string) => void) {
  let pending: PendingQuestion | undefined;
  const close = (id?: string) => {
    if (id && pending?.id !== id) return;
    pending = undefined; root.replaceChildren(); root.hidden = true;
  };
  const show = (request: PendingQuestion) => {
    if (pending?.id === request.id) return;
    pending = request; root.replaceChildren(); root.hidden = false;
    const form = document.createElement('form');
    let submitting = false;
    const heading = document.createElement('h2'); heading.textContent = request.question;
    heading.id = 'user-question-heading'; form.setAttribute('aria-labelledby', heading.id);
    form.append(heading);
    const choices = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = 'Choose an answer'; legend.className = 'sr-only'; choices.append(legend);
    const radios: HTMLInputElement[] = [];
    for (const option of request.options ?? []) {
      const label = document.createElement('label'); label.className = 'question-choice';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'answer'; input.value = option;
      const caption = document.createElement('span'); caption.textContent = option;
      radios.push(input); label.append(input, caption); choices.append(label);
    }
    if (request.options?.length) form.append(choices);
    const label = document.createElement('label'); label.className = 'question-answer';
    const answerLabel = request.options?.length ? 'Or write your own' : 'Your answer';
    const text = document.createElement('textarea'); text.maxLength = 4000; text.rows = 1; text.placeholder = answerLabel + '…'; text.setAttribute('aria-label', answerLabel);
    label.append(text); form.append(label);
    text.addEventListener('input', () => { status.textContent = ''; if (text.value.trim()) radios.forEach(radio => { radio.checked = false; }); });
    radios.forEach(radio => radio.addEventListener('change', () => { status.textContent = ''; if (radio.checked) text.value = ''; }));
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Continue'; submit.className = 'question-submit';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Stop'; cancel.className = 'question-cancel'; cancel.setAttribute('aria-label', 'Stop task');
    cancel.addEventListener('click', () => { void send({ type: 'STOP' }).catch(() => { status.textContent = 'Could not stop. Try again.'; }); });
    const actions = document.createElement('div'); actions.className = 'question-actions'; actions.append(cancel, submit);
    form.append(status, actions); root.append(form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting || pending?.id !== request.id) return;
      const answer = text.value.trim() || radios.find(radio => radio.checked)?.value;
      if (!answer) { status.textContent = 'Choose an option or enter an answer.'; return; }
      submitting = true; submit.disabled = true; submit.textContent = 'Sending…'; status.textContent = '';
      try {
        const response = await send({ type: 'USER_ANSWER', questionId: request.id, answer }) as { ok?: boolean };
        if (!response?.ok) { status.textContent = 'This question is no longer waiting for an answer.'; return; }
        onAnswer(request.question, answer); close(request.id);
      } catch { status.textContent = 'Could not send answer. Try again.'; }
      finally { submitting = false; submit.disabled = false; submit.textContent = 'Continue'; }
    });
    (radios[0] ?? text).focus();
  };
  return { show, close };
}
