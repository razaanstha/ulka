import { streamText } from 'ai';

export type StructuredRequest = Parameters<typeof streamText>[0];
export type StructuredGenerator = (input: StructuredRequest) => Promise<{
  output: unknown; usage?: unknown; totalUsage?: unknown;
}>;

// Use the same Gateway streaming transport as FX. Consume the entire response
// before exposing schema-validated output; partial JSON must never drive actions.
export const generateStructuredText: StructuredGenerator = async input => {
  input.abortSignal?.throwIfAborted();
  let streamError: unknown;
  const result = streamText({ ...input, onError: ({ error }) => { streamError = error; } });
  try {
    const [output, totalUsage] = await Promise.all([result.output, result.totalUsage]);
    input.abortSignal?.throwIfAborted();
    if (streamError !== undefined) throw streamError;
    return { output, totalUsage };
  } catch (error) {
    input.abortSignal?.throwIfAborted();
    // The SDK otherwise replaces transport errors with NoOutputGeneratedError.
    throw streamError ?? error;
  }
};
