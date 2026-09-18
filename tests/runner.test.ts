import { describe, expect, test } from "bun:test";
import { AgentRunner } from "../apps/extension/src/agent/agent-runner";
import { StaleDecisionError } from "../apps/extension/src/agent/freshness";
import { OutcomeVerifier, VerificationUnavailableError } from '../apps/extension/src/agent/outcome-verifier';
import type { PageSnapshot } from "../packages/protocol/src";

const makeSnapshot = (fingerprint: string): PageSnapshot => ({ snapshotId: fingerprint, fingerprint, pageIdentity: "p", url: "https://example.test", title: "", text: "About",
  scroll: { y: 0, height: 100, viewportHeight: 100 }, createdAt: Date.now(), elements: [{ id: "e1", nodeId: 1, role: "button", label: "About", operations: ["CLICK"] }],
  guards: { e1: { nodeId: 1, role: "button", label: "About", enabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } } } });

describe("agent runner", () => {
  test('popup focus transfer reobserves and explains recovery before typing into the new editor', async () => {
    let opened = false, decisions = 0;
    const typed: string[] = [];
    const runner = new AgentRunner({ observe: async () => ({ ...makeSnapshot(opened ? 'popup' : 'trigger'), elements: [
      { id: opened ? 'popup' : 'trigger', nodeId: opened ? 2 : 1, role: 'combobox', label: 'Where to?', focused: opened, operations: ['TYPE_TEXT' as const] },
    ] }) } as never, { decide: async (_goal, page, _history, feedback) => {
      if (++decisions === 2) {
        expect(feedback?.evidence).toContain('Typing target lost focus');
        expect(feedback?.excludeDone).toBe(true);
        expect(page.elements[0].focused).toBe(true);
      }
      return typed.length ? { operation: 'DONE', confidence: 1 } : { operation: 'TYPE_TEXT', target: page.elements[0].id, confidence: 1 };
    } }, { execute: async (_page: PageSnapshot, decision: { target?: string }) => {
      if (!opened) { opened = true; throw new StaleDecisionError('Typing target lost focus or changed after click'); }
      typed.push(decision.target!);
    } } as never, undefined, {}, { generate: async () => 'Vienna' }, { verify: async () => ({ satisfied: true, evidence: 'Vienna selected' }) });
    expect((await runner.run('Choose Vienna')).status).toBe('done');
    expect(typed).toEqual(['popup']);
  });
  test('transient completion-check failure resumes without replaying the browser action', async () => {
    let actions = 0, decisions = 0, checks = 0;
    const verifier = new OutcomeVerifier('test', undefined, undefined, { generate: async () => {
      if (++checks === 1) throw Object.assign(new Error('Temporary'), { name: 'GatewayInternalServerError' });
      return { output: { satisfied: true, evidence: 'About page observed' } };
    } });
    const runner = new AgentRunner({ observe: async () => makeSnapshot(String(actions)) } as never,
      { decide: async () => { decisions++; return actions ? { operation: 'DONE', confidence: 1 } : { operation: 'CLICK', target: 'e1', confidence: 1 }; } },
      { execute: async () => { actions++; } } as never, undefined, {}, undefined, verifier);
    expect((await runner.run('Open About')).status).toBe('done');
    expect(actions).toBe(1); expect(decisions).toBe(2); expect(checks).toBe(2);
  });
  test('unavailable verification blocks without another decision or action', async () => {
    let decisions = 0;
    const runner = new AgentRunner({ observe: async () => makeSnapshot('same') } as never,
      { decide: async () => { decisions++; return { operation: 'DONE', confidence: 1 }; } },
      { execute: async () => { throw new Error('must not execute'); } } as never, undefined, {}, undefined,
      { verify: async () => { throw new VerificationUnavailableError(); } });
    expect(await runner.run('Open About')).toMatchObject({ status: 'blocked', failure: 'verification_unavailable' });
    expect(decisions).toBe(1);
  });
  test('sensitive generated text is reviewed before execution and denial prevents typing', async () => {
    const snapshot = makeSnapshot('sensitive');
    snapshot.elements[0] = { id: 'e1', nodeId: 1, role: 'textbox', label: 'Card number', operations: ['TYPE_TEXT'] };
    let executed = false;
    let reviewed: unknown;
    const runner = new AgentRunner({ observe: async () => snapshot } as never,
      { decide: async () => ({ operation: 'TYPE_TEXT', target: 'e1', confidence: 1 }) },
      { execute: async () => { executed = true; } } as never, undefined,
      { approve: async (...args: unknown[]) => { reviewed = args[2]; return false; } },
      { generate: async () => 'test value for review' });
    expect((await runner.run('Fill field')).status).toBe('blocked');
    expect(executed).toBe(false);
    expect(reviewed).toBe('test value for review');
  });
  test('rejected completion guides a validated corrective action before finishing', async () => {
    let decisions = 0, checks = 0, actions = 0;
    const runner = new AgentRunner({ observe: async () => makeSnapshot(String(actions)) } as never,
      { decide: async (_goal, _snapshot, _history, feedback) => {
        decisions++;
        if (decisions === 2) { expect(feedback).toEqual({ evidence: 'About still needs opening', excludeDone: true }); return { operation: 'CLICK', target: 'e1', confidence: 1 }; }
        return { operation: 'DONE', confidence: 1 };
      } }, { execute: async () => { actions++; } } as never, undefined, {}, undefined,
      { verify: async () => ({ satisfied: ++checks > 1, evidence: 'About still needs opening' }) });
    expect((await runner.run('Open About')).status).toBe('done');
    expect(actions).toBe(1); expect(checks).toBe(2);
  });
  test('repeated failed completion remains bounded', async () => {
    let checks = 0;
    const runner = new AgentRunner({ observe: async () => makeSnapshot('same') } as never,
      { decide: async () => ({ operation: 'DONE', confidence: 1 }) },
      { execute: async () => { throw new Error('must not execute'); } } as never, undefined, {}, undefined,
      { verify: async () => { checks++; return { satisfied: false, evidence: 'Incomplete' }; } });
    expect((await runner.run('Open About')).status).toBe('blocked'); expect(checks).toBe(2);
  });
  test('mixed scroll directions retain seen text and reach checkpoint', async () => {
    let actions = 0; const seen: number[] = [];
    const observer = { observe: async () => { const page = makeSnapshot(String(actions)); page.text = actions % 2 ? 'Position B' : 'Position A'; page.elements[0].operations.push('SCROLL_ELEMENT_UP'); return page; } };
    const runner = new AgentRunner(observer as never,
      { decide: async () => ({ operation: actions % 2 ? 'SCROLL_ELEMENT_UP' : 'SCROLL_DOWN', target: actions % 2 ? 'e1' : undefined, confidence: 1 }) },
      { execute: async () => { actions++; } } as never, undefined,
      { onTrace: event => { if (event.type === 'scroll_progress') seen.push(event.detail.newTextChunks as number); } });
    expect((await runner.run('Read details')).status).toBe('blocked');
    expect(actions).toBe(4); expect(seen).toEqual([1, 0, 0, 0]);
  });
  test('unchanged waits cannot restart in another subgoal', async () => {
    let actions = 0; const memory = { history: [] as any[], attempts: new Map<string, number>() };
    const makeRunner = () => new AgentRunner({ observe: async () => makeSnapshot('same') } as never,
      { decide: async () => ({ operation: 'WAIT', confidence: 1 }) },
      { execute: async () => { actions++; } } as never, undefined, { taskMemory: memory });
    expect((await makeRunner().run('Wait')).reason).toContain('Wait checkpoint');
    expect(actions).toBe(2);
    expect((await makeRunner().run('Wait again')).reason).toContain('Wait checkpoint');
    expect(actions).toBe(2);
  });
  test("scrolling with changing fingerprints but no new text returns to planner", async () => {
    let observations = 0, actions = 0;
    const runner = new AgentRunner({ observe: async () => makeSnapshot(String(observations++)) } as never,
      { decide: async () => ({ operation: 'SCROLL_DOWN', confidence: 1 }) },
      { execute: async () => { actions++; } } as never);
    expect((await runner.run('Find details')).reason).toContain('no new readable content');
    expect(actions).toBe(3);
  });
  test("new content still yields after four scrolls for planner inspection", async () => {
    let observations = 0, actions = 0;
    const runner = new AgentRunner({ observe: async () => ({ ...makeSnapshot(String(observations++)), text: `New content ${observations}` }) } as never,
      { decide: async () => ({ operation: 'SCROLL_DOWN', confidence: 1 }) },
      { execute: async () => { actions++; } } as never);
    expect((await runner.run('Find details')).reason).toContain('Scroll checkpoint');
    expect(actions).toBe(4);
  });
  test("stops alternating scrolls despite changing fingerprints", async () => {
    let count = 0, actions = 0;
    const runner = new AgentRunner({ observe: async () => makeSnapshot(String(count++)) } as never,
      { decide: async () => ({ operation: actions % 2 ? "SCROLL_UP" : "SCROLL_DOWN", confidence: 1 }) },
      { execute: async () => { actions++; } } as never);
    expect((await runner.run("Find details")).reason).toMatch(/Alternating scroll cycle|no new readable content/);
    expect(actions).toBe(3);
  });
  test("stop aborts pending model request and returns stopped", async () => {
    const requests = new AbortController();
    const runner = new AgentRunner({ observe: async () => makeSnapshot("a") } as never,
      { decide: async () => new Promise((_resolve, reject) => requests.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) },
      { execute: async () => { throw new Error("must not execute"); } } as never,
      undefined, { cancelRequests: () => requests.abort() });
    const pending = runner.run("Find details");
    await Promise.resolve(); runner.stop();
    expect((await pending).status).toBe("stopped");
    expect(requests.signal.aborted).toBe(true);
  });
  test("bounds repeated stale targets", async () => {
    let attempts = 0;
    const runner = new AgentRunner({ observe: async () => makeSnapshot("a") } as never,
      { decide: async () => ({ operation: "CLICK", target: "e1", confidence: 1 }) },
      { execute: async () => { attempts++; throw new StaleDecisionError("center occluded"); } } as never);
    expect((await runner.run("Open About")).reason).toContain("Repeated stale targets");
    expect(attempts).toBe(3);
  });
  test("detects cycling actions across separate subgoals", async () => {
    const memory = { history: [] as any[], attempts: new Map<string, number>() };
    let current = "a", executions = 0, priorHistory = 0;
    const makeRunner = () => new AgentRunner({ observe: async () => makeSnapshot(current) } as never,
      { decide: async (_goal, _page, history) => { priorHistory = history.length; return { operation: "CLICK", target: "e1", confidence: 1 }; } },
      { execute: async () => { executions++; current = current === "a" ? "b" : "a"; } } as never,
      undefined, { maxActions: 2, taskMemory: memory });
    await makeRunner().run("First subgoal");
    await makeRunner().run("Second subgoal");
    await makeRunner().run("Third subgoal");
    const result = await makeRunner().run("Retry subgoal");
    expect(result.reason).toContain("Repeated action");
    expect(executions).toBe(2);
    expect(priorHistory).toBe(2);
  });
  test("rejects unverified DONE without execution", async () => {
    const observer = { observe: async () => makeSnapshot("a") };
    const decisions = { decide: async () => ({ operation: "DONE" as const, confidence: 1 }) };
    const executor = { execute: async () => { throw new Error("must not execute"); } };
    const runner = new AgentRunner(observer as never, decisions, executor as never);
    expect((await runner.run("Open About")).status).toBe("blocked");
    expect(runner.states.state).toBe("BLOCKED");
  });
  test("handles BLOCKED", async () => {
    const runner = new AgentRunner({ observe: async () => makeSnapshot("a") } as never,
      { decide: async () => ({ operation: "BLOCKED", confidence: 1 }) }, { execute: async () => {} } as never);
    expect((await runner.run("Impossible")).status).toBe("blocked");
  });
  test("accepts DONE only after independent verifier confirms outcome", async () => {
    let calls = 0;
    const observer = { observe: async () => makeSnapshot(calls === 0 ? "before" : "after") };
    const decisions = { decide: async () => ++calls === 1
      ? { operation: "CLICK" as const, target: "e1", confidence: 1 }
      : { operation: "DONE" as const, confidence: 1 } };
    const verifier = { verify: async () => ({ satisfied: true, evidence: "About page visible" }) };
    const runner = new AgentRunner(observer as never, decisions, { execute: async () => {} } as never, undefined, {}, undefined, verifier);
    expect((await runner.run("Open About")).status).toBe("done");
  });
  test("discards stale decision, observes, and asks again", async () => {
    let decisionCalls = 0, executionCalls = 0;
    const observer = { observe: async () => makeSnapshot(`f${decisionCalls}`) };
    const decisions = { decide: async () => ++decisionCalls === 1
      ? { operation: "CLICK" as const, target: "e1", confidence: 1 }
      : { operation: "DONE" as const, confidence: 1 } };
    const executor = { execute: async () => { executionCalls++; throw new StaleDecisionError(); } };
    const runner = new AgentRunner(observer as never, decisions, executor as never);
    expect((await runner.run("Open About")).status).toBe("blocked");
    expect(decisionCalls).toBe(2);
    expect(executionCalls).toBe(1);
    expect(runner.history).toHaveLength(0);
  });
  test("rejects invalid target before execution", async () => {
    let executed = false;
    const runner = new AgentRunner({ observe: async () => makeSnapshot("a") } as never,
      { decide: async () => ({ operation: "CLICK", target: "e999", confidence: 1 }) },
      { execute: async () => { executed = true; } } as never);
    await expect(runner.run("Open About")).rejects.toThrow("invalid");
    expect(executed).toBe(false);
  });

  test("reuses generated text only across identical stale retry context", async () => {
    const typed = makeSnapshot("same");
    typed.elements = [{ id: "e1", nodeId: 1, role: "textbox", label: "From", operations: ["TYPE_TEXT"] }];
    typed.guards.e1 = { nodeId: 1, role: "textbox", label: "From", enabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } };
    let decisions = 0, executions = 0, generations = 0;
    const decisionEngine = { decide: async () => ++decisions <= 2
      ? { operation: "TYPE_TEXT" as const, target: "e1", confidence: 1 }
      : { operation: "DONE" as const, confidence: 1 } };
    const executor = { execute: async () => { if (++executions === 1) throw new StaleDecisionError(); } };
    const textEngine = { generate: async () => { generations++; return "Stockholm"; } };
    const verifier = { verify: async () => ({ satisfied: true, evidence: "From is Stockholm" }) };
    const runner = new AgentRunner({ observe: async () => typed } as never, decisionEngine, executor as never, undefined, {}, textEngine, verifier);
    expect((await runner.run("Fly from Stockholm")).status).toBe("done");
    expect(generations).toBe(1);
  });

  test("stop during decision prevents execution", async () => {
    let resolveDecision!: (value: { operation: "CLICK"; target: string; confidence: number }) => void;
    const decision = new Promise<{ operation: "CLICK"; target: string; confidence: number }>((resolve) => { resolveDecision = resolve; });
    let executed = false;
    const runner = new AgentRunner({ observe: async () => makeSnapshot("a") } as never, { decide: async () => decision }, { execute: async () => { executed = true; } } as never);
    const result = runner.run("Open About");
    await Promise.resolve(); runner.stop(); resolveDecision({ operation: "CLICK", target: "e1", confidence: 1 });
    expect((await result).status).toBe("stopped");
    expect(executed).toBe(false);
  });
});

