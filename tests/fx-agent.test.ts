import { expect, test } from "bun:test";
import { compactToolResult, runFxBrowser, type FxBrowserHost } from "../apps/extension/src/agent/fx-agent";
import type { FxTool } from "libfx/browser";

function fixture(satisfied = true) {
  const calls: string[] = [];
  const host: FxBrowserHost = {
    observe: async () => { calls.push("observe"); return {}; },
    navigate: async () => { calls.push("navigate"); return {}; },
    act: async () => { calls.push("act"); return {}; },
    verify: async () => { calls.push("verify"); return { satisfied, evidence: "test evidence" }; },
    log: () => {}, progress: () => {},
  };
  return { calls, host };
}

test('scroll checkpoint supplies page evidence automatically before another subgoal', async () => {
  const { host } = fixture(); const signal = new AbortController().signal; let actions = 0;
  host.readPage = async () => ({ reading: { text: 'Observed details' } });
  host.act = async () => { actions++; return actions === 1 ? { status: 'blocked', reason: 'Scroll checkpoint: inspect content' } : { status: 'done' }; };
  const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    const act = tools.find(tool => tool.name === 'browser_subgoal')!;
    expect(await act.execute({ goal: 'Find details' }, { signal })).toMatchObject({ status: 'checkpoint', pageRead: { reading: { text: 'Observed details' } } });
    await act.execute({ goal: 'Use observed details' }, { signal });
  }));
  expect(actions).toBe(2); expect(result.status).toBe('done');
});

test("provider reasoning goes to its own channel, never answer text", async () => {
  const { host } = fixture(); const reasoning: string[] = []; const answers: string[] = [];
  host.reasoning = text => { reasoning.push(text); }; host.progress = text => { answers.push(text); };
  const runtime = { supportsJspi: () => true, createFxAgent: async () => ({
    prompt: () => ({ async *[Symbol.asyncIterator]() { yield { type: 'reasoning_delta', delta: 'Checking available evidence' }; yield { type: 'text_delta', delta: 'Answer' }; }, result: Promise.resolve({ stopReason: 'end_turn', usage: {} }), cancel() {} }), close: async () => {},
  }) };
  const result = await runFxBrowser('test', [], host, new AbortController().signal, runtime);
  expect(reasoning).toEqual(['Checking available evidence']); expect(answers).toEqual(['Answer']); expect(result.reply).toBe('Answer');
});

function fakeRuntime(action: (tools: FxTool[]) => Promise<void>) {
  return { supportsJspi: () => true, createFxAgent: async (options: Parameters<typeof import("libfx/browser").createFxAgent>[0]) => ({
    prompt: () => ({
      async *[Symbol.asyncIterator]() { await action(options.tools); yield { type: "text_delta", delta: "Completed" }; },
      result: Promise.resolve({ stopReason: "end_turn", usage: {} }), cancel() {},
    }), close: async () => {},
  }) };
}

test("closed task tab stops recovery and prevents reopening", async () => {
  const { host, calls } = fixture(); const signal = new AbortController().signal;
  host.act = async () => { throw new Error("No tab with given id 123."); };
  const result = await runFxBrowser("test", [], host, signal, fakeRuntime(async tools => {
    await expect(tools[2].execute({ goal: "Continue" }, { signal })).rejects.toThrow("No tab");
    await expect(tools[1].execute({ url: "https://example.test", newTab: true }, { signal })).rejects.toThrow("Task tab was closed");
  }));
  expect(result.status).toBe("blocked");
  expect(calls).toEqual([]);
});

test("three tool errors prevent further provider retry loops", async () => {
  const { host } = fixture(); const signal = new AbortController().signal; let calls = 0;
  host.act = async () => { calls++; throw new Error("model_unavailable"); };
  const result = await runFxBrowser("test", [], host, signal, fakeRuntime(async tools => {
    for (let i = 0; i < 3; i++) await expect(tools[2].execute({ goal: "Continue" }, { signal })).rejects.toThrow("model_unavailable");
    await expect(tools[2].execute({ goal: "Continue" }, { signal })).rejects.toThrow("three tool errors");
  }));
  expect(result.status).toBe("blocked"); expect(calls).toBe(3);
});

