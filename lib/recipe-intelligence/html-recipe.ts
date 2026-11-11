import type { CheerioAPI } from "cheerio";
import type { RecipeSnapshot } from "./article";

const clean = (value: string, max = 12000) => value.replace(/\s+/g, " ").trim().slice(0, max);
const heading = (value: string) => clean(value).toLowerCase().replace(/[’']/g, "").replace(/[:.!?]+$/, "");
function duration(value: string): string {
  const tokens = [...value.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)];
  if (!tokens.length || value.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g, "").trim()) return "";
  let hours = 0, minutes = 0, seconds = 0;
  for (const token of tokens) {
    const n = Number(token[1]); if (token[2].startsWith("h")) hours += n; else if (token[2].startsWith("m")) minutes += n; else seconds += n;
  }
  return hours + minutes + seconds > 0 ? `PT${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${seconds ? `${seconds}S` : ""}` : "";
}

// Conservative fallback for one explicitly labelled recipe in an article.
// It never infers a recipe from a title, feed date, or arbitrary page paragraphs.
export function extractHtmlRecipe($: CheerioAPI, url: string): { recipe: RecipeSnapshot | null; reason?: string } {
  let roots = $("article").filter((_, element) => $(element).find("h1").length === 1);
  if (!roots.length) roots = $("main").filter((_, element) => $(element).find("h1").length === 1);
  if (roots.length !== 1) return { recipe: null };
  const root = roots.first().clone();
  root.find("script,style,noscript,template,nav,aside,footer,form,[hidden],[aria-hidden='true']").remove();
  const headings = root.find("h2,h3,h4");
  const ingredientHeading = headings.filter((_, e) => /^(?:ingredients(?: list)?|what you(?:ll| will)? need)$/.test(heading($(e).text())));
  const methodHeading = headings.filter((_, e) => /^(?:instructions|directions|method|steps|preparation|how (?:to|i) make (?:it|them|this(?: recipe)?|the recipe))$/.test(heading($(e).text())));
  if (ingredientHeading.length > 1 || methodHeading.length > 1) return { recipe: null, reason: "Multiple labelled recipe sections require review; ingredients and methods were not combined." };
  if (ingredientHeading.length !== 1 || methodHeading.length !== 1) return { recipe: null };
  const start = ingredientHeading.first(); const method = methodHeading.first();
  if (start.parent()[0] !== method.parent()[0] || start[0].tagName !== method[0].tagName || start.index() >= method.index()) return { recipe: null };
  const stop = Array.from({ length: Number(start[0].tagName.slice(1)) }, (_, i) => `h${i + 1}`).join(",");
  const ingredientNodes = start.nextUntil(stop); const methodNodes = method.nextUntil(stop);
  const ingredients: string[] = []; let group = "", nested = false;
  ingredientNodes.each((_, element) => {
    const node = $(element); const tag = element.tagName;
    const title = clean(node.text(), 200).replace(/:$/, "");
    if (/^h[3-6]$/.test(tag) || tag === "p" && /^for (?:the )?[^.!?]{1,80}:?$/i.test(clean(node.text()))) group = title;
    if (!["ul", "ol"].includes(tag)) return;
    node.children("li").each((_, li) => {
      if ($(li).find("ul,ol").length || clean($(li).text(), 2001).length > 2000) nested = true;
      const text = clean($(li).text(), 2000); if (text) ingredients.push(group ? `${group}: ${text}` : text);
    });
  });
  const lists = methodNodes.filter("ol,ul"); const instructions: string[] = [];
  if (lists.length !== 1) return { recipe: null };
  lists.children("li").each((_, li) => {
    if ($(li).find("ul,ol").length || clean($(li).text(), 12001).length > 12000) nested = true;
    const text = clean($(li).text()); if (text) instructions.push(text);
  });
  if (nested || !ingredients.length || !instructions.length || ingredients.length > 200 || instructions.length > 200) return { recipe: null };
  const title = clean(root.find("h1").first().text(), 500); if (!title) return { recipe: null };
  const fields = { yield: "", prepTime: "", cookTime: "", totalTime: "" };
  const values = new Map<keyof typeof fields, Set<string>>(); const rawValues = new Map<keyof typeof fields, Set<string>>(); const uncertain = new Set<keyof typeof fields>(); const sourceNotes: string[] = [];
  // Copy only explicit labels attached to the full recipe body. Approximate,
  // ranged, or conflicting totals stay absent; all verbatim method timings remain.
  start.prevAll("p").each((_, p) => {
    for (const part of $(p).text().split(/[·\n]/)) {
      const match = /^(prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|bake(?: time)?|total(?: time)?|serves|servings|yield|makes)\s*:\s*(.+)$/i.exec(clean(part));
      if (!match) continue;
      const key = /^(serves|servings|yield|makes)$/i.test(match[1]) ? "yield" : /^prep/i.test(match[1]) ? "prepTime" : /^total/i.test(match[1]) ? "totalTime" : "cookTime";
      const raw = rawValues.get(key) || new Set<string>(); raw.add(clean(match[2], 200)); rawValues.set(key, raw);
      const value = key === "yield" ? clean(match[2], 200) : duration(match[2]);
      if (!value) { uncertain.add(key); sourceNotes.push(`Optional ${match[1]} label was not converted: ${clean(match[2], 200)}. Cooking-step timings are preserved.`); continue; }
      const set = values.get(key) || new Set<string>(); set.add(value); values.set(key, set);
    }
  });
  for (const [key, alternatives] of values) {
    if (uncertain.has(key)) continue;
    if (alternatives.size === 1) fields[key] = [...alternatives][0];
    else sourceNotes.push(`Conflicting ${key} labels were omitted; cooking-step facts are preserved.`);
  }
  const displayTimes: RecipeSnapshot["displayTimes"] = {};
  for (const key of ["prepTime", "cookTime", "totalTime"] as const) {
    const raw = rawValues.get(key); if (!fields[key] && raw?.size === 1) displayTimes[key] = [...raw][0];
  }
  return { recipe: { url, title, ingredients, instructions, ...fields, displayTimes, description: "", imageDescription: "", tips: [], storage: [], retrievedAt: new Date().toISOString(), extractionMethod: "html_sections", sourceNotes } };
}