test('unlabelled toggle cycles stay exhausted across subgoals and document reloads', async () => {
  let actions = 0, document = 1;
  const memory = { history: [] as any[], attempts: new Map<string, number>() };
  const observe = async () => {
    const page = makeSnapshot(`noise-${actions}-${document}`);
    page.pageIdentity = String(document);
    page.elements[0].label = '';
    page.elements[0].expanded = actions % 2 === 1;
    return page;
  };
  const run = () => new AgentRunner({ observe } as never,
    { decide: async () => ({ operation: 'CLICK', target: 'e1', confidence: 1 }) },
    { execute: async () => { actions++; } } as never, undefined, { taskMemory: memory, maxActions: 8 }).run('Choose location');
  expect((await run()).reason).toContain('Repeated action');
  expect(actions).toBe(4);
  document++;
  expect((await run()).reason).toContain('Repeated action');
  expect(actions).toBe(4);
});


test('repeated clicks remain allowed when control value makes real progress', async () => {
  let actions = 0;
  const observe = async () => {
    const page = makeSnapshot(String(actions));
    page.elements[0].value = String(actions);
    return page;
  };
  const runner = new AgentRunner({ observe } as never,
    { decide: async () => actions < 7 ? { operation: 'CLICK', target: 'e1', confidence: 1 } : { operation: 'DONE', confidence: 1 } },
    { execute: async () => { actions++; } } as never, undefined, {}, undefined,
    { verify: async () => ({ satisfied: true, evidence: 'Counter reached seven' }) });
  expect((await runner.run('Increment to seven')).status).toBe('done');
  expect(actions).toBe(7);
});

