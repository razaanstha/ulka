import { describe, expect, test } from "bun:test";
import { VercelJevDecisionEngine, validateGatewayChoice } from "../apps/extension/src/agent/vercel-jev";
import { progressActionKey } from "../apps/extension/src/agent/history";
import type { PageSnapshot } from "../packages/protocol/src";

const snapshot: PageSnapshot = {
  snapshotId: "s", fingerprint: "f", pageIdentity: "p", url: "https://example.test", title: "Example", text: "About",
  scroll: { y: 0, height: 100, viewportHeight: 100 }, createdAt: 1,
  elements: [{ id: "e1", nodeId: 1, role: "button", label: "About", operations: ["CLICK"] }],
  guards: { e1: { nodeId: 1, role: "button", label: "About", enabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } } },
};

describe("Vercel Gateway Jev engine", () => {
  test('Stop cancels stalled evaluation even if transport ignores cancellation', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const evaluator = (input: any) => {
      requestSignal = input.abortSignal;
      queueMicrotask(() => controller.abort(new Error('User stopped')));
      return new Promise<any>(() => {});
    };
    const engine = new VercelJevDecisionEngine('test', evaluator, controller.signal);
    await expect(engine.decide('Continue', snapshot, [])).rejects.toThrow('User stopped');
    expect(requestSignal?.aborted).toBe(true);
  });

  test('Stop releases stalled target selection without waiting for transport', async () => {
    const controller = new AbortController();
    let targetStarted!: () => void;
    const started = new Promise<void>(resolve => { targetStarted = resolve; });
    const evaluator = async (input: any): Promise<any> => {
      if (input.questions.target) { targetStarted(); return new Promise(() => {}); }
      return { answers: { operation: { type: 'choice', choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'CLICK' ? 1 : 0])) } } };
    };
    const pending = new VercelJevDecisionEngine('test', evaluator, controller.signal).decide('Continue', { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2' }] }, []);
    await started;
    controller.abort(new Error('Stopped by user'));
    await expect(pending).rejects.toThrow('Stopped by user');
  });
  test('repeated ineffective target is excluded while another control stays available', async () => {
    const page = { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2', label: 'Alternative' }] };
    const history = [1, 2].map(step => ({ step, operation: 'CLICK' as const, targetLabel: 'About', url: page.url, fingerprint: page.fingerprint, pageChanged: false, executedAt: step }));
    const evaluator = async (input: any): Promise<{ answers: Record<string, { type: 'choice'; choice: string; probabilities: Record<string, number> }> }> => {
      if (input.questions.target) {
        expect(Object.keys(input.questions.target.criteria)).toEqual(['e2']);
        return { answers: { target: { type: 'choice' as const, choice: 'e2', probabilities: { e2: 1 } } } };
      }
      return { answers: { operation: { type: 'choice' as const, choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'CLICK' ? 1 : 0])) } } };
    };
    expect((await new VercelJevDecisionEngine('test', evaluator).decide('Continue', page, history)).target).toBe('e2');
  });
  test('rejected completion removes DONE and includes feedback as evidence', async () => {
    const evaluator = async (input: any) => {
      expect(input.questions.operation.criteria.DONE).toBeUndefined();
      expect(input.state.verification_feedback.evidence).toBe('Missing outcome');
      return { answers: { operation: { type: 'choice' as const, choice: 'BLOCKED', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'BLOCKED' ? 1 : 0])) } } };
    };
    await new VercelJevDecisionEngine('test', evaluator).decide('Continue', snapshot, [], { evidence: 'Missing outcome', excludeDone: true });
  });
  test('exhausted waits are removed from action choices', async () => {
    const evaluator = async (input: any) => {
      expect(input.questions.operation.criteria.WAIT).toBeUndefined();
      return { answers: { operation: { type: 'choice' as const, choice: 'BLOCKED', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'BLOCKED' ? 1 : 0])) } } };
    };
    const history = [1, 2].map(step => ({ step, operation: 'WAIT' as const, url: snapshot.url, pageChanged: false, executedAt: step }));
    expect((await new VercelJevDecisionEngine('test', evaluator).decide('Continue', snapshot, history)).operation).toBe('BLOCKED');
  });
  test("retries invalid argmax output once without accepting it", async () => {
    let calls = 0;
    const evaluator = async (input: any) => {
      if (++calls === 1) throw new Error('Question "operation" did not select a highest-probability option.');
      return { answers: { operation: { type: "choice" as const, choice: "DONE", probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(id => [id, id === "DONE" ? 1 : 0])) } } };
    };
    expect((await new VercelJevDecisionEngine("test", evaluator).decide("Read", snapshot, [])).operation).toBe("DONE");
    expect(calls).toBe(2);
  });

  test("persistent invalid choices stop after two attempts", async () => {
    let calls = 0;
    const evaluator = async () => { calls++; throw new Error('Question "operation" did not select a highest-probability option.'); };
    await expect(new VercelJevDecisionEngine("test", evaluator).decide("Read", snapshot, [])).rejects.toThrow("highest-probability");
    expect(calls).toBe(2);
  });
  test("maps operation and authoritative click target", async () => {
    let call = 0;
    const evaluator: any = async (input: any) => {
      expect(input.model.modelId).toBe("typesafe-ai/jev");
      call += 1;
      if (call === 2) {
        expect(Object.keys(input.questions)).toEqual(["target"]);
        return { answers: { target: { type: "choice" as const, choice: "e1", probabilities: { e1: 1 } } } };
      }
      expect(Object.keys(input.questions)).toEqual(["operation"]);
      const operationIds = Object.keys(input.questions.operation.criteria);
      const remainder = 0.2 / (operationIds.length - 1);
      return { answers: {
        operation: { type: "choice" as const, choice: "CLICK", probabilities: Object.fromEntries(operationIds.map((id) => [id, id === "CLICK" ? 0.8 : remainder])) },
      } };
    };
    const decision = await new VercelJevDecisionEngine("test-key", evaluator).decide("Open About", snapshot, []);
    expect(decision.operation).toBe("CLICK");
    expect(decision.target).toBe("e1");
    expect(decision.confidence).toBe(0.8);
    expect(call).toBe(1);
    expect(decision.targetProbabilities).toBeUndefined();
  });

  test("sends JSON-compatible state after an action with absent optional fields", async () => {
    const containsUndefined = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(containsUndefined);
      if (value && typeof value === "object") return Object.values(value).some((item) => item === undefined || containsUndefined(item));
      return false;
    };
    const evaluator = async (input: any) => {
      expect(containsUndefined(input.state)).toBe(false);
      const operationIds = Object.keys(input.questions.operation.criteria);
      return { answers: {
        operation: { type: "choice" as const, choice: "DONE", probabilities: Object.fromEntries(operationIds.map((id) => [id, id === "DONE" ? 1 : 0])) },
      } };
    };
    const history = [{ step: 1, operation: "CLICK" as const, url: snapshot.url, executedAt: 1 }];
    await expect(new VercelJevDecisionEngine("test-key", evaluator).decide("Open About", snapshot, history)).resolves.toMatchObject({ operation: "DONE" });
  });

  test("rejects absent and non-argmax probability distributions", () => {
    expect(() => validateGatewayChoice({ type: "choice", choice: "A" }, ["A", "B"])).toThrow();
    expect(() => validateGatewayChoice({ type: "choice", choice: "A", probabilities: { A: 0.2, B: 0.8 } }, ["A", "B"])).toThrow();
  });
});


