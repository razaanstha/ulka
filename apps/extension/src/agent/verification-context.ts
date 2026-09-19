import { modelHistory, modelPage } from './model-context';
import type { TaskEvidence } from './fx-agent';
import type { ActionRecord, PageSnapshot } from '../../../../packages/protocol/src';

// Encode repeated observation structure once, without selecting or truncating evidence.
// Control rows preserve every semantic property, including false/empty field state.
export function verificationContext(goal: string, page: PageSnapshot, history: ActionRecord[], evidence: TaskEvidence[]) {
  const contexts: unknown[] = [];
  const contextIds = new Map<string, number>();
  const controlSets: Array<{ columns: string[]; rows: Array<unknown[] | number>; baseControlSetRef?: number }> = [];
  const bases: Array<{ id: number; columns: string; rows: Map<string, number> }> = [];
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
    if (id === undefined) {
      id = controlSets.length;
      controlIds.set(key, id);
      // Reuse identical rows across slightly different observations, including
      // reordering/removal. References point only to full tables, never chains.
      let encoded: typeof controlSets[number] = table;
      let size = key.length;
      const columnKey = JSON.stringify(columns);
      const rowKeys = table.rows.map(row => JSON.stringify(row));
      for (const base of bases) {
        if (base.columns !== columnKey) continue;
        const candidate = { columns, baseControlSetRef: base.id,
          rows: table.rows.map((row, i) => base.rows.get(rowKeys[i]) ?? row) };
        const candidateSize = JSON.stringify(candidate).length;
        if (candidateSize < size) { encoded = candidate; size = candidateSize; }
      }
      controlSets.push(encoded);
      if (encoded.baseControlSetRef === undefined) bases.push({ id, columns: columnKey,
        rows: new Map(rowKeys.map((row, index) => [row, index])) });
    }
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
    encoding: 'controlSetRef indexes controlSets; array rows align with columns; null or missing trailing cells mean absent. If a table has baseControlSetRef, each integer row copies that row index from the referenced full table; array rows are the changed/new rows. Row order and removals are represented exactly. contextRef indexes contexts. Tables retain all observed controls and their state; execution operations are omitted. Earlier evidence is chronological and may be superseded by later observations.',
    controlSets, contexts,
  };
}
