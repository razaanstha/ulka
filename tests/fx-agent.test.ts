import { expect, test } from "bun:test";
import { compactToolResult, runFxBrowser, type FxBrowserHost } from "../apps/extension/src/agent/fx-agent";
import type { FxTool } from "libfx/browser";
import { WEB_BROWSING_SKILL } from "../apps/extension/src/agent/skills/web-browsing";
import { VerificationUnavailableError } from '../apps/extension/src/agent/outcome-verifier';

test('FX exposes WebMCP catalog and verifies successful tool results', async () => {
  const { host } = fixture(); const signal = new AbortController().signal;
  const catalog = { available: true, tools: [{ id: 'observed:0', name: 'search', inputSchema: { type: 'object' } }] };
  host.observe = async () => ({ webmcp: catalog });
  let calls = 0, checks = 0;
  host.webMcp = async input => {
    expect(input).toEqual({ id: 'observed:0', arguments: { query: 'Vienna' } }); calls++;
    return { status: 'executed', webmcpResult: { output: 'Search results', untrusted: true } };
  };
  host.verify = async (_goal, evidence) => {
    checks++;
    expect(JSON.parse(evidence![1].result).webmcpResult.output).toBe('Search results');
    return { satisfied: true, evidence: 'Observed results' };
  };
  const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    expect(await tools.find(t => t.name === 'observe_browser')!.execute({}, { signal })).toMatchObject({ webmcp: catalog });
    await tools.find(t => t.name === 'webmcp_call')!.execute({ id: 'observed:0', arguments: { query: 'Vienna' } }, { signal });
  }));
  expect(result.status).toBe('done'); expect(calls).toBe(1); expect(checks).toBe(1);
});

test('FX falls back only for unavailable WebMCP; denial and uncertainty stop UI execution', async () => {
  for (const mode of ['unavailable', 'denied', 'uncertain']) {
    const { host } = fixture(); const signal = new AbortController().signal;
    let actions = 0;
    host.act = async () => { actions++; return { status: 'done' }; };
    host.webMcp = async () => mode === 'unavailable' ? { status: 'unavailable', reason: 'No tool executed' }
      : mode === 'denied' ? { status: 'blocked', reason: 'WebMCP approval denied' }
      : { status: 'blocked', failure: 'webmcp_uncertain', reason: 'Effects unknown' };
    const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
      await tools.find(t => t.name === 'webmcp_call')!.execute({ id: 'observed:0', arguments: {} }, { signal });
      await tools.find(t => t.name === 'browser_subgoal')!.execute({ goal: 'Use UI' }, { signal });
    }));
    expect(actions).toBe(mode === 'unavailable' ? 1 : 0);
    expect(result.status).toBe(mode === 'unavailable' ? 'done' : 'blocked');
  }
});

test('model reasoning continues without scheduling a watchdog', async () => {
  const { host } = fixture();
  const original = globalThis.setTimeout;
  const timers: number[] = [];
  globalThis.setTimeout = ((fn: any, ms: number, ...args: any[]) => { timers.push(ms); return original(fn, ms, ...args); }) as typeof setTimeout;
  try {
    const result = await runFxBrowser('test', [], host, new AbortController().signal, fakeRuntime(async () => {}));
    expect(result.status).toBe('idle');
    expect(timers).toEqual([]);
  } finally { globalThis.setTimeout = original; }
});

test('cancelled tool time stays in tool timing before tool promise settles', async () => {
  const { host } = fixture(); const controller = new AbortController(); const events: Record<string, any> = {};
  host.log = (event, data) => { events[event] = data; };
  host.act = async () => { await Bun.sleep(30); controller.abort(); await Bun.sleep(10); return {}; };
  const runtime = { supportsJspi: () => true, createFxAgent: async (options: Parameters<typeof import('libfx/browser').createFxAgent>[0]) => ({
    prompt: () => ({
      async *[Symbol.asyncIterator]() {
        void options.tools[2].execute({ goal: 'Work' }, { signal: controller.signal }).catch(() => {});
        await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
      },
      result: Promise.resolve({ stopReason: 'cancelled', usage: { inputTokens: 100, outputTokens: 10 } }), cancel() {},
    }), close: async () => {},
  }) };
  const result = await runFxBrowser('test', [], host, controller.signal, runtime);
  expect(result.status).toBe('stopped');
  expect(events.fx_turn_end.toolsMs).toBeGreaterThanOrEqual(25);
  expect(events.fx_turn_end.elapsedMs).toBeCloseTo(events.fx_turn_end.toolsMs + events.fx_turn_end.outsideToolsMs, 3);
  expect(events.fx_tool_cancelled.elapsedMs).toBeGreaterThanOrEqual(35);
  expect(events.fx_turn_end.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
});

test('verification outage stops FX without replaying subgoals or final recovery', async () => {
  for (const atFinal of [false, true]) {
    const { host } = fixture(); const signal = new AbortController().signal; let actions = 0, checks = 0;
    host.act = async () => { actions++; return atFinal ? { status: 'done' } : { status: 'blocked', failure: 'verification_unavailable', reason: 'Completion check unavailable' }; };
    host.verify = async () => { checks++; throw new VerificationUnavailableError(); };
    const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
      await tools[2].execute({ goal: 'Work' }, { signal });
    }));
    expect(result.status).toBe('blocked'); expect(result.reply).toContain('Completion check unavailable');
    if (atFinal) expect(result.reply).toContain('Completed');
    expect(actions).toBe(1); expect(checks).toBe(atFinal ? 1 : 0);
  }
});

