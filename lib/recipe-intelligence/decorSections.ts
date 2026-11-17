import type { CheerioAPI } from 'cheerio';

export const ARTICLE_TITLE_SECTION = 'article-title';
export type DecorSection = { id: string; heading: string; paragraphs: string[] };
export function photoSourceKey(raw: string, base: string) {
  if (!raw.trim()) return '';
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    url.pathname = url.pathname.replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp)$)/i, '');
    for (const key of ['w','h','width','height','resize','fit','quality','q','crop']) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return ''; }
}

// Section identity comes from the source DOM, never the selected-photo index.
// Retain text-only sections and repeated headings as separate source sections.
export function decorSections($: CheerioAPI, body: ReturnType<CheerioAPI>, base: string) {
  const sections: DecorSection[] = [], photoSections = new Map<string, string>();
  let current: DecorSection | undefined, currentId = ARTICLE_TITLE_SECTION, length = 0;
  body.find('h2,h3,h4,h5,h6,p,li,img').each((_i, el) => {
    const node = $(el), tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const urls = ['src','data-src','data-lazy-src','data-original'].map(key => node.attr(key) || '');
      for (const value of [node.attr('srcset'), node.attr('data-srcset'), ...node.closest('picture').find('source').map((_j, s) => $(s).attr('srcset') || '').get()]) {
        for (const part of (value || '').split(/,\s*/)) urls.push(part.trim().split(/\s+/)[0]);
      }
      for (const raw of urls) { const key = photoSourceKey(raw, base); if (key && !photoSections.has(key)) photoSections.set(key, currentId); }
      return;
    }
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const available = Math.max(0, 40000 - length); length += text.length + 2;
    if (/^h[2-6]$/.test(tag)) {
      // Do not attach later images to an earlier heading when text was truncated.
      current = undefined; currentId = 'unmapped';
      if (!available || sections.length >= 80) return;
      current = { id: `source-section-${sections.length + 1}`, heading: text.slice(0, 300), paragraphs: [] };
      currentId = current.id;
      sections.push(current);
    } else if (current && available) current.paragraphs.push(text.slice(0, available));
  });
  return { sections, photoSections };
}
