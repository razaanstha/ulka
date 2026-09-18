import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { WebMcpBridge } from '../apps/extension/src/agent/webmcp';
import type { ChromeDebuggerApi } from '../apps/extension/src/agent/cdp';

function fixture() {
  const window = new Window({ url: 'https://example.com/form' });
  let calls = 0;
  let input: unknown;
  const tool = { name: 'search', description: 'Search flights', inputSchema: { type: 'object', properties: { destination: { type: 'string' } }, required: ['destination'] }, origin: 'https://example.com', window: window.eval('window'), annotations: { readOnlyHint: true } };
  const context = {
    getTools: async () => [tool],
    executeTool: async (selected: unknown, args: unknown, _options?: { signal: AbortSignal }) => {
      expect(selected).toBe(tool); calls++; input = args; return JSON.stringify({ found: 'Vienna' });
    },
  };
  Object.assign(window.document, { modelContext: context });
  const commands: { method: string; params?: Record<string, unknown> }[] = [];
  const api: ChromeDebuggerApi = {
    attach: async () => {}, detach: async () => {},
    sendCommand: async (_target, method, params) => {
      commands.push({ method, params });
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
      expect(method).toBe('Runtime.evaluate'); expect(params?.contextId).toBe(7);
      return { result: { value: await window.eval(params!.expression as string) } };
    },
  };
  return { window, context, tool, commands, api, bridge: new WebMcpBridge(api, { tabId: 1 }), calls: () => calls, input: () => input };
}
const signal = () => new AbortController().signal;

