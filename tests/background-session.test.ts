import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

// Exercise the actual service-worker host wiring, not just TaskBrowserSession.
// Model output and page observation are deterministic; debugger attachment rules
// match Chrome, which rejects a second owner of an already-attached tab.
for (const operation of ['extractPage', 'actAction', 'actActionUnlisted'] as const) {
  test(`FX ${operation} reuses its existing debugger attachment`, async () => {
    const page = { pageIdentity: '1', snapshotId: 's1', fingerprint: 'fresh', createdAt: 0,
      url: 'https://example.test/', title: 'Fixture', text: 'Observed', elements: [], guards: {},
      scroll: { y: 0, height: 100, viewportHeight: 100 } };
    const events: string[] = [];
    let attached = false;
    let listener: any;
    let result: any;
    const chrome = {
      sidePanel: { setPanelBehavior: async () => {} },
      downloads: { onChanged: { addListener() {} } },
      storage: { local: { get: async () => ({ vercelAiGatewayApiKey: 'test-key', ulkaEngine: 'classic' }), set: async () => {} } },
      tabs: { query: async () => [{ id: 1, url: page.url, active: true }], sendMessage: async () => {} },
      runtime: { onMessage: { addListener: (fn: any) => { listener = fn; } }, sendMessage: async () => {} },
      debugger: {
        attach: async () => {
          if (attached) throw new Error('Another debugger is already attached');
          attached = true; events.push('attach');
        },
        detach: async () => { attached = false; events.push('detach'); },
        sendCommand: async () => ({ result: { value: { reading: { text: 'Observed' } } } }),
      },
    };
    const stubs: Record<string, string> = {
      './agent/fx-agent': `export const runFxBrowser = async (_key, _messages, host, signal) => {
        await host.readPage('', 0);
        globalThis.harness.result = await host[globalThis.harness.operation === 'actActionUnlisted' ? 'actAction' : globalThis.harness.operation](
          globalThis.harness.operation === 'extractPage'
            ? {instruction:'Read title', fields:[{name:'title',type:'string',description:'Title'}]}
            : {goal:'Replay action',action:{id:'observed:CLICK:e1',operation:'CLICK',target:'e1',description:'Click',snapshotFingerprint:globalThis.harness.operation === 'actActionUnlisted' ? 'fresh' : 'stale'}}, signal);
        return {status:'done',reply:'Verified'};
      };`,
      './agent/page-extractor': `export class PageExtractor { async extract(_input, page) { return {title:page.title}; } }`,
      './agent/model-pricing': `export const loadModelPrices = async () => ({});`,
      './diagnostics': `export const beginLog = () => {}; export const log = async () => {};`,
      './observer': `export class CdpObserver { async observe() { return globalThis.harness.page; } }`,
    };
    const build = await Bun.build({ entrypoints: ['apps/extension/src/background.ts'], target: 'browser', format: 'iife',
      plugins: [{ name: 'host-fixture', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path]!, loader: 'js' }));
      } }],
    });
    expect(build.success).toBe(true);
    const harness = { page, operation, result: undefined as any };
    runInNewContext(await build.outputs[0]!.text(), { chrome, harness, console, crypto, AbortController, AbortSignal,
      setTimeout, clearTimeout, setInterval, clearInterval, performance, TextEncoder, TextDecoder, URL, structuredClone,
      TransformStream, ReadableStream, WritableStream, Headers, Request, Response, Error });
    let legacyStarted = false;
    listener({ type: 'START', goal: 'Legacy direct run' }, {}, () => { legacyStarted = true; });
    await Bun.sleep(0);
    expect(legacyStarted).toBe(false);
    expect(events).toEqual([]);
    await new Promise<void>(resolve => listener({ type: 'CHAT', messages: [{role:'user',content:'Inspect fixture'}] }, {}, (value: unknown) => { result = value; resolve(); }));
    await Bun.sleep(0); // Let the worker's cleanup promise finish.
    expect(result).toMatchObject({ ok: true });
    expect(events).toEqual(['attach', 'detach']);
    expect(harness.result).toMatchObject(operation === 'extractPage'
      ? { status: 'extracted', result: { title: 'Fixture' } }
      : operation === 'actAction'
        ? { status: 'blocked', reason: 'Observed action is stale. Requested action was not executed. Use the returned observation; use browser_subgoal if controls keep changing.' }
        : { status: 'blocked', reason: 'Action was not in the latest observed catalog. Requested action was not executed. Use a returned action reference or browser_subgoal.' });
    if (operation !== 'extractPage') {
      expect(harness.result.observation.page.fingerprint).toBe('fresh');
      expect(harness.result.observation.actions.length).toBeGreaterThan(0);
      expect(harness.result.observation.actions.every((action: any) => action.snapshotFingerprint === 'fresh')).toBe(true);
    }
  });
}
