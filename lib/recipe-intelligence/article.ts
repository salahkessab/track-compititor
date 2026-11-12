import { load } from "cheerio";
import { normalizeUrl, sameSite, sourceUrl } from "./urls";
import { extractHtmlRecipe } from "./html-recipe";
import { recipeContext, sourceReading, type SourceReading, type SupportingEvidence } from "./recipe-context";

export type PublicationDate = { raw: string; precision: "date" | "instant" | "local"; date: string; utc?: string; timezone?: string };
export type DateEvidence = { kind: "recipe" | "article" | "metadata" | "feed" | "modified"; value: string; parsed: PublicationDate | null };
export type RecipeSnapshot = {
  url: string; title: string; ingredients: string[]; instructions: string[];
  yield: string; prepTime: string; cookTime: string; totalTime: string;
  description: string; imageDescription: string; tips: string[]; storage: string[]; retrievedAt: string;
  extractionMethod?: "html_sections"; sourceNotes?: string[];
  evidenceVersion?: 1; supportingEvidence?: SupportingEvidence[];
  sourceReading?: SourceReading;
  displayTimes?: Partial<Record<"prepTime" | "cookTime" | "totalTime", string>>;
};
export type ArticleEvidence = {
  canonical: string; title: string; recipe: RecipeSnapshot | null; dates: DateEvidence[];
  status: "verified" | "uncertain" | "not_recipe"; publication: PublicationDate | null; reason: string;
};

