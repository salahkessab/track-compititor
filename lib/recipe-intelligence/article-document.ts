import type { RecipeSnapshot } from "./article";
import type { ArticleFormat } from "./settings";
import { durationLabel } from "./format";

export type SupportedText = { text: string; evidenceIds: string[]; basis?: "source" | "culinary_knowledge" };
export type BlogSections = {
  whyMake: SupportedText[]; ingredientNotes: (SupportedText & { ingredientIndex: number })[];
  timeNote: SupportedText[]; variations: SupportedText[]; serving: SupportedText[];
  storage: SupportedText[]; proTips: SupportedText[]; faqs: (SupportedText & { question: string })[]; conclusion: string;
};
export type Article = { articleTitle?: string; seoTitle: string; metaDescription: string; slug: string; introduction: string; instructions: string[]; tips: string[]; storage: string[]; format?: ArticleFormat; blog?: BlogSections; wordCount?: number; editorialNotes?: string[] };
export const publicationTitle = (article: Article, recipe: RecipeSnapshot) => article.articleTitle?.trim() || recipe.title;
export const escapeHtml = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const andText = (text: string) => text.replace(/\s*&\s*/g, " and ");
export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
export function publicationTimes(recipe: RecipeSnapshot) {
  const times = { prepTime: recipe.prepTime, cookTime: recipe.cookTime, totalTime: recipe.totalTime };
  const duration = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(times.cookTime);
  const zero = duration && duration.slice(1).some(v => v !== undefined) && duration.slice(1).every(v => !Number(v));
  if (zero && /\b(?:bake|baking|roast|roasting|simmer|boil|fry|frying|saute|sauté|grill|broil|preheat|microwave)\w*/i.test(recipe.instructions.join(" "))) times.cookTime = "";
  return times;
}
export function recipeFacts(recipe: RecipeSnapshot, display = true) {
  const times = publicationTimes(recipe);
  return [["Servings", recipe.yield], ...(["prepTime", "cookTime", "totalTime"] as const).map((key, i) =>
    [["Prep time", "Cook time", "Total time"][i], durationLabel(times[key]) || (display && recipe[key] === times[key] ? recipe.displayTimes?.[key] || "" : "")])].filter(([, value]) => value);
}
export function recipeReferences(recipe: RecipeSnapshot): Record<string, string> {
  const refs: Record<string, string> = {};
  recipe.ingredients.forEach((v, i) => { refs[`I${i + 1}`] = v; });
  recipe.instructions.forEach((v, i) => { refs[`S${i + 1}`] = v; });
  recipeFacts(recipe).forEach(([label, value]) => { refs[`F_${label.replace(/ /g, "_")}`] = `${label}: ${value}`; });
  if (recipe.description) refs.D1 = recipe.description;
  recipe.tips.forEach((v, i) => { refs[`T${i + 1}`] = v; }); recipe.storage.forEach((v, i) => { refs[`R${i + 1}`] = v; });
  for (const evidence of recipe.supportingEvidence || []) refs[evidence.id] = `${evidence.heading}: ${evidence.text}`;
  return refs;
}

