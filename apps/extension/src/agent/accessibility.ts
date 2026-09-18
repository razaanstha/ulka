import { evaluate, type ChromeDebuggerApi, type Debuggee } from './cdp';

export interface AXNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string | number };
  properties?: Array<{ name: string; value: { value?: unknown; relatedNodes?: Array<{ backendDOMNodeId: number }> } }>;
}
const roles: Record<string, string> = {
  button: 'button', link: 'link', checkbox: 'checkbox', switch: 'checkbox', radio: 'radio', tab: 'tab',
  menuitem: 'menuitem', menuitemcheckbox: 'checkbox', menuitemradio: 'radio', option: 'option',
  combobox: 'combobox', textbox: 'textbox', searchbox: 'searchbox', spinbutton: 'spinbutton',
};
const scopes = new Set(['dialog', 'alertdialog', 'form', 'region', 'group', 'listbox', 'grid', 'table']);
export function accessibilityRecords(nodes: AXNode[]) {
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const parents = new Map<string, string>();
  for (const node of nodes) for (const child of node.childIds ?? []) parents.set(child, node.nodeId);
  const ancestors = (node: AXNode) => {
    const result: AXNode[] = [], seen = new Set([node.nodeId]);
    let parent = node.parentId ?? parents.get(node.nodeId);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const current = byId.get(parent);
      if (!current) break;
      if (!current.ignored && scopes.has(current.role?.value ?? '')) result.push(current);
      parent = current.parentId ?? parents.get(current.nodeId);
    }
    return result;
  };
  const headings = new Map<string, string>();
  for (const node of nodes) if (!node.ignored && node.role?.value === 'heading' && node.name?.value) {
    const scope = ancestors(node)[0];
    if (scope && !headings.has(scope.nodeId)) headings.set(scope.nodeId, node.name.value.slice(0, 160));
  }
  const roleFor = (node: AXNode) => {
    const role = node.role?.value ?? '';
    // Dialog focus supports keyboard containment, not a click action. Keep it
    // as ancestor context for its controls without making its backdrop a target.
    if (['dialog', 'alertdialog'].includes(role)) return undefined;
    if (roles[role]) return roles[role];
    const focusable = node.properties?.some(p => p.name === 'focusable' && p.value.value === true);
    if (!focusable || ['RootWebArea','WebArea','StaticText','InlineTextBox'].includes(role)) return undefined;
    if (node.properties?.some(p => p.name === 'editable' && ['richtext','plaintext'].includes(String(p.value.value)))) return 'textbox';
    // Focusable headers/containers can open panels even without a button role.
    // Preserve the browser's role; do not label arbitrary containers as buttons.
    return role || 'generic';
  };
  return nodes.filter(node => !node.ignored && node.backendDOMNodeId && roleFor(node)).map(node => {
    const properties = Object.fromEntries((node.properties ?? []).map(property => [property.name, property.value.value]));
    const context = ancestors(node).filter(scope => scope.role?.value !== 'group' || scope.name?.value || headings.has(scope.nodeId))
      .slice(0, 4).reverse().map(scope => ({ id: `ax:${scope.nodeId}`, role: scope.role!.value!,
        ...(scope.name?.value ? { label: scope.name.value.slice(0, 160) } : {}),
        ...(headings.has(scope.nodeId) ? { heading: headings.get(scope.nodeId) } : {}),
      }));
    return { backendNodeId: node.backendDOMNodeId!, role: roleFor(node)!, axRole: node.role!.value!,
      label: (node.name?.value ?? '').slice(0, 500), value: node.value?.value, context, properties };
  });
}

// AX is the semantic source. Resolve new backend nodes once, then reuse DOM handles
// during settling polls. DOM observation is a reported fallback when AX is unavailable.
export class AccessibilitySource {
  constructor(private readonly api: ChromeDebuggerApi, private readonly target: Debuggee) {}
  async prepare(): Promise<{ source: 'accessibility' | 'dom-fallback'; axNodes?: number; unmapped?: number }> {
    let nodes: AXNode[];
    try {
      const tree = await this.api.sendCommand(this.target, 'Accessibility.getFullAXTree') as { nodes?: AXNode[] };
      if (!Array.isArray(tree.nodes) || !tree.nodes.length) return { source: 'dom-fallback' };
      nodes = tree.nodes;
    } catch { return { source: 'dom-fallback' }; }
    // getFullAXTree defaults to the main frame. Embedded applications have
    // separate trees even when their documents share the top page's origin.
    try {
      type FrameTree = { frame: { id: string }; childFrames?: FrameTree[] };
      const frames = await this.api.sendCommand(this.target, 'Page.getFrameTree') as { frameTree?: FrameTree };
      const collect = (frame: FrameTree): string[] => (frame.childFrames ?? []).flatMap(child => [child.frame.id, ...collect(child)]);
      for (const frameId of frames.frameTree ? collect(frames.frameTree) : []) {
        try {
          const child = await this.api.sendCommand(this.target, 'Accessibility.getFullAXTree', { frameId }) as { nodes?: AXNode[] };
          if (child.nodes) nodes.push(...child.nodes);
        } catch { /* Detached or out-of-process frames cannot be resolved here. */ }
      }
      nodes = [...new Map(nodes.map(node => [node.nodeId, node])).values()];
    } catch { /* Older CDP targets can still expose the main document. */ }
    const records = accessibilityRecords(nodes);
    const known = await evaluate<number[]>(this.api, this.target, `(() => {
      const c = window.__ulkaAgent ||= {ids:new WeakMap(),nodes:new Map(),next:1};
      c.axNodes ||= new Map();
      for (const [id,e] of c.axNodes) if (!e.isConnected) c.axNodes.delete(id);
      return [...c.axNodes.keys()];
    })()`);
    const knownIds = new Set(known);
    const missing = records.filter(record => !knownIds.has(record.backendNodeId));
    const group = 'ulka-accessibility';
    let cursor = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(8, missing.length) }, async () => {
        while (cursor < missing.length) {
          const record = missing[cursor++];
          try {
            const resolved = await this.api.sendCommand(this.target, 'DOM.resolveNode', { backendNodeId: record.backendNodeId, objectGroup: group }) as { object?: { objectId?: string } };
            if (!resolved.object?.objectId) continue;
            const result = await this.api.sendCommand(this.target, 'Runtime.callFunctionOn', {
              objectId: resolved.object.objectId,
              functionDeclaration: 'function(id) { try { if (this.ownerDocument !== document || !this.isConnected || this.nodeType !== 1) return false; window.top.__ulkaAgent.axNodes.set(id,this); return true; } catch { return false; } }',
              arguments: [{ value: record.backendNodeId }], returnByValue: true,
            }) as { result?: { value?: boolean } };
            if (result.result?.value) knownIds.add(record.backendNodeId);
          } catch { /* A node can detach between AX capture and DOM resolution. */ }
        }
      }));
    } finally {
      await this.api.sendCommand(this.target, 'Runtime.releaseObjectGroup', { objectGroup: group }).catch(() => {});
    }
    const text = nodes.filter(node => !node.ignored && ['StaticText', 'heading', 'dialog', 'alertdialog'].includes(node.role?.value ?? ''))
      .map(node => node.name?.value ?? '').filter(Boolean).join('\n').slice(0, 6000);
    await evaluate(this.api, this.target, `(() => {
      const c=window.__ulkaAgent;
      c.axRecords=${JSON.stringify(records)};
      c.axText=${JSON.stringify(text)};
      return true;
    })()`);
    return { source: 'accessibility', axNodes: nodes.length, unmapped: records.filter(record => !knownIds.has(record.backendNodeId)).length };
  }
}