test('final evidence keeps valid JSON and outcomes beyond the old 12KB cut', async () => {
  const { host } = fixture(); const signal = new AbortController().signal;
  host.act = async () => ({ status: 'done', observation: { page: { text: 'Result', elements: [
    ...Array.from({ length: 150 }, (_, i) => ({ id: `e${i}`, label: 'Unrelated control '.repeat(15) })),
    { id: 'last', label: 'Destination', value: 'Oslo', selected: true },
  ] } } });
  host.verify = async (_goal, evidence) => {
    expect(evidence?.[0].result.length).toBeGreaterThan(12000);
    const captured = JSON.parse(evidence![0].result);
    expect(captured.observation.page.controls.at(-1)).toMatchObject({ id: 'last', value: 'Oslo', selected: true });
    return { satisfied: true, evidence: 'Observed destination' };
  };
  expect((await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    await tools[2].execute({ goal: 'Select destination' }, { signal });
  }))).status).toBe('done');
});

test("FX receives the bundled browsing skill without discovery metadata", async () => {
  const { host } = fixture();
  let instructions = "";
  const base = fakeRuntime(async () => {});
  const runtime = { ...base, createFxAgent: async (options: Parameters<typeof import("libfx/browser").createFxAgent>[0]) => {
    instructions = options.instructions;
    return base.createFxAgent(options);
  } };
  await runFxBrowser("test", [{ role: "user", content: "Read this page" }], host, new AbortController().signal, runtime);
  const document = await Bun.file("apps/extension/src/agent/skills/web-browsing/SKILL.md").text();
  const body = document.slice(document.indexOf("\n---", 3) + 4).trim();
  expect(WEB_BROWSING_SKILL).toBe(body);
  expect(instructions).toContain(body);
  expect(instructions).not.toContain("name: web-browsing");
  expect(instructions).toContain("Your capabilities in this run are exactly");
  expect(instructions).toContain("observe_browser");
  expect(instructions).toContain("browser_subgoal");
  expect(instructions).toContain("complete_task");
  expect(instructions).toContain("Never claim completion without observed evidence");
});

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

test('FX exposes native close and retains closure evidence without page actions', async () => {
  const { host, calls } = fixture(); const signal = new AbortController().signal;
  host.nativeTabs = async input => {
    expect(input).toMatchObject({ operation: 'close', tabIds: [2] });
    return { status: 'done', closedTabIds: [2], taskTabId: 1, tabs: [{ id: 1, active: true }] };
  };
  const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    expect(await tools.find(tool => tool.name === 'native_tabs')!.execute({ operation: 'close', tabIds: [2] }, { signal }))
      .toMatchObject({ status: 'done', closedTabIds: [2], taskTabId: 1 });
  }));
  expect(result.status).toBe('done'); expect(calls).toEqual([]);
});

test('verified complete_task ends FX turn immediately', async () => {
  const { host, calls } = fixture();
  const result = await runFxBrowser('test', [], host, new AbortController().signal, fakeRuntime(async tools => {
    await tools.find(tool => tool.name === 'complete_task')!.execute({}, { signal: new AbortController().signal });
  }));
  expect(result.status).toBe('done');
  expect(calls).toEqual(['verify']);
});

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
  expect(compact.page.controls).toHaveLength(250);
  expect(compact.page.omittedControls).toBe(0);
  expect(compact.page.textTruncated).toBe(true);
  expect(JSON.stringify(compact)).not.toContain("nodeId");
  expect(JSON.stringify(compact)).not.toContain("guards");
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(raw).length);
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

for (const reason of [
  'Wait checkpoint: two waits produced no observed change.',
  'Scrolling produced no new readable content.',
]) test(`unproductive checkpoint remains blocked: ${reason}`, async () => {
  const { host, calls } = fixture(); const signal = new AbortController().signal;
  let actions = 0;
  host.readPage = async () => ({ reading: { text: 'Unchanged page' } });
  host.act = async () => { actions++; return { status: 'blocked', reason }; };
  const result = await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    const act = tools.find(t => t.name === 'browser_subgoal')!;
    for (let i = 0; i < 2; i++) {
      expect(await act.execute({ goal: 'Find more results' }, { signal })).toMatchObject({
        status: 'blocked', pageRead: { reading: { text: 'Unchanged page' } },
      });
    }
    await expect(act.execute({ goal: 'Try once more' }, { signal })).rejects.toThrow('two blocked subgoals');
  }));
  expect(actions).toBe(2);
  expect(result.status).toBe('blocked');
  expect(calls).not.toContain('verify');
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
  expect(result.reply).toContain('Stopped');
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


