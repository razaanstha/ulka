import { expect, test } from 'bun:test';
import { Window, type HTMLElement, type HTMLTextAreaElement, type HTMLButtonElement } from 'happy-dom';
import { ModelUsageLedger } from '../apps/extension/src/agent/model-usage';

test('panel scopes live usage to request, saves final totals, restores history, and excludes metadata from prompts', async () => {
  const window = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  const stored: Record<string, any> = {};
  let listener: (value: unknown) => void = () => {};
  let request: any;
  let finish!: (response: unknown) => void;
  Object.assign(window, { structuredClone, chrome: {
    storage: { local: { get: async () => structuredClone(stored), set: async (data: object) => { Object.assign(stored, structuredClone(data)); } } },
    runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, sendMessage: (message: any) => {
      if (message.type === 'USER_ANSWER') return Promise.resolve({ ok: true });
      request = message; return new Promise(resolve => { finish = resolve; });
    } },
  } });
  try {
    window.document.write((await Bun.file('apps/extension/public/sidepanel.html').text()).replace(/<script[\s\S]*?<\/script>/g, ''));
    window.eval(await Bun.file('apps/extension/dist/sidepanel.js').text());
    await new Promise(resolve => setTimeout(resolve, 0));
    const prompt = window.document.querySelector<HTMLTextAreaElement>('#prompt')!;
    const settings = window.document.querySelector<HTMLElement>('#settings')!;
    const settingsToggle = window.document.querySelector<HTMLButtonElement>('#settings-toggle')!;
    settingsToggle.click();
    expect(settings.hidden).toBe(false);
    expect(settings.parentElement!.tagName).toBe('HEADER');
    expect(window.document.activeElement!.id).toBe('api-key');
    settings.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(settings.hidden).toBe(true);
    expect(window.document.activeElement).toBe(settingsToggle);
    settingsToggle.click();
    window.document.querySelector<HTMLButtonElement>('#history-toggle')!.click();
    expect(settings.hidden).toBe(true);
    expect(window.document.querySelector<HTMLElement>('#history')!.hidden).toBe(false);
    window.document.body.click();
    expect(window.document.querySelector<HTMLElement>('#history')!.hidden).toBe(true);

    prompt.value = 'Read this page';
    window.document.querySelector<HTMLButtonElement>('#send')!.click();
    expect((window.document.querySelector('.usage-summary') as HTMLElement).hidden).toBe(true);
    const ledger = new ModelUsageLedger();
    ledger.record('fx_turn', { inputTokens: 100, outputTokens: 10 });
    listener({ type: 'MODEL_USAGE', requestId: 'other-task', usage: ledger.summary() });
    expect((window.document.querySelector('.usage-summary') as HTMLElement).hidden).toBe(true);
    listener({ type: 'MODEL_USAGE', requestId: request.requestId, usage: ledger.summary() });
    expect((window.document.querySelector('.usage-summary') as HTMLElement).hidden).toBe(false);
    expect(window.document.querySelector('.usage-summary')!.textContent).toContain('110 tokens');
    ledger.record('verification', { inputTokens: 20, outputTokens: 5 });
    finish({ ok: true, result: { reply: 'Page summary' }, usage: ledger.summary() });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.document.querySelector('.usage-summary')!.textContent).toContain('135 tokens');
    expect(window.document.querySelector('.usage-summary')!.textContent).not.toContain('Updating');
    expect(stored.ulkaChats[0].messages[1].usage.inputTokens).toBe(120);
    window.document.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click();
    window.document.querySelector<HTMLButtonElement>('#history-toggle')!.click();
    window.document.querySelector<HTMLButtonElement>('.history-entry')!.click();
    expect(window.document.querySelector('.usage-summary')!.textContent).toContain('135 tokens');
    prompt.value = 'Continue'; window.document.querySelector<HTMLButtonElement>('#send')!.click();
    expect(request.messages[1]).toEqual({ role: 'assistant', content: 'Page summary' });
    listener({ type: 'FX_PROGRESS', text: 'Useful partial finding' });
    finish({ ok: true, result: { status: 'stopped', reply: 'Stopped.' }, usage: ledger.summary() });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stored.ulkaChats[0].messages.at(-1).content).toContain('Useful partial finding');
    expect(stored.ulkaChats[0].messages.at(-1).content).toContain('Completion not verified');
    expect(window.document.querySelector('#state')!.textContent).toBe('Stopped');
    expect(window.document.querySelectorAll('.usage-summary')).toHaveLength(2);
    expect(window.document.querySelectorAll('.usage-summary')[1]!.textContent).toContain('Partial');
    prompt.value = 'Try verification'; window.document.querySelector<HTMLButtonElement>('#send')!.click();
    listener({ type: 'FX_PROGRESS', text: 'First finding' });
    listener({ type: 'FX_REASONING', text: 'Evidence collected' });
    const reason = 'Completion check unavailable (invalid verification response). Work remains unverified.';
    finish({ ok: true, result: { status: 'blocked', reply: 'Full preserved response', partialReply: 'First finding\nSecond finding', interruptionReason: reason } });
    await new Promise(resolve => setTimeout(resolve, 0));
    const saved = stored.ulkaChats[0].messages.at(-1).content;
    expect(saved).toContain('First finding\nSecond finding');
    expect(saved.split(reason)).toHaveLength(2);
    expect(window.document.querySelectorAll('.thinking-box')[1]!.hasAttribute('open')).toBe(true);
    expect(window.document.querySelector('#chat')?.textContent ?? window.document.body.textContent).toContain('Second finding');
    prompt.value = 'Plan a trip'; window.document.querySelector<HTMLButtonElement>('#send')!.click();
    listener({ type: 'FX_PROGRESS', text: 'Found two routes.' });
    listener({ type: 'USER_QUESTION', question: { id: 'airport', question: 'Which airport?', options: ['Oslo', 'Bergen'] } });
    const answer = window.document.querySelector<HTMLTextAreaElement>('#user-question textarea')!;
    answer.value = 'Oslo';
    window.document.querySelector('#user-question form')!.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    listener({ type: 'FX_PROGRESS', text: 'Selected Oslo route.' });
    finish({ ok: true, result: { status: 'done', reply: 'Found two routes.Selected Oslo route.' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    const lastMessages = stored.ulkaChats[0].messages.slice(-3);
    expect(lastMessages.map((m: any) => m.content)).toEqual(['Found two routes.', 'Answer to clarification "Which airport?": Oslo', 'Selected Oslo route.']);
    const card = window.document.querySelector('.clarification')!;
    expect(card.textContent).toContain('Which airport?');
    expect(card.textContent).toContain('Oslo');
    expect(card.previousElementSibling!.textContent!.trim()).toBe('Found two routes.');
    expect(card.nextElementSibling!.textContent!.trim()).toBe('Selected Oslo route.');
    window.document.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click();
    window.document.querySelector<HTMLButtonElement>('#history-toggle')!.click();
    window.document.querySelector<HTMLButtonElement>('.history-entry')!.click();
    expect(window.document.querySelector('.clarification')!.textContent).toContain('Which airport?');


  } finally { await window.happyDOM.abort(); window.close(); }
});
