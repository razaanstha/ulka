// Keep response content first; append verification status using real line breaks.
export function preservePartialResponse(partial: string, reason: string): string {
  const text = partial.trim();
  if (!text) return reason;
  return `${text}

---

**Incomplete response. Completion not verified.**

${reason}`;
}
