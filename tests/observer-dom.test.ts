import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { OBSERVER_EXPRESSION } from "../apps/extension/src/agent/observer";
import { targetValidationExpression } from "../apps/extension/src/agent/freshness";

function page() {
  const window = new Window({ url: "https://example.test/form" });
  Object.defineProperties(window, { innerWidth: { value: 1280 }, innerHeight: { value: 720 }, scrollX: { value: 0 }, scrollY: { value: 0 } });
  Object.defineProperty(window.document.documentElement, "scrollHeight", { value: 1200, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value() { const y = [...window.document.querySelectorAll('*')].findIndex(node => node.outerHTML === this.outerHTML) * 25; return { x: 10, y, left: 10, top: y, right: 210, bottom: y + 20, width: 200, height: 20 }; } });
  Object.defineProperty(window.document, "elementFromPoint", { configurable: true, value: (_x: number, y: number) => [...window.document.querySelectorAll('*')].find(node => { const rect = node.getBoundingClientRect(); return y >= rect.top && y < rect.bottom; }) });
  window.document.body.innerHTML = `
    <label for="name">Name</label><input id="name" type="text">
    <label for="date">Departure</label><input id="date" type="date">
    <label for="country">Country</label><select id="country"><option disabled>Choose</option><option value="np">Nepal</option><option value="se">Sweden</option></select>
    <button id="continue">Continue</button>
    <a id="download" href="/report.csv">Export CSV</a>`;
  return window;
}