test('explicit WAIT uses longer observation budget and stop interrupts polling', async () => {
  let budget = 0;
  const runner = new AgentRunner({ observe: async () => makeSnapshot('a'),
    waitForChange: async (before: PageSnapshot, stopped: () => boolean, timeout: number) => {
      budget = timeout; runner.stop(); expect(stopped()).toBe(true); return before;
    } } as never,
    { decide: async () => ({ operation: 'WAIT', confidence: 1 }) },
    { execute: async () => {} } as never);
  expect((await runner.run('Wait for results')).status).toBe('stopped');
  expect(budget).toBe(10000);
});

test('unrelated text and changing element positions cannot reset control retry budget', async () => {
  let actions = 0;
  const observe = async () => {
    const page = makeSnapshot(String(actions));
    page.text = `Live clock ${actions}`;
    page.elements[0].expanded = actions % 2 === 1;
    page.elements[0].id = `e${actions + 1}`;
    page.elements.unshift(...Array.from({ length: actions }, (_, i) => ({ id: `noise${i}`, nodeId: 100 + i, role: 'link', label: `News ${i}`, operations: ['CLICK' as const] })));
    return page;
  };
  const runner = new AgentRunner({ observe } as never,
    { decide: async () => ({ operation: 'CLICK', target: `e${actions + 1}`, confidence: 1 }) },
    { execute: async () => { actions++; } } as never, undefined, { maxActions: 8 });
  expect((await runner.run('Choose location')).reason).toContain('Repeated action');
  expect(actions).toBe(4);
});


