import { expect, test } from 'bun:test';
import { verificationContext } from '../apps/extension/src/agent/verification-context';
import { modelPage } from '../apps/extension/src/agent/model-context';
import type { PageElement, PageSnapshot } from '../packages/protocol/src';

const page: PageSnapshot = {
  snapshotId: 's', fingerprint: 'f', pageIdentity: 'p', url: 'https://example.test', title: 'Results', text: 'Observed result',
  scroll: { y: 0, height: 100, viewportHeight: 100 }, guards: {}, createdAt: 1,
  elements: Array.from({ length: 250 }, (_, i) => ({ id: `e${i}`, nodeId: i, role: 'button', label: `Result ${i}`,
    operations: ['CLICK', 'RIGHT_CLICK', 'HOVER'] as PageElement['operations'],
    context: [{ id: 'g1', role: 'dialog', label: 'Search results', heading: 'Choose matching result from this list' }],
    selected: false, pressed: false,
  })),
};

function decodeControls(payload: ReturnType<typeof verificationContext>, reference: any) {
  const table = payload.controlSets[reference.controlSetRef];
  const base = (table as any).baseControlSetRef === undefined ? undefined : payload.controlSets[(table as any).baseControlSetRef];
  return table.rows.map(row => {
    if (typeof row === 'number') row = base!.rows[row] as unknown[];
    const record: Record<string, unknown> = {};
    table.columns.forEach((key, i) => {
      if (row[i] != null) record[key === 'contextRef' ? 'context' : key] = key === 'contextRef' ? payload.contexts[row[i] as number] : row[i];
    });
    return record;
  });
}

test('verification compaction retains all controls, late field values and shared widget relationships', () => {
  const snapshot = { ...page, elements: [...page.elements, {
    id: 'destination', nodeId: 500, role: 'combobox', label: 'Destination', value: '', valueLength: 0,
    expanded: true, optionIds: ['e249'], activeOptionId: 'e249', operations: ['TYPE_TEXT' as const],
  }] };
  const packed = verificationContext('Choose destination', snapshot, [], []);
  const controls = decodeControls(packed, (packed.page as any).elements);
  expect(controls).toEqual(snapshot.elements.map(({ nodeId, operations, ...meaning }) => meaning));
  expect(controls.at(-1)).toMatchObject({ value: '', valueLength: 0, expanded: true, activeOptionId: 'e249' });
  expect(packed.contexts).toHaveLength(1);
});

test('small changes reuse exact control rows without dropping reordered or changed evidence', () => {
  const snapshots = Array.from({ length: 8 }, (_, index) => ({ ...page,
    elements: page.elements.map((e, i) => ({ ...e, label: `Result ${i}: ${'Observed flight information '.repeat(5)}`, selected: i === index })),
  }));
  snapshots[3].elements.reverse();
  snapshots[4].elements.splice(80, 1);
  const evidence = snapshots.map((s, i) => ({ tool: 'observe_browser', observedAt: String(i), result: JSON.stringify({ page: modelPage(s) }) }));
  const packed = verificationContext('Compare results', snapshots[7], [], evidence);
  for (const [i, item] of (packed.taskEvidence as any[]).entries()) {
    expect(decodeControls(packed, item.result.page.elements)).toEqual(snapshots[i].elements.map(({ nodeId, operations, ...e }) => e));
  }
  const formerTableCharacters = snapshots.reduce((n, s) => n + JSON.stringify(verificationContext('', s, [], []).controlSets).length, 0);
  expect(JSON.stringify(packed.controlSets).length).toBeLessThan(formerTableCharacters * 0.35);
});

test('repeated observations share tables without losing chronology or changed states', () => {
  const latest = { ...page, elements: page.elements.map((e, i) => i === 249 ? { ...e, selected: true } : e) };
  const observed = { observation: { page: { ...modelPage(page), controls: modelPage(page).elements, elements: undefined } } };
  const evidence = [1, 2, 3].map(i => ({ tool: 'browser_subgoal', observedAt: String(i), result: JSON.stringify(observed) }));
  const packed = verificationContext('Choose result', latest, [], evidence);
  expect(packed.controlSets).toHaveLength(2);
  const items = packed.taskEvidence as any[];
  expect(items.map(item => item.observedAt)).toEqual(['1', '2', '3']);
  expect(decodeControls(packed, (packed.page as any).elements).at(-1)?.selected).toBe(true);
  expect(decodeControls(packed, items[0].result.observation.page.controls).at(-1)?.selected).toBe(false);
  const original = JSON.stringify({ goal: 'Choose result', page: modelPage(latest), recentActions: [], taskEvidence: evidence });
  expect(JSON.stringify(packed).length).toBeLessThan(original.length * 0.4);
});

test('legacy plain text and explicit truncation markers remain evidence, never silently repaired', () => {
  const packed = verificationContext('Read details', page, [], [
    { tool: 'read_page', observedAt: '1', result: '{"reading":"cut off' },
    { tool: 'observe_browser', observedAt: '2', result: JSON.stringify({ page: { text: 'Partial', textTruncated: true, omittedControls: 12 } }) },
  ]);
  const items = packed.taskEvidence as any[];
  expect(items[0].result).toBe('{"reading":"cut off');
  expect(items[1].result.page).toMatchObject({ textTruncated: true, omittedControls: 12 });
});
