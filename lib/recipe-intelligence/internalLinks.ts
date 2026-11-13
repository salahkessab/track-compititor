import fs from 'node:fs';
import MiniSearch from 'minisearch';
import * as cheerio from 'cheerio';
import { storagePath } from './paths';
import { WordPressStore } from './wordpress';
import { setting, saveSetting, contentVersion, eligibleParagraphs, hash, type Catalogue, type LinkPost, type LinkState, type Suggestion } from './internalLinkState';

const pending = new Map<string, Promise<Catalogue>>();
const stop = new Set('a an the and or with for of to in on is this that it your recipe recipes easy best make how'.split(' '));
const searchOptions = { fields: ['title', 'summary', 'categories'], processTerm: (term: string) => stop.has(term.toLowerCase()) ? null : term.toLowerCase(), searchOptions: { boost: { title: 4, categories: 2 }, prefix: false, fuzzy: false } };
function makeIndex(posts: LinkPost[]) { const index = new MiniSearch(searchOptions); index.addAll(posts.map(p => ({ ...p, categories: p.categories.join(' ') }))); return index; }
const terms = (s: string) => [...new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].filter(t => t.length > 2 && !stop.has(t));
const plain = (v: unknown, max: number) => { if (typeof v !== 'string' || v.length > max) throw new Error('Invalid WordPress article catalogue.'); return cheerio.load(v).text().trim(); };