test('exhausted unlabeled toggle is removed before choosing another control', async () => {
  const page = { ...snapshot, elements: [{ ...snapshot.elements[0], label: '' }, { ...snapshot.elements[0], id: 'e2', label: 'Search', nodeId: 2 }] };
  const key = progressActionKey(page, { operation: 'CLICK', target: 'e1' })!;
  const evaluator = async (input: any): Promise<any> => {
    if (input.questions.target) {
      expect(Object.keys(input.questions.target.criteria)).toEqual(['e2']);
      return { answers: { target: { type: 'choice', choice: 'e2', probabilities: { e2: 1 } } } };
    }
    expect(input.state.verification_feedback).toBeUndefined();
    return { answers: { operation: { type: 'choice', choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'CLICK' ? 1 : 0])) } } };
  };
  expect((await new VercelJevDecisionEngine('test', evaluator).decide('Search', page, [], { exhaustedActions: [key] })).target).toBe('e2');
});


test('multiple compatible targets still require model selection', async () => {
  const page = { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2', label: 'Help' }] };
  let calls = 0;
  const evaluator = async (input: any): Promise<any> => {
    calls++;
    if (input.questions.target) return { answers: { target: { type: 'choice', choice: 'e2', probabilities: { e1: 0.1, e2: 0.9 } } } };
    return { answers: { operation: { type: 'choice', choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(key => [key, key === 'CLICK' ? 1 : 0])) } } };
  };
  const result = await new VercelJevDecisionEngine('test', evaluator).decide('Open Help', page, []);
  expect(calls).toBe(2);
  expect(result.target).toBe('e2');
  expect(result.targetProbabilities).toEqual({ e1: 0.1, e2: 0.9 });
});

