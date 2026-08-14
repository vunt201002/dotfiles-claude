/**
 * Per-model pricing tables.
 *
 * Prices are USD per million tokens as of `as_of`. Update quarterly.
 * Link to provider pricing pages:
 *   - Anthropic: https://www.anthropic.com/pricing#api
 *   - OpenAI: https://openai.com/api/pricing/
 *   - Google AI: https://ai.google.dev/pricing
 *
 * When a model isn't in the table, estimateCost returns 0 with a console warning.
 * Prefer adding a new row to the table over guessing.
 */

export interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  as_of: string; // YYYY-MM
}

export const PRICING: Record<string, ModelPricing> = {
  // Claude (Anthropic). Keys are the model id as it appears in a transcript,
  // so a dated id needs its own row — lookup is exact and a near-miss reads as
  // "no price on file", not as the undated row.
  'claude-fable-5':     { input_per_mtok: 10.00, output_per_mtok: 50.00, as_of: '2026-08' },
  'claude-opus-5':      { input_per_mtok: 5.00,  output_per_mtok: 25.00, as_of: '2026-08' },
  'claude-opus-4-8':    { input_per_mtok: 5.00,  output_per_mtok: 25.00, as_of: '2026-08' },
  'claude-opus-4-7':    { input_per_mtok: 5.00,  output_per_mtok: 25.00, as_of: '2026-08' },
  'claude-sonnet-5':    { input_per_mtok: 2.00,  output_per_mtok: 10.00, as_of: '2026-08' },
  'claude-sonnet-4-6':  { input_per_mtok: 3.00,  output_per_mtok: 15.00, as_of: '2026-08' },
  'claude-haiku-4-5':   { input_per_mtok: 1.00,  output_per_mtok: 5.00,  as_of: '2026-08' },
  'claude-haiku-4-5-20251001': { input_per_mtok: 1.00, output_per_mtok: 5.00, as_of: '2026-08' },

  // OpenAI (GPT + o-series)
  'gpt-5.4':            { input_per_mtok: 2.50,  output_per_mtok: 10.00, as_of: '2026-04' },
  'gpt-5.4-mini':       { input_per_mtok: 0.60,  output_per_mtok: 2.40,  as_of: '2026-04' },
  'o3':                 { input_per_mtok: 15.00, output_per_mtok: 60.00, as_of: '2026-04' },
  'o4-mini':            { input_per_mtok: 1.10,  output_per_mtok: 4.40,  as_of: '2026-04' },

  // Google
  'gemini-2.5-pro':     { input_per_mtok: 1.25,  output_per_mtok: 5.00,  as_of: '2026-04' },
  'gemini-2.5-flash':   { input_per_mtok: 0.30,  output_per_mtok: 1.20,  as_of: '2026-04' },
};

const WARNED = new Set<string>();

export function estimateCostUsd(
  tokens: { input: number; output: number; cached?: number; cacheWrite?: number; cacheWrite1h?: number },
  model: string | undefined
): number {
  if (!model) return 0;
  const row = PRICING[model];
  if (!row) {
    if (!WARNED.has(model)) {
      WARNED.add(model);
      console.error(`WARN: no pricing for model ${model}; returning 0. Add it to test/helpers/pricing.ts.`);
    }
    return 0;
  }
  // Anthropic and OpenAI report cached tokens as a separate (disjoint) field from
  // uncached input tokens. tokens.input is already the uncached portion; tokens.cached
  // is the cache-read count billed at 10% of the regular input rate. Do NOT subtract
  // cached from input — they don't overlap.
  const cachedDiscount = 0.1;
  // Writing to the cache costs MORE than plain input, and the two TTLs are
  // priced apart: 1.25x at 5 minutes, 2x at an hour. Charging every write at
  // the 5-minute rate understates an hour-TTL session by 37.5% of its write
  // cost, and long agent sessions run on the hour TTL, where cache writes are
  // the bulk of input. Both are optional: a caller with no split passes
  // `cacheWrite` alone and gets exactly the old number.
  const cacheWrite5mPremium = 1.25;
  const cacheWrite1hPremium = 2;
  const inputCost = tokens.input * row.input_per_mtok / 1_000_000;
  const cachedCost = (tokens.cached ?? 0) * row.input_per_mtok * cachedDiscount / 1_000_000;
  const cacheWriteCost =
    ((tokens.cacheWrite ?? 0) * cacheWrite5mPremium + (tokens.cacheWrite1h ?? 0) * cacheWrite1hPremium)
    * row.input_per_mtok / 1_000_000;
  const outputCost = tokens.output * row.output_per_mtok / 1_000_000;
  return +(inputCost + cachedCost + cacheWriteCost + outputCost).toFixed(6);
}
