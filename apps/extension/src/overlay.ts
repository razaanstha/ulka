import { chromeApi } from './chrome';

let overlay: HTMLElement | undefined;
let statusText: Element | null = null;
function hide() { overlay?.remove(); overlay = undefined; statusText = null; }
chromeApi.runtime.onMessage.addListener(raw => {
  const message = raw as { type?: string; active?: boolean; detail?: string };
  if (message.type !== 'ULKA_OVERLAY') return;
  if (!message.active) { hide(); return; }
  if (overlay?.isConnected) { if (message.detail && statusText) statusText.textContent = message.detail; return; }
  overlay = document.createElement('div');
  overlay.setAttribute('data-ulka-overlay', '');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const root = overlay.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host{all:initial;pointer-events:none}
    *{box-sizing:border-box}
    /* Animated perimeter only: page remains clear and interactive. */
    .edges{position:fixed;inset:0;pointer-events:none;background:linear-gradient(115deg,#00d9ed,#4d7cff 25%,#ff7595 48%,#ffc979 66%,#00e6be 82%,#00d9ed);background-size:400% 400%;mask:linear-gradient(#000,#000) top/100% 4px no-repeat,linear-gradient(#000,#000) bottom/100% 4px no-repeat,linear-gradient(#000,#000) left/4px 100% no-repeat,linear-gradient(#000,#000) right/4px 100% no-repeat;animation:perimeter-flow 3.5s ease-in-out infinite alternate}
    @keyframes perimeter-flow{0%{background-position:0% 20%}50%{background-position:100% 80%}100%{background-position:20% 100%}}
    .card{position:fixed;right:20px;bottom:20px;max-width:calc(100vw - 32px);pointer-events:auto;display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:12px;border:1px solid #e7e7e7;border-radius:18px;background:#fcfcfc;box-shadow:0 8px 32px #19213a18;color:#242424;font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .orb{width:24px;height:24px;flex-shrink:0;border-radius:50%;border:3px solid #e4e7eb;border-top-color:#555;animation:rotate 1.2s linear infinite}
    @keyframes rotate{to{transform:rotate(360deg)}}
    .copy{min-width:0}.title{font-size:12px;font-weight:600}.detail{font-size:11px;color:#747780;margin-top:2px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .actions{display:flex;gap:6px}
    button{font:500 12px system-ui,sans-serif;border:1px solid #e1e2e5;background:#fff;color:#36383c;border-radius:12px;padding:9px 12px;cursor:pointer;white-space:nowrap}
    button:hover{background:#f0f0f2}button:last-child{background:#171819;color:white;border-color:#171819}button:last-child:hover{background:#353639}button:disabled{opacity:.5;cursor:wait}button:focus-visible{outline:2px solid #555;outline-offset:3px}
    @media(max-width:500px){.card{right:12px;bottom:12px;gap:8px}.orb{display:none}.detail{max-width:120px}button{padding:9px}}
    @media(prefers-reduced-motion:reduce){.orb,.edges{animation:none}}
  </style><div class="edges" aria-hidden="true"></div><section class="card" aria-label="Ulka browser control"><span class="orb" aria-hidden="true"></span><div class="copy"><div class="title">Agent in progress</div><div class="detail" role="status">Working in your browser</div></div><div class="actions"><button data-action="stop" title="Cancel this task">Stop</button><button data-action="takeover" title="Cancel and return browser control to you">Take over ↗</button></div></section>`;
  statusText = root.querySelector('[role=status]');
  if (message.detail) statusText!.textContent = message.detail;
  root.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', async event => {
    if (!event.isTrusted) return;
    root.querySelectorAll<HTMLButtonElement>('button').forEach(item => item.disabled = true);
    root.querySelector('[role=status]')!.textContent = 'Stopping…';
    try { await chromeApi.runtime.sendMessage({ type: 'STOP', source: button.dataset.action }); hide(); }
    catch { root.querySelector('[role=status]')!.textContent = 'Open Ulka to stop'; root.querySelectorAll<HTMLButtonElement>('button').forEach(item => item.disabled = false); }
  }));
  document.documentElement.append(overlay);
});
