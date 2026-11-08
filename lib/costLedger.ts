import { AsyncLocalStorage } from "node:async_hooks";
import { estimateTextCost, PRICING } from "./config";
import { estimateOpenAIImageOutput, openAIImageCostFromUsage } from "./imagePricing";
import type { OpenAIImageResult } from "./openaiImages";
import type { OpenAIImageSettings } from "./openaiImageSettings";

type Ledger = { text: number; image: number | null; search: number; imageComplete: boolean; incomplete: boolean };
const context = new AsyncLocalStorage<Ledger>();
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// One ledger per request, including overlapping caption and image calls.
export function withCostLedger<T>(run: () => T): T {
  return context.run({ text: 0, image: null, search: 0, imageComplete: false, incomplete: false }, run);
}
export function markCostIncomplete() {
  const ledger = context.getStore();
  if (ledger) ledger.incomplete = true;
}
export function recordTextUsage(model: string, raw: unknown, source: "chat" | "responses" = "chat") {
  const ledger = context.getStore();
  if (!ledger) return;
  const usage = raw as any;
  const input = source === "chat" ? usage?.prompt_tokens : usage?.input_tokens;
  const output = source === "chat" ? usage?.completion_tokens : usage?.output_tokens;
  const cached = source === "chat" ? usage?.prompt_tokens_details?.cached_tokens : usage?.input_tokens_details?.cached_tokens;
  if (!PRICING.text[model] || !isCount(input) || !isCount(output) || (cached !== undefined && (!isCount(cached) || cached > input))) {
    ledger.incomplete = true;
    return;
  }
  ledger.text += estimateTextCost(model, { in: input, out: output, cached: cached ?? 0 });
}
export function recordSearchUsage(model: string, output: unknown) {
  const ledger = context.getStore();
  if (!ledger) return;
  if (!Array.isArray(output)) { ledger.incomplete = true; return; }
  for (const item of output) {
    if (item?.type !== "web_search_call") continue;
    if (!item.action?.type) { ledger.incomplete = true; continue; }
    if (item.action.type === "search") ledger.search += model === "gpt-4.1-mini" ? 0.025 : 0.01;
  }
}
export function recordOpenAIImage(model: string, settings: OpenAIImageSettings, result: OpenAIImageResult) {
  const ledger = context.getStore();
  if (!ledger) return;
  const reported = openAIImageCostFromUsage(model, result.usage);
  if (reported !== null) {
    ledger.image = reported;
    ledger.imageComplete = true;
  } else {
    // Preserve a useful output-only estimate when OpenAI omits usage.
    ledger.image = estimateOpenAIImageOutput(model, result.size || settings.size, result.quality || settings.quality);
    ledger.incomplete = true;
  }
  // The docs charge for partial previews; whether the returned output_tokens
  // already include them is not specified. Do not count them twice.
  if (result.partialImages > 0) ledger.incomplete = true;
}
export function costSummary(imageModel?: string) {
  const ledger = context.getStore();
  if (!ledger) throw new Error("Cost ledger is unavailable");
  if (imageModel && !imageModel.startsWith("gpt-image-")) {
    const flat = PRICING.fal[imageModel];
    ledger.image = typeof flat === "number" ? flat : null;
    ledger.imageComplete = typeof flat === "number";
    if (!ledger.imageComplete) ledger.incomplete = true;
  }
  if (imageModel && ledger.image === null) ledger.incomplete = true;
  return {
    cost: ledger.text + ledger.search + (ledger.image ?? 0),
    textCost: ledger.text,
    imageCost: ledger.image,
    searchCost: ledger.search,
    costIncomplete: ledger.incomplete,
    imageCostIncluded: ledger.imageComplete,
  };
}
