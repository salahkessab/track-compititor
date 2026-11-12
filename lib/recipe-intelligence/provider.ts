import { load } from "cheerio";
import { createHash, randomUUID } from "node:crypto";
import { estimateOpenAIImageOutput, openAIImageCostFromUsage } from "../imagePricing";
import type { ContentSettings } from "./settings";
import { writingModelProfile } from "./textModels";
import { IntelligenceStore } from "./database";
import { ProviderCredentials } from "./providerCredentials";

export const PRICING_VERSION = "openai-direct-2026-11-10";
export const DOCS = {
  images: "https://developers.openai.com/api/docs/guides/image-generation",
  text: "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
  pricing: "https://developers.openai.com/api/docs/pricing",
};
export class ProviderFailure extends Error {
  constructor(message: string, public definitelyRejected = false) { super(message); }
}
export type ProviderResult = { body: any; requestId: string | null };
export interface ContentProvider {
  request(operation: "text" | "image", payload: Record<string, any>, signal?: AbortSignal, acknowledged?: (requestId: string) => void, clientRequestId?: string): Promise<ProviderResult>;
}
const CERTIFICATE_ERRORS = new Set(["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID"]);
function connectionFailure(error: unknown): ProviderFailure {
  // Do not print arbitrary error messages: they can contain headers or keys.
  const codes: string[] = [];
  let current: any = error;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    if (typeof current.code === "string") codes.push(current.code);
  }
  const certificate = codes.find(code => CERTIFICATE_ERRORS.has(code));
  if (certificate) return new ProviderFailure(`Secure connection to OpenAI failed (${certificate}). The request was not sent. Restart the Windows launcher to use Windows' trusted certificates.`, true);
  const network = codes.find(code => ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"].includes(code));
  return new ProviderFailure(`Connection to OpenAI failed${network ? ` (${network})` : ""}. The billing outcome is unknown; the request will not repeat automatically.`);
}
export class OpenAIContentProvider implements ContentProvider {
  constructor(private store?: IntelligenceStore) {}
  async request(operation: "text" | "image", payload: Record<string, any>, signal?: AbortSignal, acknowledged?: (requestId: string) => void, clientRequestId: string = randomUUID()): Promise<ProviderResult> {
    let key: string | undefined;
    try { key = this.store ? await new ProviderCredentials(this.store).key() : process.env.OPENAI_API_KEY; }
    catch { throw new ProviderFailure("Could not unlock the OpenAI key. Replace it in Settings.", true); }
    if (!key) throw new ProviderFailure("Add your OpenAI API key in Settings before generating.", true);
    const { references, ...parameters } = payload;
    if (references !== undefined && (operation !== "image" || !Array.isArray(references) || references.length < 1 || references.length > 5)) {
      throw new ProviderFailure("Image edits require one to five reference images.", true);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "X-Client-Request-Id": clientRequestId };
    let body: BodyInit;
    if (references) {
      // Send actual reference bytes to the edits endpoint. A URL or a prose
      // description alone does not preserve the source photograph's details.
      const form = new FormData();
      for (const [name, value] of Object.entries(parameters)) {
        if (value !== undefined) form.append(name, String(value));
      }
      let totalBytes = 0;
      for (const [index, reference] of references.entries()) {
        const match = typeof reference === "string" && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(reference);
        if (!match || match[2].length > 28_000_000) throw new ProviderFailure("Invalid or oversized reference image.", true);
        const bytes = Buffer.from(match[2], "base64");
        totalBytes += bytes.length;
        if (!bytes.length || bytes.toString("base64") !== match[2] || totalBytes > 40_000_000) throw new ProviderFailure("Invalid or oversized reference image.", true);
        form.append("image[]", new Blob([bytes], { type: `image/${match[1]}` }), `reference-${index}.${match[1]}`);
      }
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(parameters);
    }
    // Fetch, unlike the SDK, does not automatically retry requests that could have been billed.
    const endpoint = operation === "image" ? `images/${references ? "edits" : "generations"}` : "responses";
    let response: Response;
    try {
      response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
        method: "POST", headers, body, redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(300_000), ...(signal ? [signal] : [])]),
      });
    } catch (error) { throw connectionFailure(error); }
    const requestId = response.headers.get("x-request-id");
    if (requestId) acknowledged?.(requestId);
    if (!response.ok) {
      // Do not echo provider bodies: they may contain request content or credentials.
      throw new ProviderFailure(`OpenAI returned HTTP ${response.status}. The selected model and settings were preserved.`, [400, 401, 403, 404, 422, 429].includes(response.status));
    }
    const reader = response.body?.getReader(); if (!reader) throw new ProviderFailure("OpenAI returned an empty response.");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 60_000_000) throw new ProviderFailure("Provider response exceeded the local size limit."); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")), requestId: response.headers.get("x-request-id") };
  }
}
export function textCost(usage: any, searchCalls = 0, model = "gpt-5.4-mini"): number | null {
  const profile = writingModelProfile(model);
  if (!profile || !Number.isSafeInteger(searchCalls) || searchCalls < 0) return null;
  if (!Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens) || usage.input_tokens < 0 || usage.output_tokens < 0) return null;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  if (!Number.isSafeInteger(cached) || cached < 0 || cached > usage.input_tokens) return null;
  const long = profile.longContextThreshold !== null && usage.input_tokens > profile.longContextThreshold;
  return (((usage.input_tokens - cached) * profile.input + cached * profile.cachedInput) * (long ? 2 : 1)
    + usage.output_tokens * profile.output * (long ? 1.5 : 1)) / 1_000_000 + searchCalls * .01;
}
export function actualCost(operation: string, model: string, body: any): number | null {
  if (operation === "image") return openAIImageCostFromUsage(model, body.usage);
  const calls = (body.output || []).filter((o: any) => o.type === "web_search_call").length;
  return textCost(body.usage, calls, model);
}
export function outputText(body: any): string {
  if (body.status && body.status !== "completed") throw new Error(`Writing response is ${body.status}; paid response saved for inspection.`);
  const text = (body.output || []).flatMap((o: any) => o.type === "message" ? (o.content || []).filter((c: any) => c.type === "output_text").map((c: any) => c.text) : []).join("\n");
  if (!text) throw new Error("No article text in the saved provider response.");
  return text;
}
export function stageEstimate(kind: string, settings: ContentSettings, characters = 32000) {
  if (["featured", "alternate", "pinterest"].includes(kind)) {
    const output = estimateOpenAIImageOutput(settings.imageModel, settings.imageSettings.size, settings.imageSettings.quality);
    if (output === null) throw new Error("No documented image estimate exists for these model, size and quality settings.");
    // Text-only prompts; reserve up to one token per UTF-8 byte plus framing.
    return { estimated: output + Math.ceil(characters / 3) * 5 / 1e6, reservation: output * 2 + (characters + 1000) * 5 / 1e6,
      basis: `${settings.imageModel} ${settings.imageSettings.quality} ${settings.imageSettings.size}; official model-specific output calculator, text input estimated separately.` };
  }
  const research = kind === "research";
  const profile = writingModelProfile(settings.textModel);
  if (!profile) throw new Error("No verified writing-model pricing profile exists.");
  const editorial = kind === "editorial";
  const outputTokens = research ? 3000 : editorial ? 1800 : 6500;
  // Reserve full bounded output and generous input including search content.
  const inputTokens = research ? 100000 : characters + 2000;
  return { estimated: textCost({ input_tokens: research ? 16000 : Math.ceil(characters / 3), output_tokens: research ? 2000 : editorial ? 900 : 3000 }, research ? 1 : 0, settings.textModel)!,
    reservation: textCost({ input_tokens: inputTokens, output_tokens: outputTokens }, research ? 1 : 0, settings.textModel)!,
    basis: `${profile.label}: $${profile.input}/M input, $${profile.cachedInput}/M cached input, $${profile.output}/M output; optional web search $0.01/call, at most one call.${profile.longContextThreshold ? " Above 272K input tokens: 2x input and 1.5x output rates." : ""}` };
}