test("stop during an active fx turn returns stopped, not an error", async () => {
  const { host } = fixture(); const controller = new AbortController();
  const result = await runFxBrowser("test", [], host, controller.signal, fakeRuntime(async () => { controller.abort(); }));
  expect(result.status).toBe("stopped");
});

test("compact results omit execution metadata and bound observation size", () => {
  const raw = { page: { text: "a".repeat(10000), elements: Array.from({ length: 250 }, () => ({ nodeId: 123, role: "button", label: "x".repeat(500), options: [1, 2, 3] })), guards: { secret: true } } };
  const compact = compactToolResult(raw) as any;
  expect(compact.page.controls).toHaveLength(40);
  expect(compact.page.omittedControls).toBe(210);
  expect(compact.page.textTruncated).toBe(true);
  expect(JSON.stringify(compact)).not.toContain("nodeId");
  expect(JSON.stringify(compact)).not.toContain("guards");
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(raw).length / 2);
});

test("two blocked subgoals prevent further browser actions", async () => {
  const { host } = fixture(); const signal = new AbortController().signal;
  let actions = 0;
  host.act = async () => { actions++; return { status: "blocked", reason: "No progress" }; };
  const result = await runFxBrowser("test", [], host, signal, fakeRuntime(async tools => {
    for (let i = 0; i < 2; i++) await tools[2].execute({ goal: "Try again" }, { signal });
    await expect(tools[2].execute({ goal: "Try again" }, { signal })).rejects.toThrow("two blocked");
  }));
  expect(actions).toBe(2);
  expect(result.status).toBe("blocked");
});

test("fx continues from navigation into Jev work and final verification", async () => {
  const { calls, host } = fixture();
  const signal = new AbortController().signal;
  const result = await runFxBrowser("test", [], host, signal, fakeRuntime(async tools => {
    await tools[1].execute({ url: "https://example.test", newTab: false }, { signal });
    await tools[2].execute({ goal: "Complete form" }, { signal });
  }));
  expect(calls).toEqual(["navigate", "act", "verify"]);
  expect(result.status).toBe("done");
});

test("fx cannot report success when final evidence is missing", async () => {
  const { host } = fixture(false); const signal = new AbortController().signal;
  const result = await runFxBrowser("test", [], host, signal, fakeRuntime(async tools => {
    await tools[2].execute({ goal: "Complete form" }, { signal });
  }));
  expect(result.status).toBe("blocked");
});

test("cancelled fx requests execute no browser tools", async () => {
  const { calls, host } = fixture(); const controller = new AbortController(); controller.abort();
  await expect(runFxBrowser("test", [], host, controller.signal, fakeRuntime(async () => {}))).rejects.toThrow();
  expect(calls).toEqual([]);
});

test("fx retains tool evidence and retries an unverified outcome", async () => {
  const { host } = fixture(); const signal = new AbortController().signal;
  let checks = 0;
  host.verify = async (_goal, evidence) => {
    expect(evidence?.length).toBeGreaterThan(0);
    return { satisfied: ++checks === 2, evidence: "Missing second milestone" };
  };
  const result = await runFxBrowser("test", [], host, signal, fakeRuntime(async tools => {
    await tools[2].execute({ goal: "Complete next milestone" }, { signal });
  }));
  expect(checks).toBe(2);
  expect(result.status).toBe("done");
});

test("fx stops after declined approval without retrying actions", async () => {
  const { host, calls } = fixture(); const signal = new AbortController().signal;
  host.act = async () => { calls.push("act"); return { status: "blocked", reason: "Action requires approval." }; };
  const result = await runFxBrowser("test", [], host, signal, fakeRuntime(async tools => {
    await tools[2].execute({ goal: "Send message" }, { signal });
  }));
  expect(result.status).toBe("blocked");
  expect(calls).toEqual(["act"]);
});