test('WebMCP discovery exposes schemas; approved calls execute once in isolated world', async () => {
  const f = fixture();
  try {
    const catalog = await f.bridge.discover(signal());
    expect(catalog.available).toBe(true);
    expect(catalog.tools[0].inputSchema).toEqual(f.tool.inputSchema);
    expect(catalog.tools[0]).not.toHaveProperty('window');
    const call = { id: catalog.tools[0].id, arguments: { destination: 'Vienna' } };
    // Discovery and execution may be separate debugger attachments.
    const bridge = new WebMcpBridge(f.api, { tabId: 1 });
    let approvals = 0;
    const result = await bridge.execute(call, signal(), async request => {
      approvals++; expect(request.origin).toBe('https://example.com'); expect(request.text).toContain('Vienna'); return true;
    });
    expect(result).toMatchObject({ status: 'executed', webmcpResult: { output: '{"found":"Vienna"}', untrusted: true } });
    expect(f.input()).toEqual(call.arguments); expect(f.calls()).toBe(1); expect(approvals).toBe(1);
    expect((await bridge.execute(call, signal(), async () => true)).status).toBe('unavailable');
    expect(f.calls()).toBe(1);
    expect(f.commands.find(c => c.method === 'Page.createIsolatedWorld')!.params).toMatchObject({ worldName: 'ulka-webmcp', grantUniveralAccess: false });
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP unavailable and legacy navigator alias are feature-detected', async () => {
  const f = fixture();
  try {
    delete (f.window.document as any).modelContext;
    expect(await f.bridge.discover(signal())).toMatchObject({ available: false, tools: [] });
    Object.assign(f.window.navigator, { modelContext: f.context });
    expect((await f.bridge.discover(signal())).tools).toHaveLength(1);
    f.context.getTools = async () => { throw new Error('unsupported'); };
    expect(await f.bridge.discover(signal())).toMatchObject({ available: false, tools: [] });
    expect(f.calls()).toBe(0);
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP ignores foreign frame tools and oversized metadata', async () => {
  const f = fixture();
  try {
    f.context.getTools = async () => [f.tool, { ...f.tool, window: {} as Window }, { ...f.tool, origin: 'https://other.test' }, { ...f.tool, description: 'x'.repeat(4001) }];
    expect((await f.bridge.discover(signal())).tools).toHaveLength(1);
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP denied approval never executes, even with readOnlyHint', async () => {
  const f = fixture();
  try {
    const { tools } = await f.bridge.discover(signal());
    expect(await f.bridge.execute({ id: tools[0].id, arguments: {} }, signal(), async () => false)).toMatchObject({ status: 'blocked', reason: expect.stringContaining('approval denied') });
    expect(f.calls()).toBe(0);
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP rejects invented, navigated, rediscovered and changed tool handles', async () => {
  for (const change of ['invented', 'navigate', 'rediscover', 'changed']) {
    const f = fixture();
    try {
      const { tools } = await f.bridge.discover(signal());
      const call = { id: tools[0].id, arguments: {} };
      if (change === 'invented') call.id = 'made-up';
      if (change === 'navigate') f.window.location.href = 'https://example.com/another';
      if (change === 'rediscover') await f.bridge.discover(signal());
      if (change === 'changed') f.tool.description = 'Different action';
      let approvals = 0;
      expect((await f.bridge.execute(call, signal(), async () => { approvals++; return true; })).status).toBe('unavailable');
      expect(f.calls()).toBe(0); expect(approvals).toBe(0);
    } finally { await f.window.happyDOM.abort(); f.window.close(); }
  }
});

test('WebMCP revalidates after approval and respects blocked policy', async () => {
  const f = fixture();
  try {
    let catalog = await f.bridge.discover(signal());
    expect((await f.bridge.execute({ id: catalog.tools[0].id, arguments: {} }, signal(), async () => {
      f.tool.description = 'Changed while waiting'; return true;
    })).status).toBe('unavailable');
    f.tool.name = 'transferMoney'; catalog = await f.bridge.discover(signal());
    expect((await f.bridge.execute({ id: catalog.tools[0].id, arguments: {} }, signal(), async () => { throw new Error('Must not ask'); })).reason).toContain('blocked by safety policy');
    expect(f.calls()).toBe(0);
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP failed invocation reports uncertain effects and consumes handle', async () => {
  const f = fixture();
  try {
    f.context.executeTool = async () => { throw new Error('May have submitted'); };
    const { tools } = await f.bridge.discover(signal());
    const call = { id: tools[0].id, arguments: {} };
    expect(await f.bridge.execute(call, signal(), async () => true)).toMatchObject({ status: 'blocked', failure: 'webmcp_uncertain' });
    expect((await f.bridge.execute(call, signal(), async () => true)).status).toBe('unavailable');
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP cancellation aborts a pending native tool without waiting for it', async () => {
  const f = fixture(); const controller = new AbortController();
  try {
    let nativeSignal: AbortSignal | undefined;
    f.context.executeTool = async (_tool, _args, options) => {
      nativeSignal = options!.signal;
      queueMicrotask(() => controller.abort(new Error('User stopped')));
      return new Promise<string>(() => {});
    };
    const { tools } = await f.bridge.discover(signal());
    await expect(f.bridge.execute({ id: tools[0].id, arguments: {} }, controller.signal, async () => true)).rejects.toThrow('User stopped');
    expect(nativeSignal?.aborted).toBe(true);
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP cancellation during approval prevents execution', async () => {
  const f = fixture(); const controller = new AbortController();
  try {
    const { tools } = await f.bridge.discover(signal());
    await expect(f.bridge.execute({ id: tools[0].id, arguments: {} }, controller.signal, async () => {
      controller.abort(new Error('User stopped')); return true;
    })).rejects.toThrow('User stopped');
    expect(f.calls()).toBe(0);
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP cancellation while creating an isolated world releases the caller', async () => {
  const f = fixture(); const controller = new AbortController();
  try {
    f.api.sendCommand = async () => { queueMicrotask(() => controller.abort(new Error('User stopped'))); return new Promise(() => {}); };
    await expect(f.bridge.discover(controller.signal)).rejects.toThrow('User stopped');
    expect(f.calls()).toBe(0);
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});

test('WebMCP cancellation during final tool lookup cannot start a late action', async () => {
  const f = fixture(); const controller = new AbortController();
  try {
    const { tools } = await f.bridge.discover(signal());
    let release!: () => void;
    const pending = f.bridge.execute({ id: tools[0].id, arguments: {} }, controller.signal, async () => {
      f.context.getTools = async () => {
        queueMicrotask(() => controller.abort(new Error('User stopped')));
        await new Promise<void>(resolve => { release = resolve; }); return [f.tool];
      };
      return true;
    });
    await expect(pending).rejects.toThrow('User stopped');
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.calls()).toBe(0);
  } finally { await f.window.happyDOM.abort(); f.window.close(); }
});
