import type { OpenAIImageSettings } from "./openaiImageSettings";

// OpenAI's image-generation calculator, checked 2026-11-01. These are output
// token estimates, not fixed prices: model behavior and rates can change.
// https://developers.openai.com/api/docs/guides/image-generation#gpt-image-25-and-gpt-image-2-output-tokens
const TOKENS_25 = {
  "1024x1024": { low: 196, medium: 439, high: 1756, xhigh: 3122, max: 7024 },
  "1024x1536": { low: 158, medium: 343, high: 1372, xhigh: 2459, max: 5488 },
  "1536x1024": { low: 158, medium: 343, high: 1372, xhigh: 2459, max: 5488 },
} as const;
const TOKENS_2 = {
  "1024x1024": { low: 196, medium: 1756, high: 7024 },
  "1024x1536": { low: 158, medium: 1372, high: 5488 },
  "1536x1024": { low: 158, medium: 1372, high: 5488 },
} as const;
const TOKENS_15 = {
  "1024x1024": { low: 272, medium: 1056, high: 4160 },
  "1024x1536": { low: 408, medium: 1584, high: 6240 },
  "1536x1024": { low: 400, medium: 1568, high: 6208 },
} as const;

export type ImageUsage = {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details: { text_tokens: number; image_tokens: number };
  output_tokens_details?: { image_tokens?: number };
};

function imageOutputRate(model: string): number | null {
  // https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst (2026-11-05)
  if (model === "gpt-image-2.6-sunburst" || model === "gpt-image-2.6-flare") return 30;
  if (model === "gpt-image-1.5") return 32;
  if (model === "gpt-image-2" || model.startsWith("gpt-image-2-2026-") || model.startsWith("gpt-image-2.5-")) return 30;
  return null;
}

export function estimateOpenAIImageOutput(model: string, size: string, quality: string): number | null {
  // The 2.6 calculator has its own low/medium multipliers. Never use the 2.5 table.
  // Official image-generation calculator checked 2026-11-10; actual usage can differ.
  if (/^gpt-image-2\.6-(sunburst|flare)$/.test(model)) {
    const [width, height] = size.split("x").map(Number);
    const edge = ({ low: 16, medium: 24, high: 48, xhigh: 64, max: 96 } as Record<string, number>)[quality];
    if (!edge || !width || !height || width % 16 || height % 16 || width * height < 655360 || width * height > 8294400 || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3) return null;
    const short = edge * Math.min(width, height) / Math.max(width, height);
    const floor = Math.floor(short);
    const rounded = short - floor === 0.5 ? floor + floor % 2 : Math.round(short);
    const base = Math.ceil(edge * rounded * (2_000_000 + width * height) / 4_000_000);
    const multiplier = quality === "low" ? 4.2 : quality === "medium" ? 3.3 : 1;
    return Math.round(base * multiplier) * 30 / 1_000_000;
  }
  const rates = imageOutputRate(model);
  if (rates === null || size === "auto" || quality === "auto") return null;
  const tables: Record<string, Record<string, number>> = model === "gpt-image-1.5"
    ? TOKENS_15 : model.startsWith("gpt-image-2.5-") ? TOKENS_25 : TOKENS_2;
  const tokens = tables[size]?.[quality];
  if (typeof tokens === "number") return tokens * rates / 1_000_000;
  // The same official calculator accepts additional supported native dimensions.
  if (model !== "gpt-image-1.5") {
    const [w, h] = size.split("x").map(Number);
    const edge = (model.startsWith("gpt-image-2.5-") ? { low: 16, medium: 24, high: 48, xhigh: 64, max: 96 } : { low: 16, medium: 48, high: 96 })[quality as "low" | "medium" | "high"];
    if (!edge || !w || !h || w % 16 || h % 16 || w * h < 655360 || w * h > 8294400 || Math.max(w, h) > 3840 || Math.max(w, h) / Math.min(w, h) > 3) return null;
    const short = edge * Math.min(w, h) / Math.max(w, h); const floor = Math.floor(short);
    const rounded = short - floor === .5 ? floor + floor % 2 : Math.round(short);
    return Math.ceil(edge * rounded * (2e6 + w * h) / 4e6) * rates / 1e6;
  }
  return null;
}

export function openAIOutputExamples(model: string, settings: OpenAIImageSettings): { low: number; high: number } | null {
  const low = estimateOpenAIImageOutput(model, settings.size, "low");
  const high = estimateOpenAIImageOutput(model, settings.size, model.startsWith("gpt-image-2.5-") ? "max" : "high");
  return low === null || high === null ? null : { low, high };
}

export function previewUnitCost(model: string): number | null {
  const rate = imageOutputRate(model);
  return rate === null ? null : 100 * rate / 1_000_000;
}

// An incomplete usage object must never be reported as a complete image cost.
export function openAIImageCostFromUsage(model: string, usage: unknown): number | null {
  const rate = imageOutputRate(model);
  if (rate === null || !usage || typeof usage !== "object") return null;
  const data = usage as Partial<ImageUsage>;
  const details = data.input_tokens_details;
  const nonnegativeInteger = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!nonnegativeInteger(data.input_tokens) || !nonnegativeInteger(data.output_tokens) ||
      !details || !nonnegativeInteger(details.text_tokens) || !nonnegativeInteger(details.image_tokens) ||
      details.text_tokens + details.image_tokens !== data.input_tokens) return null;
  const output = data.output_tokens_details?.image_tokens ?? data.output_tokens;
  if (!nonnegativeInteger(output) || output !== data.output_tokens) return null;
  return (details.text_tokens * 5 + details.image_tokens * 8 + output * rate) / 1_000_000;
}
