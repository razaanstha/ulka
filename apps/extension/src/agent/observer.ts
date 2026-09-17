import { snapshotFingerprint, type PageSnapshot, type TargetGuard } from "../../../../packages/protocol/src/index";
import { evaluate, type ChromeDebuggerApi, type Debuggee } from "./cdp";
import { progressState } from "./history";
import { VISIBILITY_HELPERS } from "./visibility";

interface RawSnapshot extends Omit<PageSnapshot, "snapshotId" | "fingerprint" | "createdAt"> {}

export const OBSERVER_EXPRESSION = String.raw`(() => {
  if (!document.body) return null;
  const w = window;
  const cache = w.__ulkaAgent ||= { ids: new WeakMap(), nodes: new Map(), next: 1 };
  const identity = (element) => {
    if (!cache.ids.has(element)) cache.ids.set(element, cache.next++);
    const id = cache.ids.get(element); cache.nodes.set(id, element); return id;
  };
  for (const [id, element] of cache.nodes) if (!element.isConnected) cache.nodes.delete(id);
  const unsafe = (element) => ["password", "file", "hidden"].includes(element.type);
  ${VISIBILITY_HELPERS}
  const name = (element, seen = new Set()) => {
    if (!element || seen.has(element)) return ""; seen.add(element);
    const refs = (element.getAttribute?.("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => name(document.getElementById(id), seen)).filter(Boolean).join(" ");
    const labels = [...(element.labels || [])].map((label) => name(label, seen)).filter(Boolean).join(" ");
    const content = (node) => [...(node.childNodes || [])].map(child => child.nodeType === 3 ? child.textContent : child.nodeType === 1 && !child.matches('input,textarea,select,option,[contenteditable="true"],[aria-hidden="true"],script,style') ? (child.getAttribute('aria-label') || child.getAttribute('alt') || content(child)) : '').join(' ');
    const direct = content(element).trim();
    return refs || element.getAttribute?.("aria-label") || labels ||
      (["button", "submit", "reset"].includes(element.type) ? element.value : "") ||
      element.getAttribute?.("alt") || direct || element.getAttribute?.("title") || element.getAttribute?.("placeholder") || "";
  };
  const role = (element) => {
    const explicit = element.getAttribute("role");
    if (["button", "link", "checkbox", "radio", "tab", "menuitem", "option", "combobox", "textbox", "searchbox", "spinbutton"].includes(explicit)) return explicit;
    if (element.tagName === "BUTTON" || element.tagName === "SUMMARY") return "button";
    if (element.tagName === "A") return "link";
    if (element.tagName === "SELECT") return "combobox";
    if (element.tagName === "TEXTAREA" || element.isContentEditable) return "textbox";
    if (element.tagName === "INPUT" && element.type === "search") return "searchbox";
    if (element.tagName === "INPUT" && element.type === "number") return "spinbutton";
    if (element.tagName === "INPUT" && ["text", "email", "url", "tel", "date", "time", "month", "week"].includes(element.type)) return "textbox";
    if (element.tagName === "INPUT" && ["button", "submit", "reset", "image", "checkbox", "radio"].includes(element.type)) return element.type === "checkbox" || element.type === "radio" ? element.type : "button";
    return null;
  };
  const selector = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="combobox"],[role="textbox"],[role="searchbox"],[role="spinbutton"]';
  // Only modal dialogs restrict observation. Nonmodal popovers must not hide the page.
  const dialog = [...document.querySelectorAll('[aria-modal="true"],dialog[open]')].filter(element => {
    if (!visible(element)) return false;
    return interactionPoint(element) !== null;
  }).at(-1);
  const root = dialog || document.body;
  const scroller = [root, ...root.querySelectorAll('*')].filter(element => visible(element) && element.scrollHeight > element.clientHeight + 2 && ['auto','scroll'].includes(getComputedStyle(element).overflowY)).sort((a,b) => b.clientWidth*b.clientHeight - a.clientWidth*a.clientHeight)[0];
  const scrollTarget = scroller ? { nodeId: identity(scroller), y: scroller.scrollTop, height: scroller.scrollHeight, viewportHeight: scroller.clientHeight } : undefined;
  const elements = [], guards = {};
  const diagnostics = { modalScoped: !!dialog, candidates: 0, rejected: {}, iframeCount: document.querySelectorAll('iframe').length };
  const reject = (reason) => { diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1; };
  for (const element of root.querySelectorAll(selector)) {
    diagnostics.candidates++;
    const reason = unsafe(element) ? 'unsafe-input' : visibilityReason(element) || (element.matches(':disabled') || element.closest('[aria-disabled="true"]') ? 'disabled' : null);
    if (reason) { reject(reason); continue; }
    const rect = element.getBoundingClientRect(), nodeId = identity(element), id = "e" + (elements.length + 1), elementRole = role(element);
    if (!interactionPoint(element)) { reject('occluded'); continue; }
    if (!elementRole) { reject('unsupported-role'); continue; }
    const label = name(element).replace(/\s+/g, " ").trim().slice(0, 500) || elementRole;
    const editable = !element.readOnly && element.getAttribute("aria-readonly") !== "true" && (["textbox", "searchbox", "spinbutton"].includes(elementRole) || (elementRole === "combobox" && element.tagName === "INPUT"));
    const downloadable = element.tagName === "A" && (element.hasAttribute("download") || /\.(pdf|zip|csv|json|xlsx?|docx?|pptx?)(?:$|\?)/i.test(element.href));
    const operations = downloadable ? ["DOWNLOAD"] : element.tagName === "SELECT" ? ["SELECT"] : editable ? ["TYPE_TEXT", "CLICK", "PRESS_ENTER", "PRESS_ESCAPE"] : ["CLICK"];
    operations.push('HOVER', 'RIGHT_CLICK');
    if (['combobox','listbox','textbox','searchbox'].includes(elementRole)) operations.push('ARROW_DOWN','ARROW_UP');
    if (!operations.includes('PRESS_ESCAPE')) operations.push('PRESS_ESCAPE');
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight + 2 && ['auto','scroll'].includes(getComputedStyle(parent).overflowY)) {
        if (parent.scrollTop > 0) operations.push('SCROLL_ELEMENT_UP');
        if (parent.scrollTop + parent.clientHeight < parent.scrollHeight - 2) operations.push('SCROLL_ELEMENT_DOWN');
        break;
      }
    }
    const item = { id, nodeId, role: elementRole, label, operations };
    if (element.tagName === "INPUT") item.inputType = element.type;
    if ("value" in element) item.value = String(element.value).slice(0, 500);
    else if (element.isContentEditable) item.value = (element.innerText || element.textContent || '').slice(0, 500);
    if ("checked" in element) item.checked = Boolean(element.checked);
    for (const [attribute, property] of [['aria-expanded', 'expanded'], ['aria-selected', 'selected'], ['aria-checked', 'checked']]) {
      const value = element.getAttribute(attribute);
      if (value === 'true' || value === 'false') item[property] = value === 'true';
    }
    if (element.tagName === "SELECT") item.options = [...element.options].map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled && !option.closest("optgroup[disabled]")).map(({ option, index }) => ({ id: String(index), label: option.label || option.textContent.trim(), value: option.value }));
    elements.push(item);
    guards[id] = { nodeId, role: elementRole, label, value: item.value, enabled: true,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    if (elements.length >= 250) break;
  }
  const text = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let length = 0, node;
  while ((node = walker.nextNode()) && length < 6000) {
    const value = node.textContent.trim(), parent = node.parentElement;
    if (!value || !parent || parent.closest("script,style,noscript,template") || !visible(parent)) continue;
    text.push(value); length += value.length + 1;
  }
  return { pageIdentity: String(performance.timeOrigin), url: location.href, title: document.title,
    text: text.join("\n").slice(0, 6000), scroll: { y: scrollY, height: document.documentElement.scrollHeight, viewportHeight: innerHeight }, ...(scrollTarget ? {scrollTarget} : {}), elements, guards, diagnostics };
})()`;

