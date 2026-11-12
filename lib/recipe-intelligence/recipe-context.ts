import type { CheerioAPI } from "cheerio";

export type SupportingEvidence = { id: string; kind: "ingredient_note" | "tip" | "variation" | "serving" | "storage"; heading: string; text: string };
export type SourceReading = { version: 1; text: string; truncated: boolean };
export function boundedSourceReading(full: string): SourceReading | undefined {
  if (typeof full !== 'string') return;
  let text = '', bytes = 0;
  for (const ch of full) { const size = Buffer.byteLength(ch); if (bytes + size > 10000) break; text += ch; bytes += size; }
  return text.length >= 40 ? { version: 1, text, truncated: text.length < full.length } : undefined;
}
// Private editorial reading only. Never treat narrative prose as recipe-card facts.
export function sourceReading($: CheerioAPI): SourceReading | undefined {
  const roots = $("article,main,[itemprop='articleBody'],.entry-content,.post-content").filter((_, el) => !$(el).parents('aside,nav,footer').length);
  const selected = roots.filter((_, el) => $(el).find('h1').length === 1).first();
  const bodies = $('.entry-content,.post-content,[itemprop="articleBody"]').filter((_, el) => !$(el).parents('aside,nav,footer').length);
  const root = (bodies.length === 1 ? bodies : selected.length ? selected : roots.first()).clone();
  if (!root.length) return;
  root.find("script,style,noscript,nav,aside,footer,form,button,article,[hidden],[aria-hidden='true'],.comments,#comments,.author-box,.related,.related-posts,.related-articles,.recommended-posts,.recommended-articles,[class*='recirculation'],[class*='newsletter'],[class*='advertisement']").remove();
  const blocks = root.find('h1,h2,h3,p,li').filter((_, el) => !$(el).parents('li,p').length).map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  return boundedSourceReading(blocks.join('\n'));
}
export function recipeContext($: CheerioAPI): SupportingEvidence[] {
  const oneTitle = (element: Parameters<CheerioAPI>[0]) => {
    const titles = $(element).find("h1").map((_, h) => $(h).text().replace(/\s+/g, " ").trim().toLowerCase()).get().filter(Boolean);
    return new Set(titles).size === 1;
  };
  // A WordPress theme may repeat the same title in the header and body.
  // Distinct article titles still make optional guidance ambiguous.
  let roots = $("article").filter((_, e) => oneTitle(e));
  if (!roots.length) roots = $("main").filter((_, e) => oneTitle(e));
  // Some themes put the page H1 above main. A unique article body under a
  // single page title is still unambiguous; nested recommendation cards are removed below.
  if (!roots.length && new Set($('h1').map((_, h) => $(h).text().trim().toLowerCase()).get().filter(Boolean)).size === 1) {
    const bodies = $('.entry-content,.post-content,[itemprop="articleBody"]').filter((_, e) => !$(e).parents('aside,nav,footer').length);
    if (bodies.length === 1) roots = bodies;
  }
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
