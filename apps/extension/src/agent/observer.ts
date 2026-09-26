import { AccessibilitySource } from './accessibility';
import { ROLE_HELPERS } from "./role";
import { snapshotFingerprint, type PageSnapshot, type TargetGuard } from "../../../../packages/protocol/src/index";
import { evaluate, type ChromeDebuggerApi, type Debuggee } from "./cdp";
import { progressState } from "./history";
import { VISIBILITY_HELPERS } from "./visibility";

interface RawSnapshot extends Omit<PageSnapshot, "snapshotId" | "fingerprint" | "createdAt"> {}

export const OBSERVER_EXPRESSION = String.raw`(() => {
  if (!document.body) return null;
  const useAccessibility = false;
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
      .map((id) => name(element.ownerDocument.getElementById(id), seen)).filter(Boolean).join(" ");
    const labels = [...(element.labels || [])].map((label) => name(label, seen)).filter(Boolean).join(" ");
    const content = (node) => [...(node.childNodes || [])].map(child => child.nodeType === 3 ? child.textContent : child.nodeType === 1 && !child.matches('input,textarea,select,option,[contenteditable="true"],[aria-hidden="true"],script,style') ? (child.getAttribute('aria-label') || child.getAttribute('alt') || content(child)) : '').join(' ');
    const direct = content(element).trim();
    return refs || element.getAttribute?.("aria-label") || labels ||
      (["button", "submit", "reset"].includes(element.type) ? element.value : "") ||
      element.getAttribute?.("alt") || direct || element.getAttribute?.("title") || element.getAttribute?.("placeholder") || "";
  };
  ${ROLE_HELPERS}
  const selector = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="gridcell"],[role="combobox"],[role="textbox"],[role="searchbox"],[role="spinbutton"]';
  // Only modal dialogs restrict observation. Nonmodal popovers must not hide the page.
  const dialog = [...document.querySelectorAll('[aria-modal="true"],dialog[open]')].filter(element => {
    if (!visible(element)) return false;
    return interactionPoint(element) !== null;
  }).at(-1);
  const root = dialog || document.body;
  const scroller = [root, ...root.querySelectorAll('*')].filter(element => visible(element) && element.scrollHeight > element.clientHeight + 2 && ['auto','scroll'].includes(getComputedStyle(element).overflowY)).sort((a,b) => b.clientWidth*b.clientHeight - a.clientWidth*a.clientHeight)[0];
  const scrollTarget = scroller ? { nodeId: identity(scroller), y: scroller.scrollTop, height: scroller.scrollHeight, viewportHeight: scroller.clientHeight } : undefined;
  const elements = [], guards = {};
  // Preserve shared semantic ancestry without copying conversation contents into
  // every control. IDs link recipient chips, editors and buttons in the same UI.
  const contextSelector = 'dialog,[role="dialog"],[role="alertdialog"],form,[role="form"],fieldset,[role="region"]';
  const contexts = new Map();
  const contextFor = (element) => {
    if (contexts.has(element)) return contexts.get(element);
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const item = { id: 'g' + identity(element), role };
    const refs = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const label = refs.map(id => name(element.ownerDocument.getElementById(id))).filter(Boolean).join(' ') || element.getAttribute('aria-label');
    if (label) item.label = label.replace(/\s+/g, ' ').trim().slice(0, 160);
    const heading = [...element.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],legend')]
      .find(node => visible(node) && node.parentElement?.closest(contextSelector) === element);
    if (heading) item.heading = name(heading).replace(/\s+/g, ' ').trim().slice(0, 160);
    contexts.set(element, item);
    return item;
  };
  const focused = document.activeElement;
  const requiresAccessibility = [...root.querySelectorAll('[contenteditable]')].some(element => element.getAttribute('contenteditable') !== 'false' && !element.matches(selector) && visible(element)) ||
    (focused && root.contains(focused) && focused.hasAttribute('tabindex') && !focused.matches(selector) && visible(focused));
  const diagnostics = { busy: [...root.querySelectorAll('[aria-busy="true"],progress:not([value]),[role="progressbar"]:not([aria-valuenow])')].some(element => visible(element)) || root.getAttribute('aria-busy') === 'true', omittedOffscreenControls: 0, modalScoped: !!dialog, candidates: 0, rejected: {}, unavailable: {}, iframeCount: document.querySelectorAll('iframe').length, requiresAccessibility };
  const reject = (reason) => { diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1; };
  const axRecords = new Map(useAccessibility ? (cache.axRecords || []).map(record => [cache.axNodes.get(record.backendNodeId), record]).filter(([element]) => element?.isConnected) : []);
  const candidates = new Set(useAccessibility ? axRecords.keys() : root.querySelectorAll(selector));
  // A modal's accessible popup may be portaled beside the dialog in the DOM.
  // Include only explicitly linked, open popups; all usual visibility checks apply.
  if (dialog && !useAccessibility) for (const controller of root.querySelectorAll('[aria-controls],[aria-owns]')) {
    if (controller.getAttribute('aria-expanded') !== 'true' || !visible(controller) || !interactionPoint(controller)) continue;
    const refs = [controller.getAttribute('aria-controls'), controller.getAttribute('aria-owns')].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
    for (const id of refs) {
      const popup = controller.ownerDocument.getElementById(id);
      if (!popup || root.contains(popup) || !visible(popup) || !['listbox','menu','tree','grid','dialog'].includes(popup.getAttribute('role'))) continue;
      if (popup.matches(selector)) candidates.add(popup);
      for (const option of popup.querySelectorAll(selector)) candidates.add(option);
    }
  }
  // Reachable controls get the budget first; blocked AX controls remain context.
  const availability = new Map([...candidates].map(element => [element, unsafe(element) ? 'unsafe-input' : visibilityReason(element) || (element.matches(':disabled') || element.closest('[aria-disabled="true"]') ? 'disabled' : null) || (!interactionPoint(element) ? 'occluded' : null)]));
  const ordered = [...candidates].sort((a,b) => Number(!!availability.get(a)) - Number(!!availability.get(b)));
  let offscreenControls = 0;
  for (const element of ordered) {
    // Prefer concrete child controls inside calendar cells. Observe a bare
    // gridcell only when it is itself the actionable target.
    if (element.getAttribute('role') === 'gridcell' && element.querySelector('button,a,input,[role="button"],[role="link"]')) continue;
    diagnostics.candidates++;
    const ax = axRecords.get(element);
    const reason = availability.get(element) || (ax?.properties.disabled === true ? 'disabled' : null);
    if (reason && (!ax || !['offscreen','occluded','disabled'].includes(reason))) { reject(reason); continue; }
    if (reason) diagnostics.unavailable[reason] = (diagnostics.unavailable[reason] || 0) + 1;
    const rect = element.getBoundingClientRect(), nodeId = identity(element), id = "e" + (elements.length + 1), elementRole = ax?.role || actionableRole(element);

    if (!elementRole) { reject('unsupported-role'); continue; }
    // Never discard a reachable target to meet a context budget. Offscreen
    // controls can be recovered by scrolling; report every omitted row.
    if (reason === 'offscreen' && offscreenControls++ >= 250) { diagnostics.omittedOffscreenControls++; continue; }
    const label = (ax?.label || name(element)).replace(/\s+/g, " ").trim().slice(0, 500) || elementRole;
    const editable = ax?.properties.readonly !== true && !element.readOnly && element.getAttribute("aria-readonly") !== "true" && (["textbox", "searchbox", "spinbutton"].includes(elementRole) || (elementRole === "combobox" && ["INPUT", "TEXTAREA"].includes(element.tagName)));
    const downloadable = element.tagName === "A" && (element.hasAttribute("download") || /\.(pdf|zip|csv|json|xlsx?|docx?|pptx?)(?:$|\?)/i.test(element.href));
    const operations = downloadable ? ["DOWNLOAD"] : element.tagName === "SELECT" ? ["SELECT"] : editable ? ["TYPE_TEXT", "CLICK", "PRESS_ENTER", "PRESS_ESCAPE"] : ["CLICK"];
    operations.push('HOVER', 'RIGHT_CLICK');
    if (['combobox','listbox','textbox','searchbox'].includes(elementRole)) operations.push('ARROW_DOWN','ARROW_UP');
    if (ax?.properties.focusable === true && !operations.includes('PRESS_ENTER')) operations.push('PRESS_ENTER');
    if (elementRole === 'combobox' && element.tagName !== 'SELECT' && !operations.includes('PRESS_ENTER')) operations.push('PRESS_ENTER');
    if (!operations.includes('PRESS_ESCAPE')) operations.push('PRESS_ESCAPE');
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight + 2 && ['auto','scroll'].includes(getComputedStyle(parent).overflowY)) {
        if (parent.scrollTop > 0) operations.push('SCROLL_ELEMENT_UP');
        if (parent.scrollTop + parent.clientHeight < parent.scrollHeight - 2) operations.push('SCROLL_ELEMENT_DOWN');
        break;
      }
    }
    if (reason) operations.length = 0;
    const item = { id, nodeId, role: elementRole, label, operations };
    if (element.tagName === 'A' && element.href) item.href = element.href;
    if (reason) item.availability = reason;
    if (editable) item.multiline = element.tagName === 'TEXTAREA' || element.getAttribute('aria-multiline') === 'true';
    const context = [];
    for (let group = element.parentElement?.closest(contextSelector); group && context.length < 3; group = group.parentElement?.closest(contextSelector)) {
      context.unshift(contextFor(group));
    }
    if (ax?.context.length) item.context = ax.context;
    else if (context.length) item.context = context;
    if (ax?.properties.multiline !== undefined) item.multiline = !!ax.properties.multiline;
    if (element.ownerDocument.activeElement === element) item.focused = true;
    // Calendar selection commonly belongs to a gridcell, not its child button.
    // Keep parent semantics separate from the actionable control's own state.
    const cell = element.parentElement?.closest('[role="gridcell"],[role="cell"],td,th');
    if (cell && root.contains(cell)) {
      item.container = { role: cell.getAttribute('role') || 'cell' };
      const selected = cell.getAttribute('aria-selected');
      if (selected === 'true' || selected === 'false') item.container.selected = selected === 'true';
      const group = cell.closest('[role="grid"],[role="table"],table');
      if (group) {
        item.container.groupRole = group.getAttribute('role') || 'table';
        // Never copy all calendar dates into every button's context.
        const refs = (group.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const groupLabel = refs.map(id => name(element.ownerDocument.getElementById(id))).filter(Boolean).join(' ') || group.getAttribute('aria-label');
        if (groupLabel) item.container.groupLabel = groupLabel.replace(/\s+/g, ' ').trim().slice(0, 160);
      }
    }
    if (element.tagName === "INPUT") item.inputType = element.type;
    // TextGenerator can write 2,000 characters. A 500-character preview made
    // complete drafts look unfinished and caused repeated replacement attempts.
    const fieldValue = ax?.value !== undefined ? String(ax.value) : "value" in element ? String(element.value) : element.isContentEditable ? (element.innerText || element.textContent || '') : undefined;
    if (fieldValue !== undefined) {
      item.value = fieldValue.slice(0, 4000);
      if (fieldValue.length > 4000) { item.valueTruncated = true; item.valueLength = fieldValue.length; }
    }
    if ("checked" in element) item.checked = Boolean(element.checked);
    for (const [attribute, property] of [['aria-expanded', 'expanded'], ['aria-selected', 'selected'], ['aria-checked', 'checked'], ['aria-pressed', 'pressed']]) {
      const value = element.getAttribute(attribute);
      if (value === 'true' || value === 'false') item[property] = value === 'true';
    }
    const current = element.getAttribute('aria-current');
    if (current && current !== 'false') item.current = current.slice(0, 40);
    if (element.tagName === "SELECT") item.options = [...element.options].map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled && !option.closest("optgroup[disabled]")).map(({ option, index }) => ({ id: String(index), label: option.label || option.textContent.trim(), value: option.value }));
    if (ax) {
      for (const key of ['focused','expanded','selected','checked','pressed']) {
        const value = ax.properties[key];
        if (value === true || value === 'true') item[key] = true;
        if (value === false || value === 'false') item[key] = false;
      }
    }
    elements.push(item);
    if (!reason) guards[id] = { nodeId, role: actionableRole(element) || 'unknown', label: name(element).replace(/\s+/g,' ').trim().slice(0,500) || actionableRole(element) || 'unknown', value: item.value, ...(item.href ? { href: item.href } : {}), enabled: true,
      ...(ax ? { accessibility: { backendNodeId: ax.backendNodeId, role: ax.axRole, name: ax.label } } : {}),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  }
  // Resolve ARIA relationships to current, visible action IDs only.
  const observedIds = new Map(elements.map(item => [cache.nodes.get(item.nodeId), item.id]));
  for (const item of elements) {
    const element = cache.nodes.get(item.nodeId);
    if (!['combobox','textbox','searchbox'].includes(item.role)) continue;
    const refs = [element.getAttribute('aria-controls'), element.getAttribute('aria-owns')].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
    const popups = refs.map(id => element.ownerDocument.getElementById(id)).filter(Boolean);
    if (popups.length) item.optionIds = elements.filter(option => option.role === 'option' && popups.some(popup => popup.contains(cache.nodes.get(option.nodeId)))).map(option => option.id);
    const active = element.ownerDocument.getElementById(element.getAttribute('aria-activedescendant') || '');
    const activeId = observedIds.get(active);
    if (activeId && item.optionIds?.includes(activeId)) item.activeOptionId = activeId;
  }
  const text = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let length = 0, node;
  while ((node = walker.nextNode()) && length < 6000) {
    const value = node.textContent.trim(), parent = node.parentElement;
    if (!value || !parent || parent.closest("script,style,noscript,template") || !visible(parent)) continue;
    text.push(value); length += value.length + 1;
  }
  return { pageIdentity: String(performance.timeOrigin), url: location.href, title: document.title,
    text: useAccessibility ? cache.axText : text.join("\n").slice(0, 6000), scroll: { y: scrollY, height: document.documentElement.scrollHeight, viewportHeight: innerHeight }, ...(scrollTarget ? {scrollTarget} : {}), elements, guards, diagnostics };
})()`;

