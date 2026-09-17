import type { PageSnapshot, TargetGuard } from "../../../../packages/protocol/src/index";
import { evaluate, type ChromeDebuggerApi, type Debuggee } from "./cdp";
import { VISIBILITY_HELPERS } from "./visibility";

export class StaleDecisionError extends Error { constructor(message = "Decision is stale; no action executed.") { super(message); } }

export interface FreshTarget { x: number; y: number }

export class FreshnessValidator {
  constructor(private readonly api: ChromeDebuggerApi, private readonly target: Debuggee) {}
  async validateSnapshot(snapshot: PageSnapshot): Promise<boolean> {
    return evaluate<boolean>(this.api, this.target, `(() => String(performance.timeOrigin) === ${JSON.stringify(snapshot.pageIdentity)} && location.href === ${JSON.stringify(snapshot.url)} && Math.abs(scrollY - ${snapshot.scroll.y}) < 2)()`);
  }
  async validateTarget(snapshot: PageSnapshot, targetId: string): Promise<FreshTarget> {
    const guard = snapshot.guards[targetId];
    if (!guard) throw new StaleDecisionError("Unknown target; no action executed.");
    const result = await evaluate<{ valid: boolean; reason?: string; x?: number; y?: number; currentRole?: string; text?: string }>(this.api, this.target, targetValidationExpression(guard));
    if (!result.valid || result.x === undefined || result.y === undefined) throw new StaleDecisionError(`Target validation failed: ${result.reason ?? "role or label changed"}; expected ${guard.role}/${guard.label}, observed ${result.currentRole ?? 'unavailable'}/${result.text ?? 'unavailable'}`);
    return { x: result.x, y: result.y };
  }
}

export function targetValidationExpression(guard: TargetGuard): string {
  return `(() => {
    const cache = window.__ulkaAgent;
    const element = cache?.nodes.get(${guard.nodeId});
    if (!element || !element.isConnected) return {valid:false, reason:'node detached or missing'};
    ${VISIBILITY_HELPERS}
    if (element.matches(':disabled') || element.closest('[aria-disabled="true"]')) return {valid:false, reason:'disabled'};
    const hiddenReason = visibilityReason(element);
    if (hiddenReason) return {valid:false, reason:hiddenReason};
    const point = interactionPoint(element);
    if (!point) return {valid:false, reason:'no reachable interaction point'};
    const { x, y } = point;
    const label = ${JSON.stringify(guard.label)};
    const role = ${JSON.stringify(guard.role)};
    const currentRole = element.getAttribute('role') || (() => {
      if (element.tagName === 'A') return 'link';
      if (element.tagName === 'SELECT') return 'combobox';
      if (element.tagName === 'TEXTAREA' || element.isContentEditable) return 'textbox';
      if (element.tagName === 'INPUT') {
        if (element.type === 'search') return 'searchbox';
        if (element.type === 'number') return 'spinbutton';
        if (['text','email','url','tel','date','time','month','week'].includes(element.type)) return 'textbox';
        if (['checkbox','radio'].includes(element.type)) return element.type;
      }
      return 'button';
    })();
    const name = (node, seen = new Set()) => {
      if (!node || seen.has(node)) return ''; seen.add(node);
      const refs = (node.getAttribute?.('aria-labelledby') || '').split(/\\s+/).filter(Boolean).map(id => name(document.getElementById(id), seen)).filter(Boolean).join(' ');
      const labels = [...(node.labels || [])].map(label => name(label, seen)).filter(Boolean).join(' ');
      const content = (node) => [...(node.childNodes || [])].map(child => child.nodeType === 3 ? child.textContent : child.nodeType === 1 && !child.matches('input,textarea,select,option,[contenteditable="true"],[aria-hidden="true"],script,style') ? (child.getAttribute('aria-label') || child.getAttribute('alt') || content(child)) : '').join(' ');
      const direct = content(node).trim();
      return refs || node.getAttribute?.('aria-label') || labels || (['button','submit','reset'].includes(node.type) ? node.value : '') || node.getAttribute?.('alt') || direct || node.getAttribute?.('title') || node.getAttribute?.('placeholder') || '';
    };
    const text = name(element).replace(/\\s+/g,' ').trim().slice(0,500) || currentRole;
    return {valid: currentRole === role && text === label, x, y, currentRole, text};
  })()`;
}
