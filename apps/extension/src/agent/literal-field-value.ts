import type { PageElement, PageSnapshot } from '../../../../packages/protocol/src';

const normalize = (value: string) => value.trim().toLocaleLowerCase();

// A deliberately small command grammar, not an NLP guess. Only the original
// user request may supply literals; planner goals and page text are excluded.
export function literalFieldValue(request: string | undefined, field: PageElement, page: PageSnapshot): string | undefined {
  if (!request || field.multiline || field.inputType === 'password' || field.availability || !field.operations.includes('TYPE_TEXT')) return;
  if (!['textbox', 'searchbox', 'combobox'].includes(field.role)) return;
  const label = normalize(field.label);
  if (!label || page.elements.filter(e => normalize(e.label) === label).length !== 1) return;
  // Conditional instructions, examples, alternatives and corrections require interpretation.
  if (/\b(if|unless|when|until|instead|either|example|previous|original|replace|change|except)\b/i.test(request) || /\b(?:do not|don't|never)\s+(?:set|fill|type|enter)\b/i.test(request)) return;
  // Only an entire, literal search command can bind without a field label.
  // Multiple search controls or site/workflow qualifiers require interpretation.
  const search = /^(?:please\s+)?search\s+for\s+(?:"([^"\n]+)"|“([^”\n]+)”)\.?$/i.exec(request.trim());
  if (search) {
    const searches = page.elements.filter(element => element.role === 'searchbox' || element.inputType === 'search');
    const value = search[1] ?? search[2];
    if ((field.role === 'searchbox' || field.inputType === 'search') && searches.length === 1 && searches[0].id === field.id && field.inputType !== 'date' && value.length <= 2000) return value;
    return;
  }
  const clauses: string[] = [];
  let start = 0, quote = '';
  for (let i = 0; i < request.length; i++) {
    const char = request[i];
    if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === '“') quote = char === '“' ? '”' : char;
    else if (char === ',' || char === ';' || char === '\n') { clauses.push(request.slice(start, i).trim()); start = i + 1; }
  }
  if (quote) return;
  clauses.push(request.slice(start).trim());
  // Never select one assignment while ignoring later instructions or context.
  // Separators inside quoted values remain part of that single literal.
  if (clauses.length !== 1) return;
  const values: string[] = [];
  for (const clause of clauses) {
    const match = /^(?:please\s+)?(?:set|fill)\s+(?:the\s+)?(.+?)\s+(?:to|with)\s+(.+?)\.?$/i.exec(clause);
    if (!match || normalize(match[1].replace(/\s+field$/i, '')) !== label) continue;
    const raw = match[2];
    const quoted = /^(?:"([^"\n]*)"|“([^”\n]*)”)$/.exec(raw);
    let value: string;
    if (quoted) value = quoted[1] ?? quoted[2];
    else {
      // Unquoted values support simple names/identifiers only. Punctuation,
      // workflow words, transformations, and references use normal generation.
      if (!/^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+){0,7}$/u.test(raw) || /\b(and|then|after|before|using|from|your|my|their|its|same|current|random|any|uppercase|lowercase|capitalized|blank|empty|nothing|whatever)\b/i.test(raw)) return;
      value = raw;
    }
    if (!value.length || value.length > 2000) return;
    if (field.inputType === 'date') {
      // Native date inputs have a defined ISO value format. Never guess locale,
      // relative dates, or normalize an impossible date into another month.
      if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return;
    }
    values.push(value);
  }
  return values.length === 1 ? values[0] : undefined;
}
