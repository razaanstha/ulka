import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { accessibilityRecords, AccessibilitySource, type AXNode } from '../apps/extension/src/agent/accessibility';
import { observationExpression } from '../apps/extension/src/agent/observer';
import { FreshnessValidator } from '../apps/extension/src/agent/freshness';
import { buildActionSpace } from '../apps/extension/src/agent/action-space';
import type { PageSnapshot } from '../packages/protocol/src';

const tree: AXNode[] = [
  { nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['chat'] },
  { nodeId: 'chat', role: { value: 'dialog' }, name: { value: 'Conversation with Raju' }, childIds: ['heading', 'editor', 'send', 'hidden'] },
  { nodeId: 'heading', role: { value: 'heading' }, name: { value: 'New message' } },
  { nodeId: 'editor', backendDOMNodeId: 42, role: { value: 'generic' }, name: { value: 'Write a message' }, properties: [
    { name: 'editable', value: { value: 'richtext' } }, { name: 'focusable', value: { value: true } }, { name: 'multiline', value: { value: true } },
  ] },
  { nodeId: 'send', backendDOMNodeId: 43, role: { value: 'button' }, name: { value: 'Send' }, properties: [{ name: 'disabled', value: { value: true } }] },
  { nodeId: 'hidden', backendDOMNodeId: 44, ignored: true, role: { value: 'button' }, name: { value: 'Hidden' } },
];

test('AX rich-text hosts and ignored wrappers preserve semantic chat hierarchy', () => {
  const records = accessibilityRecords(tree);
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({ role: 'textbox', label: 'Write a message', properties: { multiline: true }, context: [{ id: 'ax:chat', role: 'dialog', label: 'Conversation with Raju', heading: 'New message' }] });
  expect(records[1].context).toEqual(records[0].context);
});

test('AX observer discovers an editor outside old selector and keeps disabled Send as context', () => {
  const w = new Window({ url: 'https://example.test' });
  w.document.body.innerHTML = '<div id="editor" contenteditable="plaintext-only" aria-label="DOM label"></div><button disabled>Send</button><button>Unlisted DOM button</button>';
  Object.defineProperties(w, { innerWidth: { value: 800 }, innerHeight: { value: 600 }, scrollY: { value: 0 } });
  Object.defineProperty(w.HTMLElement.prototype, 'getBoundingClientRect', { value() { return { x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 }; } });
  const editor = w.document.getElementById('editor')!;
  Object.defineProperty(w.document, 'elementFromPoint', { configurable: true, value: () => editor });
  (w as any).__ulkaAgent = { ids: new WeakMap(), nodes: new Map(), next: 1, axNodes: new Map([[42, editor], [43, w.document.querySelector('button')]]), axRecords: accessibilityRecords(tree), axText: 'New message' };
  const snapshot = w.eval(observationExpression(true)) as PageSnapshot;
  expect(snapshot.elements.map(e => e.label)).toEqual(['Write a message', 'Send']);
  expect(snapshot.elements[0].operations).toContain('TYPE_TEXT');
  expect(snapshot.elements[0].multiline).toBe(true);
  expect(snapshot.elements[1]).toMatchObject({ availability: 'disabled', operations: [] });
  expect(buildActionSpace(snapshot).targets.CLICK).not.toHaveProperty(snapshot.elements[1].id);
  expect(snapshot.guards[snapshot.elements[0].id].accessibility?.backendNodeId).toBe(42);
  Object.defineProperty(w.document, 'elementFromPoint', { value: () => w.document.body });
  const covered = w.eval(observationExpression(true));
  expect(covered.elements[0]).toMatchObject({ label: 'Write a message', availability: 'occluded', operations: [] });
  expect(covered.guards).toEqual({});
});

