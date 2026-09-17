import type { AgentOperation, PageSnapshot } from "../../../../packages/protocol/src/index";

export interface ActionSpace {
  operations: Record<string, string>;
  targets: Partial<Record<AgentOperation, Record<string, { element: string; role: string; currentValue?: string }>>>;
}

export function buildActionSpace(snapshot: PageSnapshot): ActionSpace {
  const click: NonNullable<ActionSpace["targets"]["CLICK"]> = {};
  const typeText: NonNullable<ActionSpace["targets"]["TYPE_TEXT"]> = {};
  const select: NonNullable<ActionSpace["targets"]["SELECT"]> = {};
  const pressEnter: NonNullable<ActionSpace["targets"]["PRESS_ENTER"]> = {};
  const pressEscape: NonNullable<ActionSpace["targets"]["PRESS_ESCAPE"]> = {};
  const switchTab: NonNullable<ActionSpace["targets"]["SWITCH_TAB"]> = {};
  const closeTab: NonNullable<ActionSpace["targets"]["CLOSE_TAB"]> = {};
  const download: NonNullable<ActionSpace["targets"]["DOWNLOAD"]> = {};
  for (const element of snapshot.elements) {
    if (element.operations.includes("CLICK")) {
      click[element.id] = {
        element: `[${element.id}] ${element.label}`,
        role: element.role,
        ...(element.value === undefined ? {} : { currentValue: element.value }),
      };
    }
    if (element.operations.includes("TYPE_TEXT")) typeText[element.id] = { element: `[${element.id}] ${element.label}`, role: element.role, ...(element.value === undefined ? {} : { currentValue: element.value }) };
    if (element.operations.includes("SELECT")) for (const option of element.options ?? []) select[`${element.id}:${option.id}`] = { element: `[${element.id}] ${element.label} → ${option.label}`, role: element.role, currentValue: option.value };
    if (element.operations.includes("PRESS_ENTER")) pressEnter[element.id] = { element: `[${element.id}] ${element.label}`, role: element.role };
    if (element.operations.includes("PRESS_ESCAPE")) pressEscape[element.id] = { element: `[${element.id}] ${element.label}`, role: element.role };
    if (element.operations.includes("DOWNLOAD")) download[element.id] = { element: `[${element.id}] ${element.label}`, role: element.role };
  }
  for (const tab of snapshot.tabs ?? []) {
    switchTab[tab.id] = { element: `[${tab.id}] ${tab.title || tab.url}`, role: "browser-tab", currentValue: tab.url };
    closeTab[tab.id] = { element: `[${tab.id}] ${tab.title || tab.url}`, role: "browser-tab", currentValue: tab.url };
  }
  const targets: ActionSpace["targets"] = {};
  if (Object.keys(click).length) targets.CLICK = click;
  if (Object.keys(typeText).length) targets.TYPE_TEXT = typeText;
  if (Object.keys(select).length) targets.SELECT = select;
  if (Object.keys(pressEnter).length) targets.PRESS_ENTER = pressEnter;
  if (Object.keys(pressEscape).length) targets.PRESS_ESCAPE = pressEscape;
  if (Object.keys(switchTab).length) targets.SWITCH_TAB = switchTab;
  if (Object.keys(closeTab).length) targets.CLOSE_TAB = closeTab;
  if (Object.keys(download).length) targets.DOWNLOAD = download;
  const operations: Record<string, string> = {};
  const extra = {
    RIGHT_CLICK: 'Right-click an observed control to open a context menu. Only website-rendered menus can be observed afterward. Never use this to operate native browser menus; use native tab tools instead.',
    HOVER: 'Move pointer over an observed control to reveal its tooltip or menu. Does not click.',
    ARROW_DOWN: 'Focus an observed input or combobox and press ArrowDown to move through suggestions.',
    ARROW_UP: 'Focus an observed input or combobox and press ArrowUp to move through suggestions.',
    SCROLL_ELEMENT_DOWN: 'Scroll down inside the scrollable container holding this observed control.',
    SCROLL_ELEMENT_UP: 'Scroll up inside the scrollable container holding this observed control.',
  } as const;
  for (const operation of Object.keys(extra) as Array<keyof typeof extra>) {
    const compatible = snapshot.elements.filter(element => element.operations.includes(operation));
    if (!compatible.length) continue;
    operations[operation] = extra[operation];
    targets[operation] = Object.fromEntries(compatible.map(element => [element.id, { element: `[${element.id}] ${element.label}`, role: element.role }]));
  }
  if (targets.CLICK) operations.CLICK = "Click an available observed interactive element.";
  if (targets.TYPE_TEXT) operations.TYPE_TEXT = "Enter or replace text in an observed editable field.";
  if (targets.SELECT) operations.SELECT = "Choose an observed native select option.";
  if (targets.PRESS_ENTER) operations.PRESS_ENTER = "Press Enter on an observed editable field to submit or accept a suggestion.";
  if (targets.PRESS_ESCAPE) operations.PRESS_ESCAPE = "Press Escape on an observed editable field to dismiss a popup.";
  const scroll = snapshot.scrollTarget ?? snapshot.scroll;
  if (scroll.y + scroll.viewportHeight < scroll.height - 2) operations.SCROLL_DOWN = "Scroll down in the observed page or dialog.";
  if (scroll.y > 0) operations.SCROLL_UP = "Scroll up in the observed page or dialog.";
  operations.WAIT = "Wait up to 10 seconds for content or controls to change and settle. Use when the page is still loading; do not click the same toggle again.";
  operations.GO_BACK = "Navigate backward in current tab history.";
  operations.GO_FORWARD = "Navigate forward in current tab history.";
  operations.RELOAD = "Reload current page when needed for recovery.";
  operations.OPEN_TAB = "Open one new blank browser tab.";
  if (targets.SWITCH_TAB) operations.SWITCH_TAB = "Switch to an observed browser tab.";
  if (targets.CLOSE_TAB) operations.CLOSE_TAB = "Close an observed browser tab only when user explicitly requested it.";
  if (targets.DOWNLOAD) operations.DOWNLOAD = "Download an observed file only when user explicitly requested it.";
  operations.DONE = "User goal is visibly satisfied.";
  operations.BLOCKED = "No supported action can make progress.";
  return { operations, targets };
}
