import { DEFAULT_IMAGE_SETTINGS, DEFAULT_OPENAI_IMAGE_MODEL, validateImageSettings, type OpenAIImageSettings } from "./openaiImageSettings";
import { OPENAI_MODELS } from "./config";
import { getRecipeStyle, RECIPE_STYLE_IDS, renderRecipeStylePrompt, validateRecipePromptCopy, type RecipePromptCopy, type RecipeStyleId } from "./recipeDesignStylePresets";

export const RECIPE_DESIGN_VERSION = 1; // Storage and research-cache schema.
export const RECIPE_ART_DIRECTION_VERSION = 3;
export const RECIPE_DESIGN_TEXT_MODEL = "gpt-5.4-mini";
// Keep older family identifiers valid for existing presets and history.
export const RECIPE_DESIGN_FAMILIES = ["notebook", "black_label", "farmhouse", "retro_diner", "minimal", "heritage", "editorial", "mediterranean"] as const;
export type DesignFamily = typeof RECIPE_DESIGN_FAMILIES[number];
export type DesignMode = "auto" | "reference" | "hybrid";
export type DesignSource = { url: string; title: string };
export type VisualExample = {
  id: string; sourceUrl: string; imageUrl: string; thumbnailUrl?: string; thumbnail: string; caption: string;
  observedAt: string; publishedAt: string | null; sourceStatus: "accessible" | "unverified";
  inspection: "vision" | "not_inspected"; evidence: "visual_inspiration_only";
  observation: string; photoPlacement: string; typography: string; palette: string; label: string;
};
export type Research = { date: string; summary: string; sources: DesignSource[]; version?: 2;
  examples?: VisualExample[]; platformSources?: DesignSource[]; limitations?: string[] };
