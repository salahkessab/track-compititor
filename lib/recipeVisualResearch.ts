import type { DesignSource } from "./recipeDesigns";

export type VisualCandidate = {
  id: string; sourceUrl: string; imageUrl: string; thumbnailUrl: string; caption: string;
  observedAt: string; publishedAt: string | null;
};

const PLATFORM_GUIDES = ["help.pinterest.com", "guide.pinterest.com", "create.pinterest.com", "developer.pinterest.com", "developers.pinterest.com"];
export function isPlatformGuidance(url: string): boolean {
  try { const host = new URL(url).hostname.toLowerCase(); return PLATFORM_GUIDES.some(domain => host === domain || host.endsWith(`.${domain}`)); }
  catch { return false; }
}
function isGenericGuide(url: string): boolean {
  try { return /\/(?:how-to|guides?|tutorials?|tips|best-practices)(?:\/|[-_]|$)/i.test(new URL(url).pathname); }
  catch { return true; }
}
function publicUrl(value: unknown): string | null {
  try {
    if (typeof value !== "string" || value.length > 2048) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    return url.href;
  } catch { return null; }
}
function stableId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `visual-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
/** Read only actual image_result items; captions and performance are never invented. */
export function parseVisualResults(output: unknown, observedAt = new Date().toISOString()): VisualCandidate[] {
  if (!Array.isArray(output)) return [];
  const found: VisualCandidate[] = [];
  const seen = new Set<string>();
  for (const call of output) {
    if (call?.type !== "web_search_call" || !Array.isArray(call.results)) continue;
    for (const result of call.results) {
      if (result?.type !== "image_result") continue;
      const sourceUrl = publicUrl(result.source_website_url);
      const imageUrl = publicUrl(result.image_url);
      const thumbnailUrl = publicUrl(result.thumbnail_url) || imageUrl;
      if (!sourceUrl || !imageUrl || !thumbnailUrl || isPlatformGuidance(sourceUrl) || isGenericGuide(sourceUrl) || seen.has(sourceUrl + imageUrl)) continue;
      seen.add(sourceUrl + imageUrl);
      const rawDate = result.published_at ?? result.publish_date;
      const publishedAt = typeof rawDate === "string" && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
      found.push({ id: stableId(sourceUrl + "\n" + imageUrl), sourceUrl, imageUrl, thumbnailUrl,
        caption: typeof result.caption === "string" ? result.caption.slice(0, 220) : "", observedAt, publishedAt });
    }
  }
  const rank = (v: VisualCandidate) => /(^|\.)pinterest\.[^/]+\/pin\//i.test(new URL(v.sourceUrl).hostname + new URL(v.sourceUrl).pathname) ? 0
    : /(^|\.)(facebook|instagram)\.com$/i.test(new URL(v.sourceUrl).hostname) ? 1 : 2;
  return found.sort((a,b) => rank(a) - rank(b)).slice(0, 8);
}
export function separatePlatformGuidance(sources: DesignSource[]): { sources: DesignSource[]; platformSources: DesignSource[] } {
  return { sources: sources.filter(s => !isPlatformGuidance(s.url)), platformSources: sources.filter(s => isPlatformGuidance(s.url)) };
}
