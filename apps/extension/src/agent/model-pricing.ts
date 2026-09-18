export const PRICING_URL = 'https://ai-gateway.vercel.sh/v1/models';
export interface TokenPrice { input: number; output: number }
export type ModelPrices = Record<string, TokenPrice>;

// Gateway's public catalog expresses prices in USD per token, not per million.
export function parseModelPrices(value: unknown): ModelPrices {
  const prices: ModelPrices = {};
  const data = (value as { data?: unknown })?.data;
  if (!Array.isArray(data)) return prices;
  const price = (value: unknown) => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  for (const row of data) {
    if (!row || typeof row.id !== 'string') continue;
    const input = price(row.pricing?.input), output = price(row.pricing?.output);
    if (input !== undefined && output !== undefined) prices[row.id] = { input, output };
  }
  return prices;
}

let cached: { at: number; prices: ModelPrices } | undefined;
export async function loadModelPrices(): Promise<ModelPrices> {
  if (cached && Date.now() - cached.at < 3_600_000) return cached.prices;
  try {
    const response = await fetch(PRICING_URL, { signal: AbortSignal.timeout(3000), credentials: 'omit' });
    if (!response.ok) return {};
    const prices = parseModelPrices(await response.json());
    if (Object.keys(prices).length) cached = { at: Date.now(), prices };
    return prices;
  } catch { return {}; }
}