export class CdpObserver {
  constructor(
    private readonly api: ChromeDebuggerApi,
    private readonly target: Debuggee,
    private readonly pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}
  async waitForChange(before: PageSnapshot, stopped: () => boolean = () => false, timeoutMs = 3000): Promise<PageSnapshot> {
    let latest = before, stable = 0;
    const initialState = progressState(before);
    let latestState = initialState;
    const samples = Math.ceil(Math.max(250, Math.min(10000, timeoutMs)) / 250);
    // Wait for meaningful content/control changes, then two quiet samples.
    // Explicit WAIT gets a longer budget; no model calls inside polling.
    for (let attempt = 0; attempt < samples && !stopped(); attempt++) {
      await this.pause(250);
      if (stopped()) break;
      const next = await this.observe();
      const nextState = progressState(next);
      stable = nextState === latestState ? stable + 1 : 0;
      latestState = nextState;
      latest = next;
      if (latestState !== initialState && stable >= 2) break;
    }
    return latest;
  }
  async observe(): Promise<PageSnapshot> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const raw = await evaluate<RawSnapshot | null>(this.api, this.target, OBSERVER_EXPRESSION);
      if (raw) {
        const fingerprint = snapshotFingerprint(raw);
        return { ...raw, fingerprint, snapshotId: `${raw.pageIdentity}:${fingerprint}:${Date.now()}`, createdAt: Date.now() };
      }
      await this.pause(50);
    }
    throw new Error("Page has no observable document after waiting 1 second");
  }
}

declare global { interface Window { __ulkaAgent?: { ids: WeakMap<Element, number>; nodes: Map<number, Element>; next: number } } }
