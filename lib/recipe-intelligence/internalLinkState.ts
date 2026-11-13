import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { IntelligenceStore } from './database';

export type LinkPost = { id: number; title: string; url: string; categories: string[]; summary: string; modified: string };
export type Catalogue = { posts: LinkPost[]; syncedAt: string; revision: string; index?: ReturnType<import('minisearch').default['toJSON']> };
export type Suggestion = LinkPost & { reason: string; sentence: string; paragraph: string | null };
export type LinkState = { connectionId: string; contentVersion: string; catalogueRevision: string; suggestions: Suggestion[]; selected: number[]; applied: boolean };
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function setting<T>(store: IntelligenceStore, key: string): T | null {
  const row = store.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as any;
  return row ? JSON.parse(row.value) : null;
}
export function saveSetting(store: IntelligenceStore, key: string, value: unknown) {
  store.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}
export function contentVersion(store: IntelligenceStore, itemId: string) {
  const row = store.db.prepare("SELECT a.sha256 FROM artifacts a JOIN content_items i ON i.id=a.item_id WHERE a.item_id=? AND a.name='article.html' AND i.state NOT IN ('deleted','deleting','delete_failed')").get(itemId) as any;
  if (!row) throw new Error('Save the recipe article before suggesting links.');
  return row.sha256 as string;
}
export function selectedLinks(store: IntelligenceStore, itemId: string, destination?: string): Suggestion[] {
  const state = setting<LinkState>(store, 'internal_links:' + itemId);
  if (!state?.applied || destination && state.connectionId !== destination || state.contentVersion !== contentVersion(store, itemId)) return [];
  if (!setting(store, 'wordpress_connection:' + state.connectionId)) return [];
  const catalogue = setting<Catalogue>(store, 'internal_catalogue:' + state.connectionId);
  // Deleted or changed destinations are never silently replaced with another URL.
  return state.suggestions.filter(s => state.selected.includes(s.id) && catalogue?.posts.some(p => p.id === s.id && p.url === s.url && p.title === s.title));
}
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function eligibleParagraphs(html: string) {
  const $ = cheerio.load(html);
  return $('article p').filter((_i, e) => {
    const p = $(e);
    if (p.closest('[data-ri-recipe-card],li,blockquote').length || p.find('a,img').length || p.children().length) return false;
    const heading = p.prevAll('h2,h3').first().text();
    return !/ingredient|instruction|how to make|recipe card|step/i.test(heading);
  }).map((_i, e) => $(e).text()).get();
}
export function renderLinks(html: string, links: Suggestion[]) {
  if (!links.length) return html;
  const $ = cheerio.load(html); const root = $('article').first();
  if (!root.length) return html;
  const seen = new Set(root.find('a[href]').map((_i, e) => $(e).attr('href')!).get());
  const eligible = new Set(eligibleParagraphs(html)); const related: Suggestion[] = [];
  for (const link of links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    const p = link.paragraph && eligible.has(link.paragraph) ? root.find('p').filter((_i, e) => $(e).text() === link.paragraph).first() : null;
    const at = link.paragraph?.toLowerCase().indexOf(link.title.toLowerCase()) ?? -1;
    if (p?.length && at >= 0) {
      const text = p.text();
      p.html(escape(text.slice(0, at)) + `<a href="${escape(link.url)}">${escape(text.slice(at, at + link.title.length))}</a>` + escape(text.slice(at + link.title.length)));
      eligible.delete(link.paragraph!);
    } else related.push(link);
  }
  if (related.length) root.append('<section data-ri-related="1"><h2>Related recipes</h2><ul>' + related.map(p => `<li><a href="${escape(p.url)}">${escape(p.title)}</a></li>`).join('') + '</ul></section>');
  return $.html();
}
export function linkedArtifact(store: IntelligenceStore, itemId: string, name: string, data: Buffer, destination?: string) {
  if (!['article.html', 'article.md', 'article.txt'].includes(name)) return data;
  const links = selectedLinks(store, itemId, destination);
  if (!links.length) return data;
  if (name === 'article.html') return Buffer.from(renderLinks(data.toString('utf8'), links));
  let text = data.toString('utf8'); const related: Suggestion[] = [];
  for (const link of links) {
    if (text.includes(link.url)) continue;
    if (name === 'article.md' && link.paragraph && text.includes(link.paragraph)) {
      const at = link.paragraph.toLowerCase().indexOf(link.title.toLowerCase());
      const p = link.paragraph;
      text = text.replace(p, p.slice(0, at) + `[${p.slice(at, at + link.title.length).replace(/[\\[\]]/g, '\\$&')}](${link.url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` + p.slice(at + link.title.length));
    } else related.push(link);
  }
  if (related.length) text += '\n\n' + (name === 'article.md' ? '## ' : '') + 'Related recipes\n\n' + related.map(p => name === 'article.md' ? `- [${p.title.replace(/[\\[\]]/g, '\\$&')}](${p.url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : `${p.title}: ${p.url}`).join('\n') + '\n';
  return Buffer.from(text);
}