export function observationExpression(accessibility: boolean) {
  return OBSERVER_EXPRESSION.replace('const useAccessibility = false;', `const useAccessibility = ${accessibility};`);
}

function domControlsComplete(page: Pick<PageSnapshot, 'diagnostics' | 'elements'>): boolean {
  return !page.diagnostics?.requiresAccessibility && page.elements.every(element =>
    !element.operations.length || (element.label.trim().length > 0 && element.label !== element.role));
}

function domMatchesAccessibility(ax: PageSnapshot, dom: RawSnapshot): boolean {
  if (ax.pageIdentity !== dom.pageIdentity || ax.url !== dom.url || !domControlsComplete(dom)) return false;
  const domControls = new Map(dom.elements.filter(element => element.operations.length).map(element => [element.nodeId, element]));
  // An empty loading page says nothing about controls that appear later.
  if (!domControls.size) return false;
  if (ax.elements.filter(element => element.operations.length).length !== domControls.size) return false;
  for (const element of ax.elements) {
    if (!element.operations.length) continue;
    const match = domControls.get(element.nodeId);
    if (!match || match.role !== element.role || match.label !== element.label) return false;
    const contextMeaning = (value: typeof element.context) => value?.map(({ role, label, heading }) => ({ role, label, heading })) ?? [];
    if (JSON.stringify(contextMeaning(element.context)) !== JSON.stringify(contextMeaning(match.context))) return false;
    const axOnly = element.operations.filter(operation => !match.operations.includes(operation));
    // AX exposes Enter for native buttons/links. Their DOM click remains an
    // equivalent executable route, so this extra shortcut need not force AX.
    if (axOnly.some(operation => operation !== 'PRESS_ENTER' || !['button', 'link'].includes(element.role) || !match.operations.includes('CLICK'))) return false;
  }
  const visibleText = dom.text.replace(/\s+/g, ' ');
  return ax.text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).every(line => visibleText.includes(line));
}