test('next decision reuses settled post-action observation without another scan', async () => {
  let scans = 0, decisions = 0;
  const before = makeSnapshot('before'), after = makeSnapshot('after');
  const runner = new AgentRunner({
    observe: async () => { scans++; return before; },
    waitForChange: async () => after,
  }, { decide: async (_goal, page) => {
    if (++decisions === 1) return { operation: 'CLICK', target: 'e1', confidence: 1 };
    expect(page).toBe(after);
    return { operation: 'DONE', confidence: 1 };
  } }, { execute: async () => {} } as never, undefined, {}, undefined,
  { verify: async () => ({ satisfied: true, evidence: 'Observed outcome' }) });
  expect((await runner.run('Open About')).status).toBe('done');
  expect(scans).toBe(1);
});

test('page-state cycles remain bounded across separate subgoals', async () => {
  const memory = { history: [] as any[], attempts: new Map<string, number>() };
  let actions = 0;
  let last: any;
  for (let i = 0; i < 6; i++) {
    const observer = { observe: async () => ({ ...makeSnapshot(String(actions)), text: actions % 2 ? 'Calendar open' : 'Calendar closed', elements: [{ ...makeSnapshot('x').elements[0], operations: ['PRESS_ESCAPE' as const] }] }) };
    const runner = new AgentRunner(observer as never,
      { decide: async () => ({ operation: 'PRESS_ESCAPE', target: 'e1', confidence: 1 }) },
      { execute: async () => { actions++; } } as never, undefined, { taskMemory: memory, maxActions: 1 });
    last = await runner.run('Select date');
    if (last.reason?.includes('page-state cycle')) break;
  }
  expect(last.reason).toContain('page-state cycle');
  expect(actions).toBeLessThanOrEqual(6);
});