test('AX mapping caches DOM handles across polls and refreshes semantic records', async () => {
  const methods: string[] = [];
  let known: number[] = [];
  const api = { attach: async () => {}, detach: async () => {}, sendCommand: async (_: unknown, method: string, params: any) => {
    methods.push(method);
    if (method === 'Accessibility.getFullAXTree') return { nodes: tree };
    if (method === 'Runtime.evaluate') return { result: { value: params.expression.includes('axNodes.keys') ? known : true } };
    if (method === 'DOM.resolveNode') return { object: { objectId: String(params.backendNodeId) } };
    if (method === 'Runtime.callFunctionOn') { known.push(params.arguments[0].value); return { result: { value: true } }; }
    return {};
  } };
  const source = new AccessibilitySource(api, { tabId: 1 });
  expect(await source.prepare()).toMatchObject({ source: 'accessibility', unmapped: 0 });
  await source.prepare();
  expect(methods.filter(m => m === 'Accessibility.getFullAXTree')).toHaveLength(2);
  expect(methods.filter(m => m === 'DOM.resolveNode')).toHaveLength(2);
});

test('execution rejects changed accessibility semantics before any DOM action', async () => {
  const validator = new FreshnessValidator({ attach: async () => {}, detach: async () => {}, sendCommand: async () => ({ nodes: [{ backendDOMNodeId: 42, role: { value: 'textbox' }, name: { value: 'Another editor' } }] }) }, { tabId: 1 });
  await expect(validator.validateTarget({ guards: { e1: { accessibility: { backendNodeId: 42, role: 'textbox', name: 'Write a message' } } } } as unknown as PageSnapshot, 'e1')).rejects.toThrow('Accessibility target changed');
});


test('focusable dialog stays context while its interactive header remains actionable', () => {
  const records = accessibilityRecords([
    { nodeId: 'root', backendDOMNodeId: 1, role: {value:'RootWebArea'}, properties:[{name:'focusable',value:{value:true}}] },
    { nodeId: 'chat', backendDOMNodeId: 4, role: {value:'dialog'}, name:{value:'Messaging'}, childIds:['header'], properties:[{name:'focusable',value:{value:true}}] },
    { nodeId: 'alert', backendDOMNodeId: 5, role: {value:'alertdialog'}, properties:[{name:'focusable',value:{value:true}}] },
    { nodeId: 'header', backendDOMNodeId: 2, role: {value:'banner'}, name:{value:'Raju Shrestha'}, properties:[{name:'focusable',value:{value:true}}] },
    { nodeId: 'plain', backendDOMNodeId: 3, role: {value:'generic'} },
  ]);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({backendNodeId:2,role:'banner',properties:{focusable:true},context:[{id:'ax:chat',role:'dialog',label:'Messaging'}]});
});

test('AX source reads child-frame trees and maps same-origin nodes into top cache', async () => {
  const queried: Array<string | undefined> = [];
  const mapped: string[] = [];
  const api = { attach: async () => {}, detach: async () => {}, sendCommand: async (_: unknown, method: string, params: any) => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' }, childFrames: [{ frame: { id: 'chat' } }] } };
    if (method === 'Accessibility.getFullAXTree') {
      queried.push(params?.frameId);
      return { nodes: params?.frameId === 'chat' ? tree : [{ nodeId: 'main', role: { value: 'RootWebArea' } }] };
    }
    if (method === 'Runtime.evaluate') return { result: { value: params.expression.includes('axNodes.keys') ? [] : true } };
    if (method === 'DOM.resolveNode') return { object: { objectId: String(params.backendNodeId) } };
    if (method === 'Runtime.callFunctionOn') { mapped.push(params.functionDeclaration); return { result: { value: true } }; }
    return {};
  } };
  expect(await new AccessibilitySource(api, { tabId: 1 }).prepare()).toMatchObject({ source: 'accessibility', unmapped: 0 });
  expect(queried).toEqual([undefined, 'chat']);
  expect(mapped).toHaveLength(2);
  expect(mapped.every(fn => fn.includes('window.top.__ulkaAgent.axNodes'))).toBe(true);
});