export type TemplateEdits = {
  font?: "heritage_slab" | "notebook_serif" | "diner_slab" | "editorial_serif";
  alignment?: "left" | "center" | "right"; titleScale?: number;
  accent?: string; background?: string; ink?: string; panel?: string;
};
export type StyleDNA = {photoLayout:string;titleHierarchy:string;palette:string;labelAndFrame:string;ornaments:string;mood:string};
export type DesignPlan = {
  family: DesignFamily; palette: string[]; typography: string; layout: string;
  decoration: string; referenceSummary: string; photoSummary: string; researchSummary: string;
  styleId?: RecipeStyleId; stylePromptVersion?: number;
  concept?: string; material?: string; typographyPair?: "heritage_slab" | "notebook_serif" | "diner_slab" | "editorial_serif";
  titlePlacement?: "top" | "bottom"; difference?: string; evidenceMode?: "uploaded_reference" | "visual_research" | "text_research" | "inference";
  inspirationIds?: string[]; whyFits?: string; paletteSource?: "model" | "normalized" | "fallback"; template?: TemplateEdits; styleDNA?: StyleDNA;
};
export type DesignSettings = {
  version: 1; mode: DesignMode; researchEnabled: boolean; photoAnalysis: boolean;
  strength: "low" | "medium" | "high"; priority: "food_first" | "balanced";
  direction: "auto" | DesignFamily; model: string; image: OpenAIImageSettings; count: number;
  styleId: "auto" | RecipeStyleId; textModel: typeof OPENAI_MODELS[number];
  artworkSize: "selected" | "1280x1600";
};
export const DEFAULT_DESIGN_SETTINGS: DesignSettings = {
  version: 1, mode: "auto", researchEnabled: false, photoAnalysis: true,
  strength: "medium", priority: "food_first", direction: "auto",
  model: DEFAULT_OPENAI_IMAGE_MODEL, image: { ...DEFAULT_IMAGE_SETTINGS, size: "1024x1536", output_format: "png" }, count: 1,
  styleId: "auto", textModel: RECIPE_DESIGN_TEXT_MODEL, artworkSize: "1280x1600",
};
export function selectRecipeStyle(styleId: DesignSettings["styleId"], title: string, recent: readonly string[] = []): RecipeStyleId {
  if (styleId !== "auto") return styleId;
  const t = title.toLocaleLowerCase();
  const preferred: RecipeStyleId = /burger|sandwich|fried|pork chop/.test(t) ? "black_label_vintage"
    : /pizza|diner|hot dog/.test(t) ? "retro_diner_poster"
    : /soup|stew|chili|chowder/.test(t) ? "notebook_comfort_food"
    : /casserole|bake|chicken/.test(t) ? "vintage_farmhouse_recipe" : "old_cookbook_panel";
  return [preferred,...RECIPE_STYLE_IDS.filter(id=>id!==preferred)].find(id=>!recent.slice(0,4).includes(id)) || preferred;
}
export function recipeArtworkSize(settings: DesignSettings): string {
  return settings.artworkSize === "1280x1600" ? "1280x1600" : settings.image.size;
}
export function recipeArtworkPrompt(plan: DesignPlan, title: string, noText: boolean, strength: string, notes = "", promptCopy?: RecipePromptCopy): string {
  if (!plan.styleId || !getRecipeStyle(plan.styleId)) return artworkPrompt(plan,strength); // legacy saved jobs
  const style = getRecipeStyle(plan.styleId)!;
  const active=validateRecipePromptCopy(promptCopy,plan.styleId);
  if (plan.stylePromptVersion !== (active?.version || style.version)) throw new Error("The selected style prompt version is unavailable.");
  const full = renderRecipeStylePrompt(plan.styleId,title,noText,notes,active);
  return `${full}\n\nSTRICT DECORATIVE ARTWORK ADAPTATION — THIS IMAGE REQUEST GENERATES BACKGROUND ART ONLY. The complete creative specification above defines the visual family, motifs, paper texture, label silhouette, typography hierarchy and composition. Apply those qualities to the DECORATIVE STAGE only. The protected original food photo and exact title are placed later by trusted local code. Generate visually rich printed paper, ornate border and label geometry, floral/gingham/check/engraved details as appropriate to ${style.name}, and a large EMPTY photo opening plus EMPTY title-safe zone. Do not render any food, plates, utensils, ingredients, people, photographs, letters, words, numbers, logos or watermarks. Do not imitate a reference photo. Palette: ${plan.palette.join(", ")}. Layout brief: ${plan.layout}. Decorative brief: ${plan.decoration}. Style strength: ${strength}. Reference style cues: ${plan.styleDNA ? Object.values(plan.styleDNA).join("; ") : "none"}. Reserve the actual photo and title for protected local compositing.`;
}