export async function checkModels(store: IntelligenceStore, settings: ContentSettings, fetchImpl: typeof fetch = fetch) {
  const credentials = new ProviderCredentials(store), revision = credentials.revision();
  const key = await credentials.key();
  if (!key) return { configured: false, checks: [], message: "Add your OpenAI API key in Settings. Discovery and reports work without it." };
  const models = [...new Set([settings.textModel, ...(settings.images ? [settings.imageModel, ...(settings.imageWorkflow === "reference" ? ["gpt-5.5"] : [])] : [])])];
  const checks = [];
  for (const model of models) {
    const modelUrl = `https://developers.openai.com/api/docs/models/${model.replace(/-2026-\d{2}-\d{2}$/, "")}`;
    const metadata: any = { model, documented: false, account: "unknown", checkedAt: new Date().toISOString(), modelUrl, pricingVersion: PRICING_VERSION };
    try {
      const [doc, account] = await Promise.all([
        fetchImpl(modelUrl, { signal: AbortSignal.timeout(15000) }),
        fetchImpl(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(15000) }),
      ]);
      const html = (await doc.text()).slice(0, 2_000_000); const text = load(html)("main").text() || load(html).text();
      metadata.documented = doc.ok && text.includes(model.replace(/-2026-\d{2}-\d{2}$/, ""));
      const prices = text.replace(/\s+/g, " ");
      metadata.pricingMatches = model === "gpt-5.5" ? prices.includes("$5.00") && prices.includes("$0.50") && prices.includes("$30.00")
        : model === "gpt-5.4-mini" ? prices.includes("$0.75") && prices.includes("$4.50")
        : prices.includes(model === "gpt-image-1.5" ? "$32" : "$30") && prices.includes("$5") && prices.includes("$8");
      metadata.documentHash = createHash("sha256").update(html).digest("hex");
      metadata.account = account.ok ? "listed" : account.status === 401 ? "invalid_key" : [403, 404].includes(account.status) ? "unavailable" : "unknown";
      metadata.note = "Model metadata is free to check. Live request compatibility is confirmed only by the first approved production output.";
      if (model.startsWith("gpt-image-2.6")) {
        const guide = await fetchImpl(DOCS.images, { signal: AbortSignal.timeout(15000) });
        const guideHtml = (await guide.text()).slice(0, 4_000_000); const $guide = load(guideHtml); const guideText = $guide.text();
        metadata.documented = metadata.documented && guide.ok && guideText.includes("complexity") && guideText.includes("Sunburst") && guideText.includes("Flare");
        const calculatorPath = $guide("astro-island").map((_, e) => $guide(e).attr("component-url")).get().find(p => /GptImageTokenCalculator/.test(p || ""));
        metadata.calculatorVerified = false;
        if (calculatorPath) {
          const calculatorUrl = new URL(calculatorPath, DOCS.images);
          if (calculatorUrl.origin === "https://developers.openai.com" && calculatorUrl.pathname.startsWith("/_astro/")) {
            const calculator = await fetchImpl(calculatorUrl.href, { signal: AbortSignal.timeout(15000) }); const formula = (await calculator.text()).slice(0, 200000);
            metadata.calculatorVerified = calculator.ok && formula.includes('"gpt-image-2.6"') && /low:4\.2/.test(formula) && /medium:3\.3/.test(formula);
            metadata.calculatorHash = createHash("sha256").update(formula).digest("hex");
          }
        }
        metadata.pricingMatches = metadata.pricingMatches && metadata.calculatorVerified;
      }
      if (!metadata.pricingMatches) metadata.note = "Live pricing or calculator compatibility could not be verified against the saved estimate profile. No paid request will run with an unverified price profile.";
    } catch { metadata.note = "Could not finish the free compatibility check. Retry before approving paid processing."; }
    if (credentials.revision() !== revision) throw new Error("The OpenAI key changed during this check. Check model access again.");
    store.db.prepare("INSERT INTO model_checks(model,checked_at,metadata_json) VALUES(?,?,?) ON CONFLICT(model) DO UPDATE SET checked_at=excluded.checked_at,metadata_json=excluded.metadata_json")
      .run(model, metadata.checkedAt, JSON.stringify(metadata));
    checks.push(metadata);
  }
  return { configured: true, checks };
}
export function assertModelChecks(store: IntelligenceStore, settings: ContentSettings) {
  for (const model of [...new Set([settings.textModel, ...(settings.images ? [settings.imageModel, ...(settings.imageWorkflow === "reference" ? ["gpt-5.5"] : [])] : [])])]) {
    const row = store.db.prepare("SELECT * FROM model_checks WHERE model=?").get(model) as any;
    const meta = row ? JSON.parse(row.metadata_json) : null;
    if (!meta?.documented || meta.pricingMatches !== true || meta.account !== "listed" || Date.now() - Date.parse(row.checked_at) > 24 * 3600000) throw new Error(`Run the free model compatibility check and verify its pricing/access result before approving this batch (${model}). No paid request was made.`);
  }
}