describe("observer DOM integration", () => {
  test("uses the visible portion of a partially offscreen button", () => {
    const window = page();
    window.document.body.innerHTML = '<button>Add a note</button>';
    const button = window.document.querySelector('button')!;
    Object.defineProperty(button, 'getBoundingClientRect', { value: () => ({ x: -150, y: 30, left: -150, top: 30, right: 50, bottom: 60, width: 200, height: 30 }) });
    Object.defineProperty(window.document, 'elementFromPoint', { configurable: true, value: (x: number, y: number) => x >= 0 && x < 50 && y >= 30 && y < 60 ? button : null });
    const snapshot = window.eval(OBSERVER_EXPRESSION);
    expect(snapshot.elements).toHaveLength(1);
    expect(window.eval(targetValidationExpression(snapshot.guards.e1))).toMatchObject({ valid: true, x: 25, y: 45 });
  });

  test("finds an uncovered point and rechecks occlusion before execution", () => {
    const window = page();
    window.document.body.innerHTML = '<button>Add a note</button>';
    const button = window.document.querySelector('button')!;
    const rect = button.getBoundingClientRect();
    Object.defineProperty(window.document, 'elementFromPoint', { configurable: true, value: (x: number) => x < rect.left + rect.width * 0.4 ? button : window.document.body });
    const snapshot = window.eval(OBSERVER_EXPRESSION);
    expect(snapshot.elements).toHaveLength(1);
    expect(window.eval(targetValidationExpression(snapshot.guards.e1)).valid).toBe(true);
    Object.defineProperty(window.document, 'elementFromPoint', { configurable: true, value: () => window.document.body });
    expect(window.eval(targetValidationExpression(snapshot.guards.e1)).valid).toBe(false);
    expect(window.eval(OBSERVER_EXPRESSION).diagnostics.rejected.occluded).toBe(1);
  });

  test("rejects transparent ancestors in observation and freshness", () => {
    const window = page();
    window.document.body.innerHTML = '<div><button>Add a note</button></div>';
    const snapshot = window.eval(OBSERVER_EXPRESSION);
    window.document.querySelector('div')!.style.opacity = '0';
    const hidden = window.eval(OBSERVER_EXPRESSION);
    expect(hidden.elements).toHaveLength(0);
    expect(hidden.diagnostics.rejected['css-hidden']).toBe(1);
    expect(window.eval(targetValidationExpression(snapshot.guards.e1)).valid).toBe(false);
  });

  test("keeps aria-hidden and inert ancestors excluded", () => {
    for (const attribute of ['aria-hidden="true"', 'inert']) {
      const window = page();
      window.document.body.innerHTML = '<div><button>Add a note</button></div>';
      const snapshot = window.eval(OBSERVER_EXPRESSION);
      window.document.querySelector('div')!.setAttribute(attribute.startsWith('aria') ? 'aria-hidden' : 'inert', attribute.startsWith('aria') ? 'true' : '');
      expect(window.eval(OBSERVER_EXPRESSION).elements).toHaveLength(0);
      expect(window.eval(targetValidationExpression(snapshot.guards.e1)).valid).toBe(false);
    }
  });

  test("uses link fragments instead of empty space between wrapped lines", () => {
    const window = page();
    window.document.body.innerHTML = '<a href="/note">Add a note</a>';
    const link = window.document.querySelector('a')!;
    const first = { x: 10, y: 30, left: 10, top: 30, right: 80, bottom: 40, width: 70, height: 10 };
    const second = { x: 10, y: 60, left: 10, top: 60, right: 40, bottom: 70, width: 30, height: 10 };
    Object.defineProperty(link, 'getBoundingClientRect', { value: () => ({ ...first, bottom: 70, height: 40 }) });
    Object.defineProperty(link, 'getClientRects', { value: () => [first, second] });
    Object.defineProperty(window.document, 'elementFromPoint', { configurable: true, value: (_x: number, y: number) => y >= 30 && y <= 40 ? link : window.document.body });
    const snapshot = window.eval(OBSERVER_EXPRESSION);
    expect(snapshot.elements).toHaveLength(1);
    expect(window.eval(targetValidationExpression(snapshot.guards.e1))).toMatchObject({ valid: true, x: 45, y: 35 });
  });

  test("modal with covered center still scopes observation to its controls", () => {
    const window = page();
    window.document.body.innerHTML = '<button>Background</button><div aria-modal="true"><button>Add a note</button></div>';
    const dialog = window.document.querySelector('div')!;
    const button = dialog.querySelector('button')!;
    const background = window.document.querySelector('button')!;
    const r = dialog.getBoundingClientRect(), b = button.getBoundingClientRect();
    Object.defineProperty(window.document, 'elementFromPoint', { configurable: true, value: (x: number, y: number) => {
      if (y >= b.top && y < b.bottom) return button;
      if (y >= r.top && y < r.bottom) return x < r.left + r.width * 0.4 ? dialog : window.document.body;
      return background;
    } });
    const snapshot = window.eval(OBSERVER_EXPRESSION);
    expect(snapshot.diagnostics.modalScoped).toBe(true);
    expect(snapshot.elements.map((e: any) => e.label)).toEqual(['Add a note']);
    expect(snapshot.text).not.toContain('Background');
  });

  test("fully offscreen and disabled controls remain excluded with counted reasons", () => {
    const window = page();
    window.document.body.innerHTML = '<button id="offscreen">Offscreen</button><button disabled>Disabled</button>';
    const button = window.document.querySelector('button')!;
    Object.defineProperty(button, 'getBoundingClientRect', { value: () => ({ x: -200, y: 30, left: -200, top: 30, right: -100, bottom: 60, width: 100, height: 30 }) });
    const snapshot = window.eval(OBSERVER_EXPRESSION);
    expect(snapshot.elements).toHaveLength(0);
    expect(snapshot.diagnostics.rejected).toEqual({ offscreen: 1, disabled: 1 });
  });
  test("nested text names agree with validation and dialogs exclude background controls", () => {
    const window = page();
    window.document.body.innerHTML = '<button>Background</button><div role="dialog" aria-modal="true"><button id="save"><span><strong>Save changes</strong></span></button></div>';
    const snapshot = window.eval(OBSERVER_EXPRESSION) as any;
    expect(snapshot.elements.map((item: any) => item.label)).toEqual(["Save changes"]);
    expect(window.eval(targetValidationExpression(snapshot.guards.e1)).valid).toBe(true);
    expect(snapshot.text).not.toContain("Background");
  });
  test("omits occluded controls and reports later occlusion", () => {
    const window = page();
    const snapshot = window.eval(OBSERVER_EXPRESSION) as any;
    const button = snapshot.elements.find((item: any) => item.label === "Continue");
    Object.defineProperty(window.document, "elementFromPoint", { configurable: true, value: () => window.document.body });
    expect(window.eval(OBSERVER_EXPRESSION).elements).toHaveLength(0);
    expect(window.eval(targetValidationExpression(snapshot.guards[button.id])).reason).toBe("no reachable interaction point");
  });
  test("observed input and nested select labels pass freshness until replaced", () => {
    const window = page();
    window.document.body.innerHTML = '<label>Name <input id="name"></label><label>Country <select id="country"><option>Nepal</option><option>Sweden</option></select></label>';
    const snapshot = window.eval(OBSERVER_EXPRESSION) as any;
    for (const id of ["name", "country"]) {
      const node = window.document.getElementById(id)!;
      Object.defineProperty(window.document, "elementFromPoint", { configurable: true, value: () => node });
      const element = snapshot.elements.find((item: any) => item.label === (id === "name" ? "Name" : "Country"));
      const expression = targetValidationExpression(snapshot.guards[element.id]);
      expect(window.eval(expression).valid).toBe(true);
      node.replaceWith(node.cloneNode(true));
      expect(window.eval(expression).valid).toBe(false);
    }
  });
  test("extracts compatible operations and preserves native option indices", () => {
    const window = page();
    const snapshot = window.eval(OBSERVER_EXPRESSION) as any;
    const byLabel = Object.fromEntries(snapshot.elements.map((element: any) => [element.label, element]));
    expect(byLabel.Name.operations).toEqual(["TYPE_TEXT", "CLICK", "PRESS_ENTER", "PRESS_ESCAPE", "HOVER", "RIGHT_CLICK", "ARROW_DOWN", "ARROW_UP"]);
    expect(byLabel.Departure.operations).toContain("TYPE_TEXT");
    expect(byLabel.Country.operations).toEqual(["SELECT", "HOVER", "RIGHT_CLICK", "ARROW_DOWN", "ARROW_UP", "PRESS_ESCAPE"]);
    expect(byLabel.Country.options).toEqual([{ id: "1", label: "Nepal", value: "np" }, { id: "2", label: "Sweden", value: "se" }]);
    expect(byLabel["Export CSV"].operations).toEqual(["DOWNLOAD", "HOVER", "RIGHT_CLICK", "PRESS_ESCAPE"]);
  });

  test("keeps node identity stable and replaces identity after rerender", () => {
    const window = page();
    const first = window.eval(OBSERVER_EXPRESSION) as any;
    const firstButton = first.elements.find((element: any) => element.label === "Continue");
    const second = window.eval(OBSERVER_EXPRESSION) as any;
    expect(second.elements.find((element: any) => element.label === "Continue").nodeId).toBe(firstButton.nodeId);
    const old = window.document.querySelector("#continue")!;
    const replacement = old.cloneNode(true);
    old.replaceWith(replacement);
    const third = window.eval(OBSERVER_EXPRESSION) as any;
    expect(third.elements.find((element: any) => element.label === "Continue").nodeId).not.toBe(firstButton.nodeId);
  });
});

test('observer exposes expanded and selected control state for loop detection', () => {
  const window = page();
  window.document.body.innerHTML = '<button aria-expanded="false" aria-selected="false">Location</button>';
  const button = window.document.querySelector('button')!;
  const before = window.eval(OBSERVER_EXPRESSION);
  expect(before.elements[0]).toMatchObject({ expanded: false, selected: false });
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-selected', 'true');
  const after = window.eval(OBSERVER_EXPRESSION);
  expect(after.elements[0]).toMatchObject({ expanded: true, selected: true, nodeId: before.elements[0].nodeId });
});
