export type CostSource = "api" | "estimated" | "unavailable";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Vendor-reported USD, if the API returned a dollar amount. */
  costUsd?: number;
  tokenSource: CostSource;
}

export interface UsageTotals extends TokenUsage {
  costUsd: number;
  costSource: CostSource;
  calls: number;
}

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type PricingTable = Record<string, ModelPrice>;

export const EMPTY_USAGE: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  tokenSource: "unavailable",
  costSource: "unavailable",
  calls: 0,
};

export function emptyUsage(): UsageTotals {
  return { ...EMPTY_USAGE };
}

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheCreationTokens:
      (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0),
    costUsd: roundUsd(a.costUsd + b.costUsd),
    tokenSource: mergeSource(a.tokenSource, b.tokenSource),
    costSource: mergeSource(a.costSource, b.costSource),
    calls: a.calls + b.calls,
  };
}

function mergeSource(a: CostSource, b: CostSource): CostSource {
  if (a === "api" || b === "api") return "api";
  if (a === "estimated" || b === "estimated") return "estimated";
  return "unavailable";
}

export function roundUsd(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function estimateCostUsd(
  usage: TokenUsage,
  modelId: string,
  pricing: PricingTable,
): { costUsd: number; costSource: CostSource } {
  if (typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)) {
    return { costUsd: roundUsd(usage.costUsd), costSource: "api" };
  }
  if (usage.tokenSource === "unavailable") {
    return { costUsd: 0, costSource: "unavailable" };
  }
  const price = lookupPrice(modelId, pricing);
  if (!price) {
    return { costUsd: 0, costSource: "unavailable" };
  }
  const input =
    usage.inputTokens +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) * 0.1;
  const usd =
    (input / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return { costUsd: roundUsd(usd), costSource: "estimated" };
}

export function lookupPrice(
  modelId: string,
  pricing: PricingTable,
): ModelPrice | undefined {
  const id = modelId.trim().toLowerCase();
  if (pricing[id]) return pricing[id];
  let best: { key: string; price: ModelPrice } | undefined;
  for (const [key, price] of Object.entries(pricing)) {
    if (key === "default") continue;
    const k = key.toLowerCase();
    if (id.startsWith(k) || id.includes(k)) {
      if (!best || k.length > best.key.length) best = { key: k, price };
    }
  }
  return best?.price ?? pricing.default;
}

export function toTotals(
  usage: TokenUsage,
  modelId: string,
  pricing: PricingTable,
): UsageTotals {
  const { costUsd, costSource } = estimateCostUsd(usage, modelId, pricing);
  return {
    ...usage,
    costUsd,
    costSource,
    calls: 1,
  };
}

export function parseUsageFromUnknown(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const nested =
    asRecord(rec.usage) ??
    asRecord(rec.tokenUsage) ??
    asRecord(rec.tokens) ??
    rec;
  const input = firstNumber(nested, [
    "input_tokens",
    "inputTokens",
    "prompt_tokens",
    "promptTokens",
  ]);
  const output = firstNumber(nested, [
    "output_tokens",
    "outputTokens",
    "completion_tokens",
    "completionTokens",
  ]);
  const cost = firstNumber(nested, ["cost_usd", "costUsd", "total_cost"]);
  if (input == null && output == null && cost == null) return undefined;
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    cacheReadTokens: firstNumber(nested, [
      "cache_read_input_tokens",
      "cacheReadTokens",
    ]),
    cacheCreationTokens: firstNumber(nested, [
      "cache_creation_input_tokens",
      "cacheCreationTokens",
    ]),
    costUsd: cost,
    tokenSource: "api",
  };
}

export function estimateTokensFromText(
  inputText: string,
  outputText: string,
): TokenUsage {
  return {
    inputTokens: Math.ceil(inputText.length / 4),
    outputTokens: Math.ceil(outputText.length / 4),
    tokenSource: "estimated",
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function firstNumber(
  rec: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const n = rec[key];
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return undefined;
}
