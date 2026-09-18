import type { AgentDecision, PageSnapshot } from "../../../../packages/protocol/src/index";
import type { ChromeDebuggerApi, Debuggee } from "./cdp";
import { FreshnessValidator, StaleDecisionError } from "./freshness";
import { VISIBILITY_HELPERS } from './visibility';
import { evaluate } from "./cdp";

export interface TabController {
  open(): Promise<void>;
  switch(tabId: number): Promise<void>;
  close(tabId: number): Promise<void>;
}

export class BrowserExecutor {
  constructor(
    private readonly api: ChromeDebuggerApi,
    private readonly target: Debuggee,
    private readonly freshness: FreshnessValidator,
    private readonly tabs?: TabController,
  ) {}

  async execute(snapshot: PageSnapshot, decision: AgentDecision, text?: string): Promise<void> {
    // Runner owns cancellable, condition-based waiting and fresh observation.
    if (decision.operation === "WAIT") return;
    if (decision.operation === "OPEN_TAB") { if (!this.tabs) throw new Error("Tab controller unavailable"); await this.tabs.open(); return; }
    if (decision.operation === "SWITCH_TAB" || decision.operation === "CLOSE_TAB") {
      if (!this.tabs || !decision.target) throw new Error("Tab controller unavailable");
      const tabId = snapshot.tabRefs?.[decision.target]; if (!tabId) throw new Error("Unknown tab target");
      await (decision.operation === "SWITCH_TAB" ? this.tabs.switch(tabId) : this.tabs.close(tabId)); return;
    }
    if (!(await this.freshness.validateSnapshot(snapshot))) throw new StaleDecisionError("Page changed before validation");
    if (decision.operation === "RELOAD") { await this.api.sendCommand(this.target, "Page.reload", {}); return; }
    if (decision.operation === "GO_BACK" || decision.operation === "GO_FORWARD") {
      const history = await this.api.sendCommand(this.target, "Page.getNavigationHistory", {}) as { currentIndex: number; entries: Array<{ id: number }> };
      const index = history.currentIndex + (decision.operation === "GO_BACK" ? -1 : 1);
      if (!history.entries[index]) throw new Error("No browser history entry available");
      await this.api.sendCommand(this.target, "Page.navigateToHistoryEntry", { entryId: history.entries[index].id }); return;
    }
    if (decision.operation === "SCROLL_UP" || decision.operation === "SCROLL_DOWN") {
      const point = await evaluate<{ x: number; y: number } | null>(this.api, this.target, `(() => {
        const id = ${JSON.stringify(snapshot.scrollTarget?.nodeId ?? null)};
        if (id === null) return {x: innerWidth / 2, y: innerHeight / 2};
        const e = window.__ulkaAgent?.nodes.get(id);
        if (!e?.isConnected || Math.abs(e.scrollTop - ${snapshot.scrollTarget?.y ?? 0}) > 2) return null;
        ${VISIBILITY_HELPERS}
        return visible(e) ? interactionPoint(e) : null;
      })()`);
      if (!point) throw new StaleDecisionError("Scroll container changed or is covered");
      await this.api.sendCommand(this.target, "Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaY: decision.operation === "SCROLL_DOWN" ? 560 : -560, deltaX: 0 }); return;
    }
    if (!decision.target) throw new Error("Unsupported execution request");
    const baseTarget = decision.target.split(":")[0];
    const point = await this.freshness.validateTarget(snapshot, baseTarget);
    const guard = snapshot.guards[baseTarget];
    if (decision.operation === 'RIGHT_CLICK') {
      await this.api.sendCommand(this.target, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'right', buttons: 2, clickCount: 1 });
      await this.api.sendCommand(this.target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'right', buttons: 0, clickCount: 1 });
      return;
    }
    if (decision.operation === 'HOVER') {
      await this.api.sendCommand(this.target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }); return;
    }
    if (decision.operation === 'SCROLL_ELEMENT_DOWN' || decision.operation === 'SCROLL_ELEMENT_UP') {
      await this.api.sendCommand(this.target, 'Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: decision.operation === 'SCROLL_ELEMENT_DOWN' ? 420 : -420 }); return;
    }
    if (['ARROW_DOWN','ARROW_UP','PRESS_ESCAPE','PRESS_ENTER'].includes(decision.operation)) {
      // Focus without clicking: clicking again can collapse a combobox or reset its active suggestion.
      const focused = await evaluate<boolean>(this.api, this.target, `(() => { const e=window.__ulkaAgent?.nodes.get(${guard.nodeId}); if (!e?.isConnected) return false; if (e.ownerDocument.activeElement!==e) e.focus({preventScroll:true}); return e.ownerDocument.activeElement===e; })()`);
      if (!focused) throw new StaleDecisionError('Control could not receive keyboard focus');
      const key = decision.operation === 'ARROW_DOWN' ? 'ArrowDown' : decision.operation === 'ARROW_UP' ? 'ArrowUp' : decision.operation === 'PRESS_ENTER' ? 'Enter' : 'Escape';
      await this.api.sendCommand(this.target, 'Input.dispatchKeyEvent', { type: 'keyDown', key, code: key });
      await this.api.sendCommand(this.target, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: key }); return;
    }
    if (decision.operation === "SELECT") {
      const option = Number(decision.option);
      const changed = await evaluate<boolean>(this.api, this.target, `(() => { const e=window.__ulkaAgent?.nodes.get(${guard.nodeId}); if (!(e?.tagName === 'SELECT') || !e.options[${option}] || e.options[${option}].disabled) return false; e.selectedIndex=${option}; e.dispatchEvent(new e.ownerDocument.defaultView.Event('input',{bubbles:true})); e.dispatchEvent(new e.ownerDocument.defaultView.Event('change',{bubbles:true})); return true; })()`);
      if (!changed) throw new StaleDecisionError("Select option unavailable: " + decision.option); return;
    }
    // Popup editors can already own focus. Clicking them again can close the
    // popup or reset its selection. Validate focus live, not from the snapshot.
    const alreadyFocused = decision.operation === 'TYPE_TEXT' && await evaluate<boolean>(this.api, this.target,
      `(() => { const e=window.__ulkaAgent?.nodes.get(${guard.nodeId}); return !!e?.isConnected && e.getRootNode().activeElement === e; })()`);
    if (!alreadyFocused) {
      await this.api.sendCommand(this.target, "Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await this.api.sendCommand(this.target, "Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    }
    if (decision.operation === "TYPE_TEXT") {
      if (!text) throw new Error("TYPE_TEXT requires generated text");
      // Clicking a date/search field can open a popup and focus a replacement.
      // Never deliver generated text to whichever control happens to be active.
      const stillFocused = await evaluate<boolean>(this.api, this.target, `(() => {
        const e = window.__ulkaAgent?.nodes.get(${guard.nodeId});
        if (!e?.isConnected) return false;
        return e.getRootNode().activeElement === e;
      })()`);
      if (!stillFocused) throw new StaleDecisionError('Typing target lost focus or changed after click; observe the new field before typing');
      const element = snapshot.elements.find((item) => item.id === baseTarget);
      if (["date", "time", "month", "week"].includes(element?.inputType ?? "")) {
        const changed = await evaluate<boolean>(this.api, this.target, `(() => { const e=window.__ulkaAgent?.nodes.get(${guard.nodeId}); if (!(e?.tagName === 'INPUT') || !['date','time','month','week'].includes(e.type)) return false; e.value=${JSON.stringify(text)}; e.dispatchEvent(new e.ownerDocument.defaultView.Event('input',{bubbles:true})); e.dispatchEvent(new e.ownerDocument.defaultView.Event('change',{bubbles:true})); return e.value===${JSON.stringify(text)}; })()`);
        if (!changed) throw new Error("Generated value is invalid for native date/time field"); return;
      }
      const selected = await evaluate<boolean>(this.api, this.target, `(() => {
        const e=window.__ulkaAgent?.nodes.get(${guard.nodeId});
        if (!e?.isConnected || e.getRootNode().activeElement !== e) return false;
        if (typeof e.select==='function') {
          e.select();
          if (typeof e.selectionStart === 'number' && (e.selectionStart !== 0 || e.selectionEnd !== e.value.length)) return false;
        } else {
          const r=e.ownerDocument.createRange(); r.selectNodeContents(e);
          const s=e.getRootNode().getSelection?.() || e.ownerDocument.getSelection();
          if (!s) return false;
          s.removeAllRanges(); s.addRange(r);
          if (s.toString() !== r.toString()) return false;
        }
        return e.isConnected && e.getRootNode().activeElement === e;
      })()`);
      if (!selected) throw new StaleDecisionError('Typing target changed or full value could not be selected; no text inserted');
      await this.api.sendCommand(this.target, "Input.insertText", { text });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