const oneOf = <T extends string>(value: unknown, options: readonly T[], label: string): T => {
  if (typeof value !== "string" || !options.includes(value as T)) throw new Error(`Invalid ${label}.`);
  return value as T;
};
const shortString = (v: unknown, max: number, label: string) => {
  if (typeof v !== "string" || v.length > max) throw new Error(`Invalid ${label}.`);
  return v;
};
export function validateDesignSettings(value: unknown): DesignSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid design settings.");
  const s = value as Record<string, unknown>;
  const model = shortString(s.model, 100, "model");
  const image = validateImageSettings(model, s.image);
  if (image.partial_images !== 0) throw new Error("Partial artwork previews are not supported in Recipe Designs.");
  const mode = oneOf(s.mode, ["auto", "reference", "hybrid"] as const, "mode");
  const direction = oneOf(s.direction, ["auto", ...RECIPE_DESIGN_FAMILIES] as const, "design direction");
  const styleId = s.styleId === undefined ? "auto" : oneOf(s.styleId, ["auto", ...RECIPE_STYLE_IDS] as const, "recipe style");
  const textModel = s.textModel === undefined ? RECIPE_DESIGN_TEXT_MODEL : oneOf(s.textModel, OPENAI_MODELS, "text model");
  const artworkSize = s.artworkSize === undefined ? "selected" : oneOf(s.artworkSize, ["selected","1280x1600"] as const, "artwork size");
  if (artworkSize === "1280x1600" && model !== "gpt-image-2.5-sunburst") throw new Error("1280×1600 artwork is currently supported here only with gpt-image-2.5-sunburst. Choose selected image size for this model.");
  if (typeof s.researchEnabled !== "boolean" || typeof s.photoAnalysis !== "boolean") throw new Error("Invalid research or privacy setting.");
  if (mode === "hybrid" && !s.researchEnabled) throw new Error("Hybrid mode requires research.");
  if (!Number.isInteger(s.count) || (s.count as number) < 1 || (s.count as number) > 3) throw new Error("Choose 1 to 3 separate designs.");
  return { version: 1, mode, researchEnabled: s.researchEnabled, photoAnalysis: s.photoAnalysis,
    strength: oneOf(s.strength, ["low", "medium", "high"] as const, "style strength"),
    priority: oneOf(s.priority, ["food_first", "balanced"] as const, "priority"),
    direction, model, image, count: s.count as number, styleId, textModel, artworkSize };
}
export function validateTitle(title: unknown, noText: unknown): { title: string; noText: boolean } {
  if (typeof noText !== "boolean") throw new Error("Invalid NO TEXT setting.");
  const exact = shortString(title, 180, "recipe title");
  if (!noText && !exact.trim()) throw new Error("Enter a recipe title or choose NO TEXT.");
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(exact)) throw new Error("The title contains unsupported control characters.");
  return { title: exact, noText };
}
export function validateAnalysisImage(value: unknown): string {
  if (typeof value !== "string" || value.length > 900_000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Invalid or oversized analysis image.");
  }
  return value;
}
export function validateSources(value: unknown): DesignSource[] {
  if (!Array.isArray(value)) return [];
  const found: DesignSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    try {
      const url = new URL(String(item.url));
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || found.some((s) => s.url === url.href)) continue;
      found.push({ url: url.href, title: typeof item.title === "string" ? item.title.slice(0, 160) : url.hostname });
    } catch { /* ignore invalid URLs */ }
    if (found.length === 10) break;
  }
  return found;
}
export function validateResearch(value: unknown): Research | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const date = typeof obj.date === "string" ? obj.date : "";
  const timestamp = Date.parse(date);
  const sources = validateSources(obj.sources);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp > 7 * 86400_000 || (obj.version !== 2 && !sources.length) || typeof obj.summary !== "string" || !obj.summary.trim() || obj.summary.length > 1600) return null;
  if(obj.version!==2) return { date, summary: obj.summary, sources };
  const examples = Array.isArray(obj.examples) ? obj.examples.filter((x:unknown): x is VisualExample => {
    if(!x || typeof x!=="object")return false;
    const e=x as Record<string,unknown>;
    if(typeof e.id!=="string" || typeof e.sourceUrl!=="string" || typeof e.imageUrl!=="string" || typeof e.thumbnail!=="string" ||
       !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(e.thumbnail) || e.thumbnail.length>180_000 ||
       e.evidence!=="visual_inspiration_only" || !["vision","not_inspected"].includes(String(e.inspection)) ||
       !["accessible","unverified"].includes(String(e.sourceStatus)))return false;
    return validateSources([{url:e.sourceUrl}]).length===1 && validateSources([{url:e.imageUrl}]).length===1;
  }).slice(0,8).map((e:VisualExample)=>({ ...e, observation:String(e.observation||"").slice(0,450), photoPlacement:String(e.photoPlacement||"").slice(0,220), typography:String(e.typography||"").slice(0,220), palette:String(e.palette||"").slice(0,220), label:String(e.label||"").slice(0,220), caption:String(e.caption||"").slice(0,220) })) : [];
  return { date, summary:obj.summary, sources, version:2, examples, platformSources:validateSources(obj.platformSources), limitations:Array.isArray(obj.limitations)?obj.limitations.filter((v:unknown):v is string=>typeof v==="string").map((v:string)=>v.slice(0,300)).slice(0,6):[] };
}
export function validateDesignPlan(value: unknown): DesignPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The design brief was invalid.");
  const p = value as Record<string, unknown>;
  const family = oneOf(p.family, RECIPE_DESIGN_FAMILIES, "design family");
  if (!Array.isArray(p.palette) || p.palette.length < 2 || p.palette.length > 5 || !p.palette.every((s: unknown) => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s))) throw new Error("The design palette was invalid.");
  const text = (key: string) => shortString(p[key], 500, key).trim();
  const optionalText = (key:string) => p[key] === undefined ? "" : text(key);
  const typographyPair = p.typographyPair === undefined ? undefined : oneOf(p.typographyPair, ["heritage_slab","notebook_serif","diner_slab","editorial_serif"] as const, "typography pair");
  const titlePlacement = p.titlePlacement === undefined ? undefined : oneOf(p.titlePlacement, ["top","bottom"] as const, "title placement");
  const evidenceMode = p.evidenceMode === undefined ? undefined : oneOf(p.evidenceMode, ["uploaded_reference","visual_research","text_research","inference"] as const, "evidence mode");
  const paletteSource = p.paletteSource === undefined ? undefined : oneOf(p.paletteSource, ["model","normalized","fallback"] as const, "palette source");
  const template = p.template === undefined ? undefined : validateTemplateEdits(p.template);
  const styleDNA = p.styleDNA === undefined ? undefined : validateStyleDNA(p.styleDNA);
  const styleId = p.styleId === undefined ? undefined : oneOf(p.styleId, RECIPE_STYLE_IDS, "recipe style");
  if(styleId && (!Number.isInteger(p.stylePromptVersion) || (p.stylePromptVersion as number)<1 || (p.stylePromptVersion as number)>100)) throw new Error("Invalid style prompt version.");
  const stylePromptVersion = styleId ? p.stylePromptVersion as number : undefined;
  return { family, palette: p.palette as string[], typography: text("typography"), layout: text("layout"), decoration: text("decoration"), referenceSummary: text("referenceSummary"), photoSummary: text("photoSummary"), researchSummary: text("researchSummary"),
    styleId, stylePromptVersion,
    concept: optionalText("concept"), material: optionalText("material"), difference: optionalText("difference"), typographyPair, titlePlacement, evidenceMode, paletteSource, template, styleDNA,
    inspirationIds:Array.isArray(p.inspirationIds)?p.inspirationIds.filter((x:unknown):x is string=>typeof x==="string").slice(0,8):[], whyFits:optionalText("whyFits") };
}
export function validateStyleDNA(value:unknown):StyleDNA {
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Invalid reference style analysis.");
  const v=value as Record<string,unknown>;
  const text=(key:string)=>typeof v[key]==="string" ? (v[key] as string).trim().slice(0,280) : "";
  return {photoLayout:text("photoLayout"),titleHierarchy:text("titleHierarchy"),palette:text("palette"),labelAndFrame:text("labelAndFrame"),ornaments:text("ornaments"),mood:text("mood")};
}
export function validateTemplateEdits(value: unknown): TemplateEdits {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Invalid template settings.");
  const v=value as Record<string,unknown>; const color=(key:string)=>{
    if(v[key]===undefined)return undefined;
    if(typeof v[key]!=="string" || !/^#[0-9a-f]{6}$/i.test(v[key] as string))throw new Error(`Invalid ${key} color.`);
    return v[key] as string;
  };
  if(v.titleScale!==undefined && (typeof v.titleScale!=="number" || !Number.isFinite(v.titleScale) || v.titleScale<0.7 || v.titleScale>1.3))throw new Error("Invalid title size.");
  return {font:v.font===undefined?undefined:oneOf(v.font,["heritage_slab","notebook_serif","diner_slab","editorial_serif"] as const,"template font"),
    alignment:v.alignment===undefined?undefined:oneOf(v.alignment,["left","center","right"] as const,"title alignment"),
    titleScale:v.titleScale as number | undefined,accent:color("accent"),background:color("background"),ink:color("ink"),panel:color("panel")};
}

const COLOR_NAMES: Record<string,string> = {
  black:"#000000", white:"#FFFFFF", ivory:"#FFFFF0", cream:"#FFFDD0", beige:"#F5F5DC", tan:"#D2B48C",
  brown:"#795548", charcoal:"#36454F", gold:"#D4AF37", burgundy:"#800020", red:"#B22222",
  sage:"#9CAF88", olive:"#808000", navy:"#000080", blue:"#4169E1", pink:"#E8B4B8",
};
const FAMILY_PALETTES: Record<DesignFamily,readonly string[]> = {
  black_label:["#1C1917","#F5E8CD","#C9A664"], notebook:["#F5EAD6","#702C31","#A88775"],
  retro_diner:["#F6E6C8","#8C302B","#D5B99A"], heritage:["#F1E2C7","#4D2D25","#A7825E"],
  farmhouse:["#F1E2C7","#4D2D25","#A7825E"], minimal:["#F1E2C7","#4D2D25","#A7825E"],
  editorial:["#1E2925","#F4E8D5","#D35336"], mediterranean:["#123B66","#F6E9D0","#C56945"],
};
/** Normalize provider colors only. Client-supplied plans remain strictly validated. */
export function normalizeModelPalette(value: unknown, family: DesignFamily): {palette:string[]; paletteSource:"model"|"normalized"|"fallback"} {
  const entries = Array.isArray(value) ? value.slice(0,32) : [];
  const colors:string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length > 200) continue;
    const text = entry.trim();
    const matches = text.match(/#[0-9a-f]{6}(?![0-9a-f])|#[0-9a-f]{3}(?![0-9a-f])/gi) || [];
    const name = text.toLowerCase();
    const raw = matches.length === 1 ? matches[0] : /^[0-9a-f]{6}$/i.test(text) ? `#${text}` : Object.hasOwn(COLOR_NAMES,name) ? COLOR_NAMES[name] : undefined;
    if (!raw) continue;
    const color = raw.length === 4 ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}` : raw;
    if (!colors.some(existing=>existing.toLowerCase()===color.toLowerCase())) colors.push(color);
    if (colors.length === 5) break;
  }
  const isExact = Array.isArray(value) && value.length>=2 && value.length<=5 &&
    value.every((v:unknown,index:number)=>typeof v==="string" && /^#[0-9a-f]{6}$/i.test(v) && colors[index]===v);
  if (colors.length >= 2) return {palette:colors,paletteSource:isExact?"model":"normalized"};
  for (const color of FAMILY_PALETTES[family]) {
    if (!colors.some(existing=>existing.toLowerCase()===color.toLowerCase())) colors.push(color);
    if (colors.length >= 2) break;
  }
  return {palette:colors,paletteSource:"fallback"};
}
// Structured model output can contain longer descriptions than the UI or the
// artwork prompt needs. Bound those descriptions without rejecting a usable,
// already-paid response. Optional summaries may be absent when not applicable.
export function normalizeModelDesignPlan(value: unknown, researchEnabled: boolean): DesignPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The design brief was invalid.");
  const p = value as Record<string, unknown>;
  const family = oneOf(p.family, RECIPE_DESIGN_FAMILIES, "design family");
  const bounded = (key: string, optional = false): string => {
    const input = p[key];
    if (optional && (input === undefined || input === null)) return "";
    if (typeof input !== "string") throw new Error(`Invalid ${key}.`);
    const text = input.trim();
    if (text.length <= 500) return text;
    let end = 499;
    // Avoid leaving half of a UTF-16 surrogate pair at the truncation point.
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    return text.slice(0, end).trimEnd() + "…";
  };
  return validateDesignPlan({
    ...p,
    ...normalizeModelPalette(p.palette, family),
    typography: bounded("typography"), layout: bounded("layout"), decoration: bounded("decoration"),
    referenceSummary: bounded("referenceSummary", true), photoSummary: bounded("photoSummary", true),
    researchSummary: researchEnabled ? bounded("researchSummary", true) : "",
    concept: bounded("concept", true), material: bounded("material", true), difference: bounded("difference", true),
  });
}
export function chooseDistinctFamily(suggested: DesignFamily, recent: readonly string[]): DesignFamily {
  const used = recent.slice(0, 5).filter((value): value is DesignFamily => (RECIPE_DESIGN_FAMILIES as readonly string[]).includes(value));
  if (!used.includes(suggested)) return suggested;
  const alternatives = RECIPE_DESIGN_FAMILIES.filter((family) => !used.includes(family));
  if (alternatives.length) return alternatives[0];
  // If all families were recently used, choose the least recently used one.
  return used[used.length - 1] || suggested;
}
export function chooseRecipeFamily(suggested: DesignFamily, recent: readonly string[], hasReference: boolean): DesignFamily {
  // A reference's analyzed style takes priority over automatic rotation.
  if (hasReference) return suggested;
  const curated: DesignFamily[] = ["black_label", "notebook", "retro_diner", "heritage"];
  const preferred = suggested === "minimal" || suggested === "farmhouse" ? "heritage" : suggested;
  if (!recent.slice(0, 5).includes(preferred)) return preferred;
  return curated.find(f => !recent.slice(0, 5).includes(f)) || preferred;
}
export const CURATED_DESIGN_FAMILIES:readonly DesignFamily[]=["black_label","notebook","retro_diner","heritage"];
/** Structural art direction. Photos and titles are supplied separately at render time. */
export const RECIPE_STYLE_SPECS:Record<"black_label"|"notebook"|"retro_diner"|"heritage",{composition:string;typeHierarchy:string;surface:string;ornaments:string}>={
  black_label:{composition:"Large original photo above a deep navy archival title panel; panel and photo meet at a slim seam, not in an inset card.",typeHierarchy:"A large, tightly fitted cream display serif title, with restrained gold keylines and generous negative space.",surface:"Midnight blue printed stock with a warm cream photo mat and subtle worn edges.",ornaments:"Offset corner fillets, a centered diamond rule, and small engraved leaf strokes outside the photo."},
  notebook:{composition:"Full-size original photo above a cream recipe index card, with a small tab at the seam.",typeHierarchy:"Exact short title split into a smaller first phrase and an oversized final word when it fits; varied display-serif and typewriter roles.",surface:"Lined warm paper over a dark wood-tone field, with paper shadows and a restrained worn texture.",ornaments:"A tiny gingham tab, hand-drawn rules, and sparse botanical corner marks in the title area."},
  retro_diner:{composition:"An oversized asymmetrical cream headline sign above the photo, connected by a red gingham seam.",typeHierarchy:"Two-word titles fill one bold sign line; three- or four-word titles use a smaller opening phrase and large final word; longer titles wrap.",surface:"Aged cream print with oxblood ink, a darker offset silhouette and a warm photo edge.",ornaments:"Checker strip, angled sign corners, and a few abstract engraved flourishes; no illustrated people or props."},
  heritage:{composition:"Near edge-to-edge original photo above a cream botanical folio placard with strong display type.",typeHierarchy:"One commanding, readable dark-red serif headline; exact wording and casing only.",surface:"Parchment stock, olive and burgundy inks, fine double rules, quiet paper speckles.",ornaments:"Paired leaf-branch marks and clipped corner details confined to the border and title area."},
};
export type DesignPhotoAspect="square"|"portrait"|"landscape";
export function recipeDesignAspect(width:number,height:number):DesignPhotoAspect {
  return width>height*1.08?"landscape":height>width*1.08?"portrait":"square";
}
export function recipeDesignSignature(family:DesignFamily,placement:"top"|"bottom",aspect:DesignPhotoAspect):string {
  return `fabric-v2|${family}|${placement}|${aspect}`;
}
/** In Auto, keep the reference's family where possible while avoiding recent arrangements. */
export function avoidRecentRecipeLayout(family:DesignFamily,placement:"top"|"bottom",aspect:DesignPhotoAspect,recent:readonly string[]):{family:DesignFamily;placement:"top"|"bottom"} {
  const used=recent.slice(0,5);
  for(const candidate of [family,...CURATED_DESIGN_FAMILIES.filter(f=>f!==family)]) {
    const preferred=candidate===family?placement:(candidate==="black_label" || candidate==="retro_diner"?"top":"bottom");
    const alternatives:["top"|"bottom","top"|"bottom"]=[preferred,preferred==="top"?"bottom":"top"];
    for(const position of alternatives) if(!used.includes(recipeDesignSignature(candidate,position,aspect)))return {family:candidate,placement:position};
  }
  return {family,placement};
}
export function chooseLocalRecipeFamily(title:string,width:number,height:number,recent:readonly string[]):DesignFamily {
  const text=title.toLowerCase();
  const suggested:DesignFamily=height>width*1.25?"heritage":title.length>36?"retro_diner":/soup|stew|broth/.test(text)?"notebook":/casserole|bake|chicken/.test(text)?"retro_diner":"black_label";
  const order=[suggested,...CURATED_DESIGN_FAMILIES.filter(f=>f!==suggested)];
  return order.find(f=>!recent.slice(0,3).includes(f)) || order.find(f=>f!==recent[0]) || suggested;
}
export function artworkPrompt(plan: DesignPlan, strength: string): string {
  return `Create a nonrepresentational printed-material texture for an original food-blog recipe graphic. This is not a poster, not a photograph and not a scene.\nDesign family: ${plan.family}. Concept: ${plan.concept || plan.layout}. Layout: ${plan.layout}. Typography character: ${plan.typography}. Palette: ${plan.palette.join(", ")}. Materials: ${plan.material || "printed paper"}. Decoration: ${plan.decoration}. Style strength: ${strength}. ${plan.styleDNA ? `Reference style cues: ${Object.values(plan.styleDNA).join("; ")}.` : ""}\nUse subtle paper grain, ink, aged pigment and abstract color. Keep edges quiet and the center open; the app will independently draw the frame and typography. Absolutely no objects, bowls, plates, food, ingredients, hands, cutlery, dishes, furniture, scenery, photographs, letters, words, numbers, watermarks, logos or recognizable marks. Never reproduce an uploaded reference. The owner's photo and exact title are added separately by code.`;
}

