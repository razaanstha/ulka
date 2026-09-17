declare module "libfx/browser" {
  export function supportsJspi(): boolean;
  export interface FxTool {
    name: string; description: string; inputSchema: Record<string, unknown>;
    execute(input: unknown, context: { signal: AbortSignal }): Promise<unknown>;
  }
  export interface FxEvent { type: string; delta?: string }
  export interface FxTurn extends AsyncIterable<FxEvent> {
    result: Promise<{ stopReason: string; usage: unknown }>;
    cancel(): void;
  }
  export function createFxAgent(options: {
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    apiKey: string; model: string; wasm: string; instructions: string; tools: FxTool[];
    onEvent?: (event: { type: string; [key: string]: unknown }) => void;
  }): Promise<{ prompt(input: string, options?: { signal: AbortSignal }): FxTurn; close(): Promise<void> }>;
}
