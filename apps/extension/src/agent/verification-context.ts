import { modelHistory, modelPage } from './model-context';
import type { TaskEvidence } from './fx-agent';
import type { ActionRecord, PageSnapshot } from '../../../../packages/protocol/src';

// Encode repeated observation structure once, without selecting or truncating evidence.
// Control rows preserve every semantic property, including false/empty field state.
export function verificationContext(goal: string, page: PageSnapshot, history: ActionRecord[], evidence: TaskEvidence[]) {
  const contexts: unknown[] = [];
  const contextIds = new Map<string, number>();
  const controlSets: Array<{ columns: string[]; rows: unknown[][] }> = [];
  const controlIds = new Map<string, number>();
  const packControls = (controls: Record<string, unknown>[]) => {
    const records = controls.map(control => {
      const { nodeId: _nodeId, operations: _operations, context, ...state } = control;
      if (context !== undefined) {
        const key = JSON.stringify(context);
        let id = contextIds.get(key);
        if (id === undefined) { id = contexts.length; contextIds.set(key, id); contexts.push(context); }
        return { ...state, contextRef: id };
      }
      return state;
    });
    const frequency = new Map<string, number>();
    for (const record of records) for (const key of Object.keys(record)) frequency.set(key, (frequency.get(key) ?? 0) + 1);
    const columns = [...frequency.keys()].sort((a, b) => frequency.get(b)! - frequency.get(a)!);
    const table = { columns, rows: records.map(record => {
      const row = columns.map(column => record[column] ?? null);
      // Sparse widget state must not add dozens of null cells to every link row.
      while (row.length && row.at(-1) === null) row.pop();
      return row;
    }) };
    const key = JSON.stringify(table);
    let id = controlIds.get(key);
    if (id === undefined) { id = controlSets.length; controlIds.set(key, id); controlSets.push(table); }
    return { controlSetRef: id };
  };
  const pack = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(pack);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      (key === 'elements' || key === 'controls') && Array.isArray(item)
        ? packControls(item) : pack(item),
    ]));
  };
  const taskEvidence = evidence.map(item => {
    let result: unknown = item.result;
    try { result = JSON.parse(item.result); } catch { /* Older evidence may be plain text. */ }
    return { ...item, result };
  });
  return { goal, page: pack(modelPage(page)), recentActions: modelHistory(history), taskEvidence: pack(taskEvidence),
    encoding: 'controlSetRef indexes controlSets; rows align with columns; null or missing trailing cells mean absent. contextRef indexes contexts. Tables retain all observed controls and their state; execution operations are omitted. Earlier evidence is chronological and may be superseded by later observations.',
    controlSets, contexts,
  };
}