test('FX diagnostics separate tool time from orchestration and final verification', async () => {
  const { host } = fixture();
  const events: Record<string, any> = {};
  host.log = (name, data) => { events[name] = data; };
  const signal = new AbortController().signal;
  await runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    await tools.find(t => t.name === 'browser_subgoal')!.execute({ goal: 'Work' }, { signal });
  }));
  expect(events.fx_init.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(events.fx_turn_end.toolsMs).toBeGreaterThanOrEqual(0);
  expect(events.fx_turn_end.outsideToolsMs).toBeGreaterThanOrEqual(0);
  expect(events.fx_turn_end.elapsedMs).toBeCloseTo(events.fx_turn_end.toolsMs + events.fx_turn_end.outsideToolsMs, 5);
  expect(events.fx_final_verification.elapsedMs).toBeGreaterThanOrEqual(0);
});

test('planner sees selected dates and combobox popup state', () => {
  const result = compactToolResult({ page: { elements: [
    { id: 'e1', role: 'combobox', label: 'Destination', expanded: true, focused: true, optionIds: ['e2'], activeOptionId: 'e2' },
    { id: 'e2', role: 'option', label: 'Paris', selected: true },
    { id: 'e3', role: 'button', label: 'November 15', pressed: true, current: 'date' },
  ] } }) as any;
  expect(result.page.controls[0]).toMatchObject({ id: 'e1', expanded: true, focused: true, optionIds: ['e2'], activeOptionId: 'e2' });
  expect(result.page.controls[1].selected).toBe(true);
  expect(result.page.controls[2]).toMatchObject({ pressed: true, current: 'date' });
});

test('FX receives host time and preserves task time during recovery', async () => {
  const { host } = fixture(); const signal = new AbortController().signal;
  let checks = 0; const prompts: any[] = [];
  host.verify = async goal => {
    expect(JSON.parse(goal).taskTime).toEqual(prompts[0].taskTime);
    return { satisfied: ++checks === 2, evidence: 'Missing date selection' };
  };
  const base = fakeRuntime(async tools => {
    await tools.find(t => t.name === 'browser_subgoal')!.execute({ goal: 'Select requested date' }, { signal });
  });
  const runtime = { ...base, createFxAgent: async (options: Parameters<typeof import('libfx/browser').createFxAgent>[0]) => {
    const agent = await base.createFxAgent(options);
    return { ...agent, prompt: (input: string) => { prompts.push(JSON.parse(input)); return agent.prompt(); } };
  } };
  expect((await runFxBrowser('test', [{ role: 'user', content: 'Tomorrow' }], host, signal, runtime)).status).toBe('done');
  expect(prompts).toHaveLength(2);
  expect(prompts[0].currentTime.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(prompts[0].currentTime.timeZone).toBeTruthy();
  expect(prompts[1].taskTime).toEqual(prompts[0].taskTime);
});

test('ask_user suspends subsequent actions then returns custom answer intact to FX and verification', async () => {
  const { host } = fixture(); const signal = new AbortController().signal;
  let resolve!: (answer: unknown) => void;
  let asked!: () => void;
  const asking = new Promise<void>(done => { asked = done; });
  host.askUser = async () => { asked(); return new Promise(done => { resolve = done; }); };
  let actions = 0;
  host.act = async () => { actions++; return { status: 'done' }; };
  host.verify = async (_goal, evidence) => {
    expect(JSON.parse(evidence![0].result)).toMatchObject({ answer: 'Trondheim', source: 'user_clarification' });
    return { satisfied: true, evidence: 'Observed result' };
  };
  const pending = runFxBrowser('test', [], host, signal, fakeRuntime(async tools => {
    const answer = await tools.find(tool => tool.name === 'ask_user')!.execute({ question: 'Which airport?', options: ['Oslo', 'Bergen'] }, { signal });
    expect(answer).toMatchObject({ answer: 'Trondheim' });
    await tools.find(tool => tool.name === 'browser_subgoal')!.execute({ goal: 'Use Trondheim' }, { signal });
  }));
  await asking;
  expect(actions).toBe(0);
  resolve({ question: 'Which airport?', answer: 'Trondheim', source: 'user_clarification' });
  expect((await pending).status).toBe('done'); expect(actions).toBe(1);
});

test('stopped FX result preserves partial answer for callers', async () => {
  const { host } = fixture(); const controller = new AbortController();
  const runtime = { supportsJspi: () => true, createFxAgent: async () => ({
    prompt: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', delta: 'A useful finding' };
        controller.abort();
      },
      result: Promise.resolve({ stopReason: 'cancelled', usage: {} }), cancel() {},
    }), close: async () => {},
  }) };
  expect(await runFxBrowser('test', [], host, controller.signal, runtime)).toMatchObject({ status: 'stopped', partialReply: 'A useful finding' });
});