export function validateBlog(raw: any, recipe: RecipeSnapshot, warnings: string[], format: ArticleFormat = "blog_1000_1200_v1"): BlogSections {
  const master = format === "master_recipe_v1";
  const refs = recipeReferences(recipe);
  const prose = (v: unknown, max = 5000) => { if (typeof v !== "string") return ""; const text = v.replace(/<[^>]*>/g, "").replace(/\*\*/g, "").trim().slice(0, max); return master ? text : andText(text.replace(/[—–]/g, ", ")); };
  const numbers = (s: string): string[] => s.match(/\d+(?:[.,/]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]/g) || [];
  const claim = (v: any, section: string): SupportedText | null => {
    const text = prose(v?.text); const ids: string[] = Array.isArray(v?.evidenceIds) ? [...new Set<string>(v.evidenceIds.filter((x: unknown) => typeof x === "string"))].slice(0, 12) : [];
    if (!text) return null;
    const general = master && v?.basis === "culinary_knowledge" && !ids.length;
    if (!general && (!ids.length || ids.some(id => !refs[id]))) { warnings.push(`${section}: unsupported advice was omitted because its source references were missing.`); return null; }
    const evidence = ids.map(id => refs[id]).join(" ");
    if (numbers(text).some(n => !numbers(evidence).includes(n)) || general && /\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|overnight)\b/i.test(text)) { warnings.push(`${section}: an unsupported numerical claim or duration was omitted.`); return null; }
    if (/\b(?:my (?:family|grandmother|grandma|mother)|I (?:tested|grew up|remember|always make))\b/i.test(text)) { warnings.push(`${section}: an unsupported personal anecdote was omitted.`); return null; }
    return { text, evidenceIds: ids, ...(master ? { basis: general ? "culinary_knowledge" as const : "source" as const } : {}) };
  };
  const claims = (key: string, max = 5) => (Array.isArray(raw?.[key]) ? raw[key] : []).slice(0, max).flatMap((v: any) => { const row = claim(v, key); return row ? [row] : []; });
  const ingredientNotes = (Array.isArray(raw?.ingredientNotes) ? raw.ingredientNotes : []).slice(0, 200).flatMap((v: any) => {
    const row = claim(v, "Ingredient notes"); const index = v?.ingredientIndex;
    return row && Number.isInteger(index) && index >= 0 && index < recipe.ingredients.length ? [{ ...row, ingredientIndex: index }] : [];
  });
  const faqs = (Array.isArray(raw?.faqs) ? raw.faqs : []).slice(0, 5).flatMap((v: any) => { const row = claim(v, "FAQs"); const question = prose(v?.question, 250); return row && question ? [{ ...row, question }] : []; });
  const blog = { whyMake: claims("whyMake"), ingredientNotes, timeNote: master ? [] : claims("timeNote", 2), variations: claims("variations"), serving: claims("serving", 3), storage: claims("storage", 4), proTips: claims("proTips"), faqs, conclusion: master ? "" : prose(raw?.conclusion, 2500) };
  if (!master) {
    if (!blog.whyMake.length) warnings.push("Why make this recipe needs supported benefits.");
    if (blog.proTips.length < 3) warnings.push("Fewer than three supported pro tips are available.");
    if (blog.faqs.length < 3) warnings.push("Fewer than three supported FAQs are available.");
    if (!blog.conclusion) warnings.push("The closing paragraph is missing.");
  }
  return blog;
}