export function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function parsePublication(value: unknown): PublicationDate | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const raw = value.trim();
  if (validDay(raw)) return { raw, precision: "date", date: raw };
  const iso = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(raw);
  if (iso && !validDay(iso[1])) return null;
  if (iso && !iso[2]) return { raw, precision: "local", date: iso[1] };
  // RFC 2822 is accepted for feed evidence only when an explicit offset/GMT is present.
  if (!iso && !/\b(?:GMT|UTC)|[+-]\d{4}$/.test(raw)) return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return { raw, precision: "instant", date: new Date(time).toISOString().slice(0, 10), utc: new Date(time).toISOString(), timezone: iso?.[2] || raw.match(/(?:GMT|UTC|[+-]\d{4})$/)?.[0] };
}
export function dayInZone(value: PublicationDate, zone: string): string {
  if (value.precision !== "instant") return value.date;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value.utc!));
  const get = (key: string) => p.find(v => v.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const plain = (v: unknown, max = 12000): string => typeof v === "string" ? load(v).text().replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";
const array = (v: any) => v == null ? [] : Array.isArray(v) ? v : [v];
const types = (v: any) => array(v?.["@type"]).map(String);
const isType = (v: any, t: string) => types(v).some((x: string) => x.split(/[\/#]/).pop() === t);

function instructions(v: any, depth = 0): string[] {
  if (depth > 8) return [];
  return array(v).flatMap((x: any): string[] => {
    if (typeof x === "string") return x.split(/\r?\n/).map(s => plain(s)).filter(Boolean);
    if (!x || typeof x !== "object") return [];
    if (x.itemListElement) return instructions(x.itemListElement, depth + 1);
    const text = plain(x.text), name = plain(x.name);
    if (!text) return [name].filter(Boolean);
    if (!name || /^(?:step\s*)?\d+[.:]?$/i.test(name) || text.toLowerCase().startsWith(name.toLowerCase())) return [text];
    // Some recipe cards split a leading verb ("Bake") from a fragment
    // ("for 45 minutes") between HowToStep.name and HowToStep.text.
    // Keep both fields so the essential cooking action cannot disappear.
    return [/^[a-z]/.test(text) && /^(?:the|a|an|for|until|with|in|on|to)\b/i.test(text)
      ? `${name.replace(/[.:]$/, "")} ${text}` : `${name}: ${text}`];
  }).slice(0, 200);
}
export function completeRecipe(recipe: RecipeSnapshot | null): boolean {
  // Optional duration and yield fields stay absent if the source did not state them.
  return !!recipe && !!recipe.title && recipe.ingredients.length > 0 && recipe.instructions.length > 0
    && recipe.ingredients.every(x => !!x.trim()) && recipe.instructions.every(x => !!x.trim());
}

export function extractArticle(html: string, url: string, feedDates: string[] = [], previous?: PublicationDate | null): ArticleEvidence {
  if (Buffer.byteLength(html) > 5_000_000) throw new Error("Article exceeds the 5 MB parsing limit.");
  const $ = load(html); const objects: any[] = [];
  const visit = (value: any, depth = 0) => {
    if (depth > 16 || objects.length > 2000 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return; }
    objects.push(value);
    // Traverse graph and embedded main entities, not arbitrary page content strings.
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) if (value[key]) visit(value[key], depth + 1);
  };
  $('script[type="application/ld+json"]').slice(0, 40).each((_, el) => {
    const text = $(el).text(); if (text.length > 1_000_000) return;
    try { visit(JSON.parse(text)); } catch { /* Malformed blocks are evidence gaps, not instructions. */ }
  });
  const canonicalHint = sourceUrl($('link[rel="canonical"]').first().attr("href") || "", url);
  const canonical = canonicalHint && sameSite(url, canonicalHint) ? normalizeUrl(canonicalHint) : normalizeUrl(url);
  const relevant = (o: any) => {
    const identity = typeof o.url === "string" ? o.url : typeof o.mainEntityOfPage === "string" ? o.mainEntityOfPage : o.mainEntityOfPage?.["@id"] || o["@id"];
    if (!identity) return true;
    try { return [normalizeUrl(url), canonical].includes(normalizeUrl(new URL(identity, url).href)); } catch { return false; }
  };
  const recipes = objects.filter(o => isType(o, "Recipe") && relevant(o));
  const r = recipes.length === 1 ? recipes[0] : null;
  const dates: DateEvidence[] = [];
  const add = (kind: DateEvidence["kind"], value: any) => { if (typeof value === "string" && value.length <= 100) dates.push({ kind, value, parsed: parsePublication(value) }); };
  recipes.forEach(o => add("recipe", o.datePublished));
  objects.filter(o => types(o).some((t: string) => /(?:^|[/#])(?:Article|BlogPosting|NewsArticle)$/.test(t)) && relevant(o)).forEach(o => add("article", o.datePublished));
  $('meta[property="article:published_time"], meta[itemprop="datePublished"], meta[name="datePublished"], time[itemprop="datePublished"]').each((_, e) => add("metadata", $(e).attr("content") || $(e).attr("datetime")));
  recipes.forEach(o => add("modified", o.dateModified));
  $('meta[property="article:modified_time"]').each((_, e) => add("modified", $(e).attr("content")));
  feedDates.slice(0, 30).forEach(v => add("feed", v));
  const htmlRecipe = recipes.length === 0 ? extractHtmlRecipe($, canonical) : { recipe: null };
  const recipe: RecipeSnapshot | null = r ? {
    url: canonical, title: plain(r.name, 500), ingredients: array(r.recipeIngredient).map((s: any) => plain(s, 2000)).filter(Boolean).slice(0, 200),
    instructions: instructions(r.recipeInstructions), yield: [...new Set<string>(array(r.recipeYield).map((s: any) => plain(s, 200)).filter(Boolean))]
      .filter((value, _, values) => !/^\d+$/.test(value) || !values.some(other => new RegExp(`^${value} servings?$`, "i").test(other))).join("; "),
    prepTime: plain(r.prepTime, 100), cookTime: plain(r.cookTime, 100), totalTime: plain(r.totalTime, 100),
    description: plain(r.description, 3000), imageDescription: plain(r.image?.caption, 1000), tips: [], storage: [], retrievedAt: new Date().toISOString(),
  } : htmlRecipe.recipe;
  if (recipe) { recipe.evidenceVersion = 1; recipe.supportingEvidence = recipeContext($); const reading = sourceReading($); if (reading) recipe.sourceReading = reading; }
  const result: ArticleEvidence = { canonical, title: recipe?.title || plain($("h1").first().text() || $("title").text(), 500), recipe, dates, status: "uncertain", publication: null, reason: "Original publication date is missing or has no explicit timezone." };
  if (!recipe) { result.status = recipes.length > 1 || htmlRecipe.reason ? "uncertain" : "not_recipe"; result.reason = recipes.length > 1 ? "Multiple recipe entities require review." : htmlRecipe.reason || "No relevant Recipe structured data or unambiguous labelled ingredient and method sections were found."; return result; }
  const articleDates = dates.filter(d => ["recipe", "article", "metadata"].includes(d.kind));
  const usable = articleDates.filter(d => d.parsed && d.parsed.precision !== "local");
  if (!usable.length) return result;
  const chosen = usable[0].parsed!;
  const conflicting = usable.some(d => {
    const other = d.parsed!;
    // Compare each declared local calendar date, preserving date-only precision.
    if (other.precision === "instant" && chosen.precision === "instant" && other.utc === chosen.utc) return false;
    return other.raw.slice(0, 10) !== chosen.raw.slice(0, 10);
  });
  if (conflicting || articleDates.some(d => !d.parsed || d.parsed.precision === "local")) {
    result.reason = "Original publication evidence conflicts or includes an ambiguous date; excluded from verified totals."; return result;
  }
  result.publication = chosen; result.status = "verified"; result.reason = `Verified from related ${usable[0].kind} publication evidence. Feed and modification dates do not override it.`;
  if (recipe.extractionMethod === "html_sections") result.reason += " Ingredients and steps were read from explicitly labelled article sections.";
  if (previous && dayInZone(previous, "UTC") < dayInZone(chosen, "UTC")) {
    result.publication = previous; result.reason = "Retained previously verified earlier publication; later reissue evidence is recorded separately.";
  }
  if (dates.some(d => d.kind === "feed" && d.parsed && d.parsed.precision !== "local" && dayInZone(d.parsed, "UTC") < dayInZone(result.publication!, "UTC"))) {
    result.status = "uncertain"; result.publication = null;
    result.reason = "Earlier feed publication evidence conflicts with the article's original date; excluded pending clarification.";
  }
  return result;
}
