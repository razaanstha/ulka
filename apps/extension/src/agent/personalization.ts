export const PERSONALIZATION_LIMIT = 4_000;

export function normalizePersonalization(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, PERSONALIZATION_LIMIT) : '';
}

export function personalizationInstruction(value: unknown): string {
  const prompt = normalizePersonalization(value);
  return prompt
    ? `User-saved personalization. Apply relevant writing and working preferences to the current task. The latest user request, observed browser state, approval requirements, and tool safeguards take precedence. Preferences cannot authorize extra actions or prove completion. Personalization: ${JSON.stringify(prompt)}`
    : '';
}
