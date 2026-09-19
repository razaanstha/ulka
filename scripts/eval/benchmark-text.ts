/** Public synthetic inputs only. Measures full writer + reviewer, not browser success. */
import { createGateway } from 'ai';
import { TextGenerator } from '../../apps/extension/src/agent/text-generator';
import { generateStructuredText } from '../../apps/extension/src/agent/structured-generation';
import { TEXT_MODEL } from '../../apps/extension/src/agent/models';
import type { PageSnapshot, PageElement } from '../../packages/protocol/src';

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) {
  console.error('Set AI_GATEWAY_API_KEY in the environment to run paid text-model comparisons. No browser profile or stored credentials are read.');
  process.exit(2);
}
const repeats = Number(process.argv[2] ?? 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Repeats must be 1–10');
const gateway = createGateway({ apiKey });
const cases = [
  { name: 'city', label: 'Destination', goal: 'Enter London in the destination field.', expected: 'London' },
  { name: 'article-search', label: 'Search', goal: 'Search for James Webb Space Telescope.', expected: 'James Webb Space Telescope' },
  { name: 'departure', label: 'Departure', goal: 'Set departure to October 5, 2026. Return October 12, 2026.', expected: '2026-10-05', inputType: 'date' },
  { name: 'return', label: 'Return', goal: 'Set departure to October 5, 2026. Return October 12, 2026.', expected: '2026-10-12', inputType: 'date' },
];
const arms = [
  { arm: 'previous-field-model', model: 'inception/mercury-2.5', reasoning: 'none' as const },
  { arm: 'current-field-model', model: TEXT_MODEL, reasoning: 'none' as const },
];
const rows: Array<Record<string, unknown>> = [];
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const task of cases) {
    for (const arm of repeat % 2 ? [...arms].reverse() : arms) {
      const field: PageElement = { id: 'e1', nodeId: 1, role: 'textbox', label: task.label, operations: ['TYPE_TEXT'], ...(task.inputType ? { inputType: task.inputType } : {}) };
      const page: PageSnapshot = { snapshotId: 's', fingerprint: 'f', pageIdentity: 'p', url: 'https://example.test', title: 'Public benchmark fixture', text: '', elements: [field], guards: {}, scroll: { y: 0, height: 100, viewportHeight: 100 }, createdAt: 0 };
      const stages: Array<Record<string, unknown>> = [];
      let calls = 0;
      const writer = new TextGenerator(apiKey, undefined, undefined, async input => {
        const started = performance.now(); calls++;
        try {
          const result = await generateStructuredText({ ...input, model: gateway(arm.model), reasoning: arm.reasoning });
          stages.push({ elapsedMs: performance.now() - started, usage: result.totalUsage ?? result.usage });
          return result;
        } catch (error) { stages.push({ elapsedMs: performance.now() - started, failed: true }); throw error; }
      });
      const started = performance.now();
      try {
        const value = await writer.generate(task.goal, field, page, []);
        rows.push({ repeat, task: task.name, ...arm, passed: value === task.expected, elapsedMs: performance.now() - started, calls, stages });
      } catch (error) {
        // Provider messages may echo inputs. Record only error type.
        rows.push({ repeat, task: task.name, ...arm, passed: false, elapsedMs: performance.now() - started, calls, stages, errorType: error instanceof Error ? error.name : 'UnknownError' });
      }
    }
  }
}
const summary = arms.map(arm => {
  const runs = rows.filter(row => row.arm === arm.arm);
  const durations = runs.map(row => row.elapsedMs as number).sort((a, b) => a - b);
  return { ...arm, passed: runs.filter(row => row.passed).length, total: runs.length,
    p50Ms: durations[Math.ceil(durations.length * .5) - 1], p95Ms: durations[Math.ceil(durations.length * .95) - 1] };
});
console.log(JSON.stringify({ scope: 'Synthetic text generation plus review; no browser actions or end-to-end performance claim', summary, rows }, null, 2));
if (rows.some(row => !row.passed)) process.exitCode = 1;