test('productive checkpoints do not exhaust failure budget', async () => {
  const { host } = fixture(); const signal = new AbortController().signal;
  host.readPage = async () => ({ reading: { text: 'New content', nextOffset: 6000 } });
  host.act = async () => ({ status: 'blocked', reason: 'Scroll checkpoint: inspect content' });
  const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    for (let i = 0; i < 5; i++) expect(await tools.find(t => t.name === 'browser_subgoal')!.execute({ goal: 'Read more' }, { signal })).toMatchObject({ status: 'checkpoint' });
  }));
  expect(result.status).toBe('done');
});

test('tool budget is terminal and skips final verification', async () => {
  const { host, calls } = fixture(); const signal = new AbortController().signal;
  const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    await tools[2].execute({ goal: 'Work' }, { signal });
    for (let i = 0; i < 23; i++) await tools[0].execute({}, { signal });
    await expect(tools[0].execute({}, { signal })).rejects.toThrow('tool limit');
  }));
  expect(result.status).toBe('blocked');
  expect(calls).not.toContain('verify');
});

test('interleaved successes cannot erase cumulative recovery budget', async () => {
  const { host } = fixture(); const signal = new AbortController().signal; let count = 0;
  host.act = async () => ({ status: ++count % 2 ? 'blocked' : 'done', reason: 'No progress' });
  const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    for (let i = 0; i < 7; i++) await tools[2].execute({ goal: 'Work' }, { signal });
    await expect(tools[2].execute({ goal: 'Work' }, { signal })).rejects.toThrow('Recovery budget');
  }));
  expect(result.status).toBe('blocked');
  expect(count).toBe(7);
});

test('deadline distinguishes timeout from user stop', async () => {
  const { host } = fixture(); const controller = new AbortController();
  const result = await runFxBrowser('test', [], host, controller.signal, fakeRuntime(async () => {
    controller.abort(new DOMException('Deadline', 'TimeoutError'));
  }));
  expect(result.reply).toContain('Time limit reached');
});

test('navigation hopping yields current evidence before a third destination', async () => {
  const { host, calls } = fixture(); const signal = new AbortController().signal;
  host.readPage = async () => { calls.push('read'); return { reading: { text: 'Current page' } }; };
  await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    const navigate = tools.find(t => t.name === 'navigate_browser')!;
    for (const url of ['https://one.test', 'https://two.test']) await navigate.execute({ url, newTab: false }, { signal });
    expect(await navigate.execute({ url: 'https://three.test', newTab: false }, { signal })).toMatchObject({ status: 'checkpoint', pageRead: { reading: { text: 'Current page' } } });
  }));
  expect(calls).toEqual(['navigate', 'navigate', 'read', 'verify']);
});

test('terminal failure aborts active model stream and returns precise blocker', async () => {
  const { host } = fixture(); const signal = new AbortController().signal;
  host.act = async () => ({ status: 'blocked', reason: 'No progress' });
  const runtime = {
    supportsJspi: () => true,
    createFxAgent: async (options: Parameters<typeof import('libfx/browser').createFxAgent>[0]) => ({
      prompt: (_input: string, config?: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          const act = options.tools.find(t => t.name === 'browser_subgoal')!;
          await act.execute({ goal: 'Work' }, { signal });
          await act.execute({ goal: 'Recover' }, { signal });
          expect(config?.signal.aborted).toBe(true);
          config?.signal.throwIfAborted();
          yield { type: 'text_delta', delta: 'Should never stream' };
        },
        result: Promise.resolve({ stopReason: 'cancelled', usage: {} }), cancel() {},
      }), close: async () => {},
    }),
  };
  const result = await runFxBrowser('test', [], host, signal, runtime);
  expect(result.status).toBe('blocked');
  expect(result.reply).toContain('two blocked');
});
