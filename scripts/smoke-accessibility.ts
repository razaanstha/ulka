// Isolated real-Chromium regression. Does not use the user's profile or websites.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { CdpObserver } from '../apps/extension/src/agent/observer';
import { FreshnessValidator } from '../apps/extension/src/agent/freshness';
import { BrowserExecutor } from '../apps/extension/src/agent/executor';
import { AgentRunner } from '../apps/extension/src/agent/agent-runner';
const profile = await mkdtemp(join(tmpdir(), 'ulka-ax-smoke-'));
const browser = Bun.spawn([process.env.BROWSER_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdout: 'ignore', stderr: 'ignore' });
let ws: WebSocket | undefined;
try {
  let port = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await Bun.sleep(100); }
  }
  assert(port, 'Chrome debugging endpoint did not start');
  const endpoint = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
  ws = new WebSocket(endpoint.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { ws!.onopen = () => resolve(); ws!.onerror = reject; });
  let next = 0;
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
  ws.onmessage = event => { const message = JSON.parse(String(event.data)); const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); };
  const command = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const html = `<button id="message">Message</button><script>message.onclick=()=>setTimeout(()=>{document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-label="Conversation with Raju"><h2>New message</h2><div contenteditable="plaintext-only" aria-label="Write a message" aria-multiline="true" style="width:300px;height:100px;border:1px solid"><br></div><button disabled>Send</button></div>')},1200)</script>`;
  const { targetId } = await command('Target.createTarget', { url: `data:text/html,${encodeURIComponent(html)}` });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  for (let attempt=0; attempt<50; attempt++) {
    const ready = await command('Runtime.evaluate', {expression: 'document.readyState === \"complete\" && !!document.getElementById(\"message\")', returnByValue: true}, sessionId);
    if (ready.result?.value) break;
    await Bun.sleep(100);
  }
  let axReads = 0;
  const api = { attach: async () => {}, detach: async () => {}, sendCommand: (_: unknown, method: string, params?: Record<string, unknown>) => {
    if (method === 'Accessibility.getFullAXTree') axReads++;
    return command(method, params, sessionId);
  } };
  const target = { tabId: 1 };
  const observer = new CdpObserver(api, target);
  const before = await observer.observe();
  assert.equal(before.diagnostics?.source, 'accessibility');
  const message = before.elements.find(e => e.label === 'Message');
  assert(message, 'Message button missing: ' + JSON.stringify(before.diagnostics));
  const validator = new FreshnessValidator(api, target);
  const executor = new BrowserExecutor(api, target, validator);
  await executor.execute(before, { operation: 'CLICK', target: message.id, confidence: 1 });
  const after = await observer.waitForChange(before);
  const editor = after.elements.find(e => e.label === 'Write a message');
  assert(editor, 'Delayed chat editor missing from settled observation');
  assert.equal(editor.role, 'textbox');
  assert(editor.operations.includes('TYPE_TEXT'));
  assert(editor.context?.some(c => c.role === 'dialog' && c.label === 'Conversation with Raju'));
  const send = after.elements.find(e => e.label === 'Send');
  assert.equal(send?.availability, 'disabled');
  assert.deepEqual(send?.operations, []);
  await executor.execute(after, { operation: 'TYPE_TEXT', target: editor.id, confidence: 1 }, 'Local test draft');
  const typed = await observer.observe();
  assert.equal(typed.elements.find(e => e.label === 'Write a message')?.value, 'Local test draft');
  // Reproduce repeated message replacement through the real browser pipeline.
  // No provider requests or real messages are needed for this control-loop test.
  const draft = 'A complete local greeting. '.repeat(45);
  let draftDecisions = 0, draftWrites = 0;
  const draftRunner = () => new AgentRunner(observer, {
    decide: async (_goal, page) => {
      draftDecisions++;
      return { operation: 'TYPE_TEXT', target: page.elements.find(e => e.label === 'Write a message')!.id, confidence: 1 };
    },
  }, { execute: async (page, decision, text) => { draftWrites++; await executor.execute(page, decision, text); } } as BrowserExecutor,
  undefined, { completionMode: 'subgoal' }, { generate: async () => draft });
  const drafted = await draftRunner().run('Draft a greeting without sending');
  assert.equal(drafted.status, 'checkpoint', 'Successful typing must hand off before repeated replacement');
  assert.equal(draftDecisions, 1);
  assert.equal(draftWrites, 1);
  assert.equal((await observer.observe()).elements.find(e => e.label === 'Write a message')?.value, draft);
  const matching = await draftRunner().run('Keep the existing greeting without sending');
  assert.equal(matching.status, 'checkpoint');
  assert.equal(matching.history.length, 0, 'Matching value is evidence, not a new execution');
  assert.equal(draftWrites, 1, 'Matching complete value must not be inserted again');
  await command('Runtime.evaluate', { expression: `document.body.innerHTML = '<div role="dialog" aria-label="Messaging" style="position:fixed;bottom:0;left:20px;width:320px;height:32px;overflow:hidden"><header tabindex="0" style="height:32px">Raju Shrestha</header><div contenteditable="true" role="textbox" aria-label="Write a message" style="height:100px">draft</div></div>'; document.querySelector('header').onclick=()=>document.querySelector('[role=dialog]').style.height='180px';` }, sessionId);
  const minimized = await observer.observe();
  const opener = minimized.elements.find(e => e.label === 'Raju Shrestha');
  const blockedEditor = minimized.elements.find(e => e.label === 'Write a message');
  assert(opener?.operations.includes('CLICK'), 'Focusable chat opener was discarded');
  assert.equal(blockedEditor?.operations.length, 0, 'Minimized editor should not be actionable');
  await executor.execute(minimized, { operation: 'CLICK', target: opener!.id, confidence: 1 });
  const expanded = await observer.waitForChange(minimized);
  assert(expanded.elements.find(e => e.label === 'Write a message')?.operations.includes('TYPE_TEXT'), 'Editor did not become actionable after expanding chat');
  // A stable loading message must not end settling before the editor mounts.
  for (let trial = 0; trial < 3; trial++) {
    await command('Runtime.evaluate', { expression: `document.body.innerHTML = '<button id="open-editor">Open editor</button><div id="loading-status"></div>'; document.getElementById('open-editor').onclick=()=>{ document.getElementById('loading-status').textContent='Loading'; setTimeout(()=>{document.getElementById('loading-status').textContent='Ready'; document.body.insertAdjacentHTML('beforeend','<input aria-label="Delayed destination">')},1200); };` }, sessionId);
    const initial = await observer.observe();
    await executor.execute(initial, { operation: 'CLICK', target: initial.elements.find(e => e.label === 'Open editor')!.id, confidence: 1 });
    const settled = await observer.waitForChange(initial);
    assert(settled.elements.some(e => e.label === 'Delayed destination'), 'Loading indicator caused premature settling');
  }
  // Dense pages must retain executable targets after the former 250-row limit.
  await command('Runtime.evaluate', { expression: `document.body.innerHTML = '<div style="display:grid;grid-template-columns:repeat(25,24px);gap:1px">' + Array.from({length:300},(_,i)=>'<button aria-label="Action '+(i+1)+'" style="width:24px;height:24px;padding:0">'+(i+1)+'</button>').join('') + '</div>'; document.querySelector('button:last-child').onclick=()=>document.body.dataset.lastClicked='yes';` }, sessionId);
  const dense = await observer.observe();
  assert.equal(dense.elements.filter(e => e.operations.includes('CLICK')).length, 300);
  const finalButton = dense.elements.find(e => e.label === 'Action 300')!;
  await executor.execute(dense, { operation: 'CLICK', target: finalButton.id, confidence: 1 });
  const clicked = await command('Runtime.evaluate', { expression: 'document.body.dataset.lastClicked', returnByValue: true }, sessionId);
  assert.equal(clicked.result.value, 'yes', 'Last visible target must be executable, not merely listed');
  // Same-origin embedded app: LinkedIn mounts messaging in /preload/.
  await command('Runtime.evaluate', { expression: `document.body.innerHTML = '<iframe style="position:absolute;left:70px;top:90px;width:500px;height:350px;border:4px solid"></iframe>'; const frame = document.querySelector('iframe'); frame.contentDocument.body.innerHTML = '<div role="dialog" aria-label="Embedded conversation"><div contenteditable="true" role="textbox" aria-label="Embedded message" style="width:300px;height:100px;border:1px solid"><br></div><button disabled>Send</button></div>';` }, sessionId);
  const embedded = await observer.observe();
  const embeddedEditor = embedded.elements.find(e => e.label === 'Embedded message');
  assert(embeddedEditor?.operations.includes('TYPE_TEXT'), 'Same-origin iframe editor missing');
  await executor.execute(embedded, { operation: 'TYPE_TEXT', target: embeddedEditor.id, confidence: 1 }, 'Frame draft');
  const embeddedTyped = await observer.observe();
  assert.equal(embeddedTyped.elements.find(e => e.label === 'Embedded message')?.value, 'Frame draft');
  await executor.execute(embeddedTyped, { operation: 'ARROW_DOWN', target: embeddedTyped.elements.find(e => e.label === 'Embedded message')!.id, confidence: 1 });
  await command('Runtime.evaluate', { expression: `document.body.insertAdjacentHTML('beforeend', '<div id="cover" style="position:fixed;inset:0;z-index:9999;background:white"></div>');` }, sessionId);
  await assert.rejects(() => validator.validateTarget(embeddedTyped, embeddedTyped.elements.find(e => e.label === 'Embedded message')!.id));
  await command('Runtime.evaluate', { expression: `document.getElementById('cover').remove(); document.querySelector('iframe').style.display='none';` }, sessionId);
  await assert.rejects(() => validator.validateTarget(embeddedTyped, embeddedTyped.elements.find(e => e.label === 'Embedded message')!.id));
  assert(!(await observer.observe()).elements.some(e => e.label === 'Embedded message' && e.operations.length), 'Hidden frame editor remained actionable');
  await command('Runtime.evaluate', { expression: `document.body.innerHTML = '<div id="shadow-host"></div>'; document.getElementById('shadow-host').attachShadow({mode:'open'}).innerHTML = '<div role="dialog" aria-label="Shadow conversation"><div contenteditable="true" role="textbox" aria-label="Shadow message" style="width:300px;height:100px;border:1px solid"><br></div><button disabled>Send</button></div>';` }, sessionId);
  const shadow = await observer.observe();
  const shadowEditor = shadow.elements.find(e => e.label === 'Shadow message');
  assert(shadowEditor?.operations.includes('TYPE_TEXT'), 'Shadow editor incorrectly marked occluded');
  await executor.execute(shadow, { operation: 'TYPE_TEXT', target: shadowEditor.id, confidence: 1 }, 'Shadow draft');
  const shadowTyped = await observer.observe();
  assert.equal(shadowTyped.elements.find(e => e.label === 'Shadow message')?.value, 'Shadow draft');
  await command('Runtime.evaluate', { expression: `document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;z-index:9999;background:white"></div>');` }, sessionId);
  await assert.rejects(() => validator.validateTarget(shadowTyped, shadowTyped.elements.find(e => e.label === 'Shadow message')!.id));
  await command('Runtime.evaluate', { expression: `document.body.innerHTML = '<input aria-label="Departure"><input aria-label="Return">'; const fields=document.querySelectorAll('input'); fields[0].onclick=()=>fields[1].focus();` }, sessionId);
  const redirected = await observer.observe();
  const departure = redirected.elements.find(e => e.label === 'Departure')!;
  await assert.rejects(() => executor.execute(redirected, { operation: 'TYPE_TEXT', target: departure.id, confidence: 1 }, 'October 5'), /focus|changed/i);
  const afterRedirect = await command('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('input'),e=>e.value)`, returnByValue: true }, sessionId);
  assert.deepEqual(afterRedirect.result.value, ['', ''], 'Typing must not leak into redirected field');
  await command('Runtime.evaluate', { expression: `document.body.innerHTML = '<button id="increment">Increment</button><span id="count">0</span>'; document.getElementById('increment').onclick=()=>{const count=document.getElementById('count');count.textContent=String(Number(count.textContent)+1)};` }, sessionId);
  const simple = await observer.observe();
  const axReadsBeforeFastActions = axReads;
  await executor.execute(simple, { operation: 'CLICK', target: simple.elements.find(e => e.label === 'Increment')!.id, confidence: 1 });
  const fast = await observer.waitForChange(simple);
  assert.equal(fast.diagnostics?.source, 'dom-fast', 'Matching simple controls should skip the second AX scan');
  assert(fast.text.includes('1'), 'Fast DOM result must include new page state');
  await executor.execute(fast, { operation: 'CLICK', target: fast.elements.find(e => e.label === 'Increment')!.id, confidence: 1 });
  const fastAgain = await observer.waitForChange(fast);
  assert.equal(fastAgain.diagnostics?.source, 'dom-fast', 'A second matching action should keep the fast DOM path');
  assert(fastAgain.text.includes('2'), 'Second fast DOM result must include new page state');
  assert.equal(axReads, axReadsBeforeFastActions, 'Stable controls should require no further AX tree reads');
  console.log('PASS: real AX observation, fast DOM settling, delayed chat opening, disabled Send context, fresh DOM targeting, rich-text typing, minimized-chat recovery, iframe discovery/typing/focus, hidden and covered iframe rejection, shadow editor typing and overlay rejection');
} finally {
  ws?.close();
  browser.kill();
  await browser.exited;
  await rm(profile, { recursive: true, force: true });
}
