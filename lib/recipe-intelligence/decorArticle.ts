import { load } from 'cheerio';
import { discoverPhotos } from './imports';
import { publicUrl } from './urls';
import { escapeHtml } from './artifacts';
import { DECOR_ARTICLE_SKILL, DECOR_IMAGE_SKILL, DECOR_VERSION } from './decorPrompts';
import type { ContentSettings } from './settings';
import { ARTICLE_TITLE_SECTION, decorSections, photoSourceKey, type DecorSection } from './decorSections';

export type DecorSource = { title: string; url: string; text: string; photos: { url: string; caption: string; sourceSectionId?: string }[]; sections?: DecorSection[]; textTruncated?: boolean };
const noise = 'script,style,nav,aside,footer,form,.author,.author-box,.related-posts,.related-recipes,.recommended,.advertisement,[class*="newsletter"],[class*="sidebar"],[class*="related"],[class*="recommend"],[class*="author-bio"],[class*="social"],[class*="share"]';
export function extractDecor(html: string, url: string): DecorSource {
  if (Buffer.byteLength(html) > 5_000_000) throw new Error('Article exceeds the import limit.');
  const $ = load(html);
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const candidates = discoverPhotos(html, url);
  $(noise).remove();
  const body = $('[itemprop="articleBody"],article .entry-content,article .post-content,.entry-content,.post-content,article,main').first();
  if (body.find('h2,h3,h4,h5,h6').length > 80) throw new Error('This article has more than 80 headings. Import a shorter article or supply the section text you need.');
  const { sections, photoSections } = decorSections($, body, url);
  const photos = candidates.map(photo => ({ ...photo, sourceSectionId: photoSections.get(photoSourceKey(photo.url, url)) || ARTICLE_TITLE_SECTION }));
  const fullText = body.find('h2,h3,h4,h5,h6,p,li').map((_i, el) => $(el).text().trim()).get().filter(Boolean).join('\n\n');
  const text=fullText.slice(0,40000);
  if (!title || text.length < 300) throw new Error('Could not read the article body. Paste its text and upload reference photos below.');
  return { title: title.slice(0, 300), url: publicUrl(url).href, text, photos, sections, ...(fullText.length>40000?{textTruncated:true}:{}) };
}
export const DECOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, seoTitle: { type: 'string' }, metaDescription: { type: 'string' }, slug: { type: 'string' }, introduction: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { sourceSectionId: { type: 'string' }, heading: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } } }, required: ['sourceSectionId', 'heading', 'paragraphs'] } },
    notes: { type: 'array', items: { type: 'string' } },
    imagePlans: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' }, relevant: { type: 'boolean' }, kitchen: { type: 'boolean' }, subject: { type: 'string' }, reason: { type: 'string' }, alt: { type: 'string' }, section: { type: 'integer' },
    }, required: ['id', 'relevant', 'kitchen', 'subject', 'reason', 'alt', 'section'] } },
  }, required: ['title', 'seoTitle', 'metaDescription', 'slug', 'introduction', 'sections', 'notes', 'imagePlans'],
};
export function decorWritingPayload(source: DecorSource, photos: any[], settings: ContentSettings, brief: string) {
  return { model: settings.textModel, store: false, reasoning: { effort: 'none' }, max_output_tokens: 6500,
    instructions: `${DECOR_VERSION}\n${DECOR_ARTICLE_SKILL}\nSection indices are zero-based; -1 means the introduction under the article title. Return exactly one image plan for each supplied photo ID. When source.sections are supplied, retain every source section as one output section with the exact sourceSectionId, even if it has no selected photo. Headings may be rewritten but must retain their topic. Do not merge or omit those sections. If there are no source sections, use unique sourceSectionId values section-1, section-2, etc. Each relevant photo must be placed in the section with its sourceSectionId; article-title goes in the introduction. Check the visible subject against that heading and its paragraphs. If it does not match, mark it irrelevant; never move it to fill another section.`,
    text: { format: { type: 'json_schema', name: 'home_decor_article', strict: true, schema: DECOR_SCHEMA } },
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ source: { title: source.title, text: source.text, sections: source.sections || [] }, designBrief: brief, references: photos.map(p => ({ id: p.id, caption: p.caption, group: p.group, sourceSectionId: p.sourceSectionId, sourceHeading: source.sections?.find(s => s.id === p.sourceSectionId)?.heading || source.title })) }) }, ...photos.flatMap(p => [{ type: 'input_text', text: `Reference ${p.id}; room group: ${p.group}` }, { type: 'input_image', image_url: p.dataUrl, detail: 'high' }])] }] };
}
export function decorImagePrompt(plan: any, brief: string, group: string, article?: any) {
  const section = plan.sectionId ? article?.sections.find((s: any) => s.id === plan.sectionId) : article?.sections[plan.section];
  const context = article ? { title: article.title, heading: section?.heading || article.title, text: (section?.paragraphs || [article.introduction]).join("\n\n").slice(0, 10000) } : undefined;
  return `${DECOR_VERSION}\n${DECOR_IMAGE_SKILL}\nApproved design brief: ${brief}\nRoom group: ${group}\nVisible subject and article placement: ${JSON.stringify(plan)}\nLinked article context: ${JSON.stringify(context)}\nIllustrate only this linked topic; do not borrow a different section's subject.\nImage 1 is this view's original reference. If supplied, image 2 is an earlier generated view from the same room group, for consistent styling only.`;
}
export function validateDecorArticle(value: any, photoIds: string[], source?: DecorSource, photos: { id: string; sourceSectionId?: string }[] = []) {
  const text = (v: unknown, max = 12000): string => {
    if (typeof v !== 'string' || v.length > max || /<\/?[a-z][^>]*>/i.test(v)) throw new Error('The article returned invalid text. The paid response was saved.');
    return v.trim();
  };
  if (!value || !Array.isArray(value.sections) || value.sections.length < (source?.sections?.length ? 1 : 2) || value.sections.length > 80 || !Array.isArray(value.imagePlans) || value.imagePlans.length !== photoIds.length) throw new Error('The saved response has an incomplete article or image plan.');
  const sectionIds = value.sections.map((s: any, index: number) => s.sourceSectionId === undefined && !source?.sections?.length ? `section-${index + 1}` : s.sourceSectionId);
  if (sectionIds.some((id: unknown) => typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id) || id === ARTICLE_TITLE_SECTION) || new Set(sectionIds).size !== sectionIds.length) throw new Error('Article section identities are missing or repeated.');
  if (source?.sections?.length && (sectionIds.length !== source.sections.length || source.sections.some(s => !sectionIds.includes(s.id)))) throw new Error('The article omitted or changed a source section. Text-only sections must be retained.');
  const article = { title: text(value.title, 300), seoTitle: text(value.seoTitle, 200), metaDescription: text(value.metaDescription, 400), slug: text(value.slug, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-'), introduction: text(value.introduction),
    sections: value.sections.map((s: any, index: number) => { if (!Array.isArray(s.paragraphs) || !s.paragraphs.length || s.paragraphs.length > 20 || !text(s.heading, 300) || s.paragraphs.some((p: any) => !text(p))) throw new Error('Invalid article section.'); return { id: sectionIds[index], heading: text(s.heading, 300), paragraphs: s.paragraphs.map((p: any) => text(p)) }; }),
    notes: Array.isArray(value.notes) ? value.notes.slice(0, 20).map((s: any) => text(s, 2000)) : [],
    imagePlans: value.imagePlans.map((p: any) => {
      if (!photoIds.includes(p.id) || typeof p.relevant !== 'boolean' || typeof p.kitchen !== 'boolean' || !Number.isInteger(p.section) || p.section < -1 || p.section >= value.sections.length) throw new Error('Image plan does not match the selected references.');
      const sectionId = p.section === -1 ? ARTICLE_TITLE_SECTION : sectionIds[p.section];
      const reference = photos.find(photo => photo.id === p.id);
      if (p.relevant && reference?.sourceSectionId && reference.sourceSectionId !== sectionId) throw new Error('An image was assigned to a different heading than its source. The saved response was not accepted.');
      return { id: p.id, relevant: p.relevant, kitchen: p.kitchen, subject: text(p.subject, 3000), reason: text(p.reason, 1000), alt: text(p.alt, 500), section: p.section, sectionId };
    }),
  };
  if (!article.title || !article.introduction || new Set(article.imagePlans.map((p: any) => p.id)).size !== photoIds.length) throw new Error('Article or reference mapping is incomplete.');
  return article;
}
export function decorHtml(article: any, images: { id: string; url: string }[]) {
  const figures = (sectionId: string, index: number) => article.imagePlans
    .filter((p: any) => p.relevant !== false && (p.sectionId ? p.sectionId === sectionId : p.section === index) && images.some(img => img.id === p.id))
    .map((p: any) => `<figure><img src="${escapeHtml(images.find(img => img.id === p.id)!.url)}" alt="${escapeHtml(p.alt)}" loading="lazy"></figure>`).join('');
  const sections = article.sections.map((s: any, i: number) => `<section><h2>${escapeHtml(s.heading)}</h2>${s.paragraphs.map((p: string) => `<p>${escapeHtml(p)}</p>`).join('')}${figures(s.id || `section-${i + 1}`, i)}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(article.seoTitle)}</title><meta name="description" content="${escapeHtml(article.metaDescription)}"><style>body{font:18px/1.7 system-ui;max-width:860px;margin:40px auto;padding:20px;color:#18202b}img{max-width:100%;height:auto}h1,h2{line-height:1.2}figure{margin:24px 0}</style></head><body><article><h1>${escapeHtml(article.title)}</h1><p>${escapeHtml(article.introduction)}</p>${figures(ARTICLE_TITLE_SECTION, -1)}${sections}</article></body></html>`;
}