function sameActionableControls(before: PageSnapshot, after: PageSnapshot): boolean {
  const original = new Map(before.elements.filter(element => element.operations.length).map(element => [element.nodeId, element]));
  const current = after.elements.filter(element => element.operations.length);
  return original.size === current.length && current.every(element => {
    const prior = original.get(element.nodeId);
    return prior?.role === element.role && prior.label === element.label;
  });
}

export class CdpObserver {
  private accessibility: AccessibilitySource;
  private settlingBaseline?: { snapshotId: string; page: PageSnapshot; fastDom: boolean };
  constructor(
    private readonly api: ChromeDebuggerApi,
    private readonly target: Debuggee,
    private readonly pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly now: () => number = () => performance.now(),
  ) { this.accessibility = new AccessibilitySource(api, target); }
  async waitForChange(before: PageSnapshot, stopped: () => boolean = () => false, timeoutMs = 3000): Promise<PageSnapshot> {
    let latest = before, stable = 0;
    // A click focuses its trigger immediately, before asynchronous panels mount.
    // Focus alone must not satisfy the content-change settling condition.
    const contentState = (page: PageSnapshot) => progressState({ ...page, elements: page.elements.map(({ focused: _focused, ...element }) => element) });
    // Baseline and polls use the same DOM semantics. AX labels can differ;
    // comparing them directly would manufacture a change before content arrives.
    const baseline = this.settlingBaseline?.snapshotId === before.snapshotId ? this.settlingBaseline.page : before;
    const useDomPolls = baseline !== before;
    const initialState = contentState(baseline);
    let latestState = initialState;
    const budget = Math.max(250, Math.min(10000, timeoutMs));
    const deadline = this.now() + budget;
    const samples = Math.ceil(budget / (useDomPolls ? 50 : 250));
    // Wait for meaningful content/control changes, then two quiet samples.
    // Explicit WAIT gets a longer budget; no model calls inside polling.
    for (let attempt = 0; attempt < samples && !stopped(); attempt++) {
      const remaining = deadline - this.now();
      if (remaining <= 0) break;
      // Fast changed-state checks; back off while nothing useful arrives.
      // Keep the existing deadline and loading checks rather than cut off slow UIs.
      const interval = useDomPolls ? (latestState !== initialState ? 50 : Math.min(250, 50 * 2 ** Math.min(attempt, 3))) : 250;
      await this.pause(Math.min(interval, remaining));
      if (stopped() || this.now() >= deadline) break;
      const raw = useDomPolls ? await evaluate<RawSnapshot | null>(this.api, this.target, observationExpression(false)) : undefined;
      if (useDomPolls && !raw) continue;
      const next = raw ? this.snapshot(raw) : await this.observe();
      const nextState = contentState(next);
      stable = nextState === latestState ? stable + 1 : 0;
      latestState = nextState;
      latest = next;
      // Stable loading indicators are intermediate states, not readiness.
      // Text is a conservative fallback for sites without aria-busy.
      const loading = next.diagnostics?.busy === true || next.text.split('\n').some(line => /^(?:loading|please wait)[\s.…!]*$/i.test(line.trim()));
      if (latestState !== initialState && stable >= 2 && !loading) break;
    }
    // Poll snapshots never become decision input. Refresh AX and guards once,
    // after settling, preserving custom controls and accessible names.
    if (useDomPolls && !stopped()) {
      const fastDom = this.settlingBaseline?.snapshotId === before.snapshotId && this.settlingBaseline.fastDom;
      if (fastDom && latest !== before && latest.pageIdentity === before.pageIdentity && latest.url === before.url &&
          latest.diagnostics?.modalScoped === before.diagnostics?.modalScoped &&
          sameActionableControls(before, latest) && domControlsComplete(latest)) {
        if (latest.diagnostics) latest.diagnostics.source = 'dom-fast';
        this.settlingBaseline = { snapshotId: latest.snapshotId, page: { ...latest }, fastDom: true };
        return latest;
      }
      return this.observe();
    }
    return latest;
  }
  private snapshot(raw: RawSnapshot): PageSnapshot {
    const fingerprint = snapshotFingerprint(raw);
    return { ...raw, fingerprint, snapshotId: `${raw.pageIdentity}:${fingerprint}:${Date.now()}`, createdAt: Date.now() };
  }
  async observe(): Promise<PageSnapshot> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const accessibility = await this.accessibility.prepare();
      const raw = await evaluate<RawSnapshot | null>(this.api, this.target, observationExpression(accessibility.source === 'accessibility'));
      if (raw) {
        if (raw.diagnostics) Object.assign(raw.diagnostics, accessibility);
        const snapshot = this.snapshot(raw);
        this.settlingBaseline = undefined;
        if (accessibility.source === 'accessibility') {
          const dom = await evaluate<RawSnapshot | null>(this.api, this.target, observationExpression(false)).catch(() => null);
          if (dom && dom.pageIdentity === raw.pageIdentity && dom.url === raw.url) {
            this.settlingBaseline = { snapshotId: snapshot.snapshotId, page: this.snapshot(dom), fastDom: domMatchesAccessibility(snapshot, dom) };
          }
        }
        return snapshot;
      }
      await this.pause(50);
    }
    throw new Error("Page has no observable document after waiting 1 second");
  }
}

declare global { interface Window { __ulkaAgent?: { ids: WeakMap<Element, number>; nodes: Map<number, Element>; next: number } } }