export type ArticleImage = { kind: "featured" | "alternate" | "pinterest" | "reference"; placement?: string; stepIndex?: number | null; caption?: string; dataUri: string; fileName: string; width: number; height: number };
export function articleDocument(article: Article, recipe: RecipeSnapshot, images: ArticleImage[] = []) {
  const html: string[] = []; const text: string[] = []; const markdown: string[] = [];
  const master = article.format === "master_recipe_v1";
  const title = publicationTitle(article, recipe);
  const blog = article.format === "blog_1000_1200_v1" || master ? article.blog : undefined;
  const prose = (v: string) => blog && !master ? andText(v) : v;
  const photograph = (kind: ArticleImage["kind"]) => {
    const image = images.find(i => i.kind === kind); if (!image) return;
    const alt = `${title}, ${kind === "alternate" ? "alternative camera angle" : kind === "pinterest" ? "vertical recipe photograph" : "finished dish"}`;
    html.push(`<figure><img src="${escapeHtml(image.dataUri)}" alt="${escapeHtml(alt)}" width="${image.width}" height="${image.height}" loading="${kind === "featured" ? "eager" : "lazy"}" style="display:block;width:100%;max-width:680px;height:auto"></figure>`);
    markdown.push(`![${alt.replace(/[\[\]\\]/g, "")}](${image.fileName})`);
  };
  const references = (placement: string, stepIndex?: number) => {
    for (const image of images.filter(i => i.kind === "reference" && i.placement === placement && (stepIndex === undefined || i.stepIndex === stepIndex))) {
      const alt = master ? `${title}, ${image.placement === "step" ? `cooking step ${image.stepIndex || ""}`.trim() : image.placement === "ingredients" ? "ingredients" : "recipe photograph"}` : image.caption || title;
      html.push(`<figure><img src="${escapeHtml(image.dataUri)}" alt="${escapeHtml(alt)}" width="${image.width}" height="${image.height}" loading="lazy" style="display:block;max-width:100%;height:auto"></figure>`);
      markdown.push(`![${alt.replace(/[\[\]\\]/g, "")}](${image.fileName})`);
    }
  };
  const heading = (title: string, level = 2) => { title = prose(title); html.push(`<h${level}><strong>${escapeHtml(title)}</strong></h${level}>`); text.push(title); markdown.push(`${"#".repeat(level)} ${title}`); };
  const paragraphs = (value: string) => { for (const p of value.split(/\n\s*\n/).filter(x => x.trim())) { const s = prose(p.trim()); html.push(`<p>${escapeHtml(s)}</p>`); text.push(s); markdown.push(s); } };
  const list = (values: string[], ordered = false) => {
    if (!values.length) return; const rows = values.map(prose);
    html.push(`<${ordered ? "ol" : "ul"}>${rows.map(v => `<li>${escapeHtml(v)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
    text.push(rows.map((v, i) => `${ordered ? `${i + 1}.` : "•"} ${v}`).join("\n")); markdown.push(rows.map((v, i) => `${ordered ? `${i + 1}.` : "-"} ${v}`).join("\n"));
  };
  const section = (title: string, claims: SupportedText[], bullets = false) => { if (claims.length) { heading(title); if (bullets) list(claims.map(v => v.text)); else claims.forEach(v => paragraphs(v.text)); } };
  const facts = () => { const rows = recipeFacts(recipe, !!blog); html.push(`<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(prose(v))}</dd>`).join("")}</dl>`); text.push(rows.map(([k,v]) => `${k}: ${prose(v)}`).join("\n")); markdown.push(rows.map(([k,v]) => `${k}: ${prose(v)}`).join("\n\n")); };
  if (master && blog) {
    heading(title, 1); photograph("featured"); references("hero"); paragraphs(article.introduction);
    section("What Makes This Recipe Special", blog.whyMake);
    heading("Ingredients and Why They Work");
    blog.ingredientNotes.forEach(note => paragraphs(note.text));
    references("ingredients");
    heading(`How to Make ${title}`);
    article.instructions.forEach((step, index) => {
      html.push(`<ol start="${index + 1}"><li>${escapeHtml(step)}</li></ol>`);
      text.push(`${index + 1}. ${step}`); markdown.push(`${index + 1}. ${step}`);
      references("step", index + 1);
    });
    photograph("alternate");
    section("Tips for the Best Results", blog.proTips, true);
    section(`What to Serve With ${title}`, blog.serving);
    section("Storage and Reheating", blog.storage);
    section("Substitutions and Variations", blog.variations);
    if (blog.faqs.length) { heading("Frequently Asked Questions"); for (const faq of blog.faqs) { heading(faq.question, 3); paragraphs(faq.text); } }
    heading("Complete Recipe Card"); heading(title, 3); paragraphs(article.metaDescription);
    facts(); heading("Ingredients", 3); list(recipe.ingredients);
    heading("Instructions", 3); list(article.instructions, true);
  } else {
    heading(recipe.title, 1); photograph("featured"); references("hero"); if (blog) heading("Introduction"); paragraphs(article.introduction);
    if (blog) section("Why make this recipe", blog.whyMake, true); else facts();
    heading(blog ? "Ingredients you’ll need" : "Ingredients");
    list(recipe.ingredients.map((ingredient, index) => { const notes = blog?.ingredientNotes.filter(n => n.ingredientIndex === index).map(n => n.text); return notes?.length ? `${ingredient}. ${notes.join(" ")}` : ingredient; }));
    references("ingredients");
    if (blog) { heading("Prep and cook time"); facts(); blog.timeNote.forEach(n => paragraphs(n.text)); }
    heading(blog ? `How to make ${recipe.title}` : "Instructions");
    if (images.some(i => i.kind === "reference" && i.placement === "step")) {
      article.instructions.forEach((step, index) => { html.push(`<ol start="${index + 1}"><li>${escapeHtml(prose(step))}</li></ol>`); text.push(`${index + 1}. ${prose(step)}`); markdown.push(`${index + 1}. ${prose(step)}`); references("step", index + 1); });
    } else list(article.instructions, true);
    photograph("alternate");
    if (blog) {
      section("Tips and creative variations", blog.variations, true); section("Serving ideas", blog.serving);
      section("Storing and reheating", blog.storage); section("Pro tips for success", blog.proTips, true);
      if (blog.faqs.length) { heading("FAQs"); for (const faq of blog.faqs) { heading(faq.question, 3); paragraphs(faq.text); } }
      if (blog.conclusion) { heading("Conclusion"); paragraphs(blog.conclusion); }
    } else { if (article.tips.length) { heading("Tips"); list(article.tips); } if (article.storage.length) { heading("Storage"); list(article.storage); } }
  }
  photograph("pinterest");
  references("serving");
  if (images.some(i => i.kind === "reference" && i.placement === "gallery")) { heading("Photo gallery"); references("gallery"); }
  const count = wordCount(text.join(" ").replace(/(?:^|\s)(?:•|\d+\.)\s/g, " "));
  // Provenance belongs in source.json/research-sources.json, not publishable output.
  return { html: html.join("\n"), text: text.join("\n\n") + "\n", markdown: markdown.join("\n\n") + "\n", wordCount: count };
}
