import type { CheerioAPI } from "cheerio";

export type SupportingEvidence = { id: string; kind: "ingredient_note" | "tip" | "variation" | "serving" | "storage"; heading: string; text: string };
export function recipeContext($: CheerioAPI): SupportingEvidence[] {
  const oneTitle = (element: Parameters<CheerioAPI>[0]) => {
    const titles = $(element).find("h1").map((_, h) => $(h).text().replace(/\s+/g, " ").trim().toLowerCase()).get().filter(Boolean);
    return new Set(titles).size === 1;
  };
  // A WordPress theme may repeat the same title in the header and body.
  // Distinct article titles still make optional guidance ambiguous.
  let roots = $("article").filter((_, e) => oneTitle(e));
  if (!roots.length) roots = $("main").filter((_, e) => oneTitle(e));
  if (roots.length !== 1) return [];
  const root = roots.first().clone();
  root.find("script,style,noscript,nav,aside,footer,form,article,[hidden],[aria-hidden='true'],[role='complementary'],[role='navigation'],[role='contentinfo'],[itemprop='comment'],#comments,.comments,.comment-list,.related,.related-posts,.related-articles,.recommended-posts,.recommended-articles,.yarpp-related").remove();
  const result: SupportingEvidence[] = []; let bytes = 0;
  root.find("h2,h3").each((_, el) => {
    // A heading inside a link is commonly a related-post card, not a section
    // of this recipe. Heading permalink anchors inside the heading are fine.
    if ($(el).closest("a").length) return;
    const title = $(el).text().replace(/\s+/g, " ").trim();
    const kind: SupportingEvidence["kind"] | null = /stor(?:e|age|ing)|reheat|freez|leftovers|make.?ahead|night before/i.test(title) ? "storage"
      : /swap|substitut|variation|dietary|alternative/i.test(title) ? "variation"
      : /serving|serve|pairing/i.test(title) ? "serving"
      : /tips|success|troubleshoot|go wrong|mistakes/i.test(title) ? "tip"
      : /ingredients|what you(?:['’]?ll| will)? need/i.test(title) ? "ingredient_note" : null;
    if (!kind) return;
    const stop = el.tagName === "h2" ? "h1,h2" : "h1,h2,h3";
    const nodes = $(el).nextUntil(stop);
    // Ingredient lists themselves are already authoritative recipe fields.
    const blocks = kind === "ingredient_note" ? nodes.filter("p") : nodes.filter("p,ul,ol");
    blocks.each((_, block) => {
      const parts = /^(ul|ol)$/.test(block.tagName) ? $(block).children("li") : $(block);
      parts.each((_, part) => {
        const text = $(part).text().replace(/\s+/g, " ").trim();
        if (text.length < 30 || text.length > 1400 || bytes + Buffer.byteLength(text) > 12000 || result.length >= 24) return;
        result.push({ id: `E${result.length + 1}`, kind, heading: title.slice(0, 180), text }); bytes += Buffer.byteLength(text);
      });
    });
  });
  return result;
}