test('model requests omit local metadata, retain compatibility, and report each evaluation', async () => {
  const reports: any[] = [], requests: any[] = [];
  const page = { ...snapshot, elements: [...snapshot.elements, { ...snapshot.elements[0], id: 'e2', label: 'Help', selected: true }] };
  const evaluator = async (input: any): Promise<any> => {
    requests.push(input);
    const key = input.questions.target ? 'target' : 'operation';
    const choice = key === 'target' ? 'e2' : 'CLICK';
    return { usage: { inputTokens: 10, outputTokens: 1 }, answers: { [key]: { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(input.questions[key].criteria).map(id => [id, id === choice ? 1 : 0])) } } };
  };
  await new VercelJevDecisionEngine('test', evaluator, undefined, (stage, usage) => reports.push({ stage, usage })).decide('Help', page, []);
  expect(requests.map(r => r.providerOptions)).toEqual([undefined, undefined]);
  expect(requests[0].state.action_targets.CLICK).toEqual(['e1', 'e2']);
  expect(requests[0].state.elements[1]).toMatchObject({ id: 'e2', label: 'Help', selected: true });
  expect(JSON.stringify(requests.map(r => r.state))).not.toContain('nodeId');
  expect(requests[1].state.elements).toHaveLength(0);
  expect(requests[1].questions.target.criteria.e2).toMatchObject({ id: 'e2', label: 'Help', selected: true, role: 'button' });
  expect(requests[1].questions.target.instructions.rules).toContain(requests[0].questions.operation.instructions.rules);
  expect(requests[1].questions.target.criteria.e2.element).toContain('Help');
  expect(reports.map(r => r.stage)).toEqual(['jev_operation', 'jev_target']);
});


test('both decision stages retain message editor structure and conversation relationships', async () => {
  const context = [{ id: 'g1', role: 'dialog', label: 'Messaging', heading: 'New message' }];
  const page: PageSnapshot = { ...snapshot, elements: [
    { id: 'e1', nodeId: 1, role: 'combobox', label: 'Enter message recipients', context, operations: ['TYPE_TEXT'] },
    { id: 'e2', nodeId: 2, role: 'textbox', label: 'Write a message…', context: [...context, { id: 'g2', role: 'form' }], multiline: true, operations: ['TYPE_TEXT'] },
  ] };
  const requests: any[] = [];
  const evaluator = async (input: any): Promise<any> => {
    requests.push(input);
    const key = input.questions.target ? 'target' : 'operation';
    const choice = key === 'target' ? 'e2' : 'TYPE_TEXT';
    return { answers: { [key]: { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(input.questions[key].criteria).map(id => [id, id === choice ? 1 : 0])) } } };
  };
  const result = await new VercelJevDecisionEngine('test', evaluator).decide('Draft the message', page, []);
  expect(result.target).toBe('e2');
  for (const rows of [requests[0].state.elements, Object.values(requests[1].questions.target.criteria)]) {
    expect(rows[0].context[0]).toEqual(context[0]);
    expect(rows[1].context).toEqual(page.elements[1].context);
    expect(rows[1].multiline).toBe(true);
  }
});

test('large calendars omit offscreen rows from decisions without losing visible dates or blocked editors', async () => {
  const page: PageSnapshot = { ...snapshot, elements: [
    { ...snapshot.elements[0], label: 'October 5, 2026' },
    { id: 'editor', nodeId: 2, role: 'textbox', label: 'Write a message', availability: 'occluded', operations: [] },
    ...Array.from({ length: 248 }, (_, i) => ({ id: `date${i}`, nodeId: i + 3, role: 'button', label: `Offscreen date ${i}`, availability: 'offscreen' as const, operations: [] })),
  ], scroll: { y: 0, height: 2000, viewportHeight: 800 } };
  const evaluator = async (input: any) => {
    expect(input.state.elements.map((e: any) => e.id)).toEqual(['e1', 'editor']);
    expect(input.state.offscreen_controls).toEqual({ count: 248, by_role: { button: 248 } });
    expect(input.questions.operation.criteria.SCROLL_DOWN).toBeDefined();
    expect(input.state.action_targets.CLICK).toEqual(['e1']);
    return { answers: { operation: { type: 'choice' as const, choice: 'CLICK', probabilities: Object.fromEntries(Object.keys(input.questions.operation.criteria).map(id => [id, id === 'CLICK' ? 1 : 0])) } } };
  };
  expect((await new VercelJevDecisionEngine('test', evaluator).decide('Select October 5', page, [])).target).toBe('e1');
});