export class InternalLinks {
  constructor(private wp: WordPressStore) {}
  private site(id: string) { const c = this.wp.status().connections.find(c => c.id === id); if (!c) throw new Error('Choose a connected WordPress website.'); return c; }
  async sync(id: string): Promise<Catalogue> {
    this.site(id); const key = this.wp.store.root + ':' + id;
    if (pending.has(key)) return pending.get(key)!;
    const run = this.fetchCatalogue(id); pending.set(key, run);
    try { return await run; } finally { pending.delete(key); }
  }
  private async fetchCatalogue(id: string) {
    const site = this.site(id); const posts: LinkPost[] = []; const ids = new Set<number>(), urls = new Set<string>();
    let revision = '', pages = 1, total = 0;
    for (let page = 1; page <= pages; page++) {
      const response = await this.wp.publishedArticles(id, page, revision || undefined);
      if (response.page !== page || !Number.isInteger(response.pages) || response.pages < 1 || response.pages > 500 || !Number.isInteger(response.total) || response.total < 0 || response.total > 50000 || typeof response.revision !== 'string' || !response.revision || response.revision.length > 100 || !Array.isArray(response.articles) || response.articles.length > 100) throw new Error('Invalid WordPress catalogue page. Previous index was kept.');
      if (page > 1 && (response.revision !== revision || response.pages !== pages || response.total !== total)) throw new Error('WordPress articles changed during sync. Retry Sync articles. Previous index was kept.');
      revision = response.revision; pages = response.pages; total = response.total;
      for (const p of response.articles) {
        if (!Number.isSafeInteger(p.id) || p.id < 1 || ids.has(p.id) || typeof p.url !== 'string' || p.url.length > 2048 || !Array.isArray(p.categories) || p.categories.length > 100) throw new Error('Invalid WordPress catalogue entry.');
        const url = new URL(p.url);
        if (url.origin !== new URL(site.siteUrl).origin || !url.pathname.startsWith(new URL(site.siteUrl).pathname) || url.protocol !== 'https:' || url.username || url.password) throw new Error('WordPress returned an article outside this website.');
        url.hash = '';
        if (urls.has(url.href)) throw new Error('Duplicate WordPress article URL.');
        const post = { id: p.id, url: url.href, title: plain(p.title, 2000), summary: plain(p.summary, 20000), categories: p.categories.map((c: unknown) => plain(c, 500)), modified: plain(p.modified, 100) };
        if (!post.title) throw new Error('A WordPress article has no title.');
        ids.add(p.id); urls.add(url.href); posts.push(post);
      }
    }
    if (posts.length !== total) throw new Error('Incomplete WordPress article sync. Previous index was kept.');
    const catalogue = { posts, index: makeIndex(posts).toJSON(), syncedAt: new Date().toISOString(), revision: hash(JSON.stringify(posts)) };
    this.site(id); // A disconnected site must not regain a cached catalogue.
    saveSetting(this.wp.store, 'internal_catalogue:' + id, catalogue);
    return catalogue;
  }
  private async fresh(id: string) {
    this.site(id); const saved = setting<Catalogue>(this.wp.store, 'internal_catalogue:' + id);
    return !saved || Date.now() - Date.parse(saved.syncedAt) >= 86400000 ? this.sync(id) : saved;
  }
  status(itemId: string, id: string) {
    this.site(id); const version = contentVersion(this.wp.store, itemId);
    const state = setting<LinkState>(this.wp.store, 'internal_links:' + itemId);
    const catalogue = setting<Catalogue>(this.wp.store, 'internal_catalogue:' + id);
    const valid = state?.connectionId === id && state.contentVersion === version && state.catalogueRevision === catalogue?.revision;
    return { ...(valid ? state : { suggestions: [], selected: [], applied: false }), connectionId: id, contentVersion: version, stale: !!state && !valid, count: catalogue?.posts.length || 0, syncedAt: catalogue?.syncedAt || null };
  }
  destination(itemId: string, id: string) {
    if (!id) { this.wp.store.db.prepare('DELETE FROM settings WHERE key=?').run('internal_links:' + itemId); return { suggestions: [], selected: [], applied: false }; }
    this.site(id); const version = contentVersion(this.wp.store, itemId);
    const state = setting<LinkState>(this.wp.store, 'internal_links:' + itemId);
    if (state && state.connectionId !== id) saveSetting(this.wp.store, 'internal_links:' + itemId, { connectionId: id, contentVersion: version, catalogueRevision: '', suggestions: [], selected: [], applied: false });
    return this.status(itemId, id);
  }
  async suggest(itemId: string, id: string) {
    const version = contentVersion(this.wp.store, itemId); const catalogue = await this.fresh(id);
    const row = this.wp.store.db.prepare("SELECT relative_path FROM artifacts WHERE item_id=? AND name='article.html'").get(itemId) as any;
    const html = fs.readFileSync(storagePath(this.wp.store.root, row.relative_path), 'utf8');
    if (hash(html) !== version || contentVersion(this.wp.store, itemId) !== version) throw new Error('The article changed. Suggest internal links again.');
    const $ = cheerio.load(html), title = $('article h1').first().text();
    const text = $('article').text(); const titleTerms = terms(title), query = [...titleTerms, ...terms(text).slice(0, 120)];
    const search = catalogue.index ? MiniSearch.loadJS(catalogue.index, searchOptions) : makeIndex(catalogue.posts);
    const existing = new Set($('a[href]').map((_i, e) => $(e).attr('href')!).get());
    const publication = this.wp.store.db.prepare('SELECT result_json FROM wordpress_exports WHERE item_id=? AND site_url=?').get(itemId, this.site(id).siteUrl) as any;
    const selfId = publication?.result_json ? JSON.parse(publication.result_json)?.postId : null;
    const paragraphs = eligibleParagraphs(html); const suggestions: Suggestion[] = [];
    for (const hit of search.search(query.join(' '))) {
      const post = catalogue.posts.find(p => p.id === hit.id)!;
      const shared = terms(post.title + ' ' + post.categories.join(' ')).filter(t => titleTerms.includes(t));
      // Require topical evidence beyond generic recipe prose; unrelated results are omitted.
      if (!shared.length || post.id === selfId || post.title.toLowerCase() === title.toLowerCase() || existing.has(post.url)) continue;
      const paragraph = paragraphs.find(p => p.toLowerCase().includes(post.title.toLowerCase())) || null;
      suggestions.push({ ...post, reason: 'Shared topic: ' + shared.slice(0, 4).join(', '), paragraph, sentence: paragraph || `Related recipes: ${post.title}` });
      if (suggestions.length === 5) break;
    }
    const state: LinkState = { connectionId: id, contentVersion: version, catalogueRevision: catalogue.revision, suggestions, selected: [], applied: false };
    saveSetting(this.wp.store, 'internal_links:' + itemId, state);
    return this.status(itemId, id);
  }
  async apply(itemId: string, input: Record<string, unknown>) {
    const id = String(input.connectionId || ''); const catalogue = await this.fresh(id);
    const state = setting<LinkState>(this.wp.store, 'internal_links:' + itemId);
    if (!state || state.connectionId !== id || state.contentVersion !== contentVersion(this.wp.store, itemId) || input.contentVersion !== state.contentVersion || state.catalogueRevision !== catalogue.revision) throw new Error('The content, destination or catalogue changed. Suggest internal links again.');
    if (!Array.isArray(input.selected) || input.selected.length > 5 || input.selected.some(n => !Number.isInteger(n) || !state.suggestions.some(s => s.id === n && catalogue.posts.some(p => p.id === n && p.url === s.url)))) throw new Error('Choose links from this website’s suggestions only.');
    state.selected = [...new Set(input.selected)] as number[]; state.applied = true;
    saveSetting(this.wp.store, 'internal_links:' + itemId, state);
    return this.status(itemId, id);
  }
}