export const DESIGN_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    family: { type: "string", enum: [...RECIPE_DESIGN_FAMILIES] },
    palette: { type: "array", minItems:2, maxItems:5, description:"Two to five six-digit hex colors, such as #F5EAD6.", items: { type: "string", pattern:"^#[0-9a-fA-F]{6}$" } },
    typography: { type: "string" }, layout: { type: "string" }, decoration: { type: "string" },
    referenceSummary: { type: "string" }, photoSummary: { type: "string" }, researchSummary: { type: "string" },
    concept: {type:"string"}, material: {type:"string"}, difference: {type:"string"},
    typographyPair: {type:"string",enum:["heritage_slab","notebook_serif","diner_slab","editorial_serif"]},
    titlePlacement: {type:"string",enum:["top","bottom"]},
    evidenceMode: {type:"string",enum:["uploaded_reference","text_research","inference"]},
    styleDNA:{type:"object",additionalProperties:false,properties:{photoLayout:{type:"string"},titleHierarchy:{type:"string"},palette:{type:"string"},labelAndFrame:{type:"string"},ornaments:{type:"string"},mood:{type:"string"}},required:["photoLayout","titleHierarchy","palette","labelAndFrame","ornaments","mood"]},
  },
  required: ["family", "palette", "typography", "layout", "decoration", "referenceSummary", "photoSummary", "researchSummary", "concept", "material", "difference", "typographyPair", "titlePlacement", "evidenceMode", "styleDNA"],
} as const;
