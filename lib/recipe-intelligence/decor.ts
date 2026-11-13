import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prepareImage, readVerifiedImage, retryImage, ImagePreparationError } from '../verifiedImages';
import { ArtifactStore } from './artifacts';
import { checkImageProcessing } from '../imageMetadata';
import sharp from 'sharp';
import { IntelligenceStore } from './database';
import { atomicWrite, digest } from './artifacts';
import { storagePath } from './paths';
import { publicUrl } from './urls';
import { contentSettings, type ContentSettings } from './settings';
import { actualCost, outputText, stageEstimate, ProviderFailure, type ContentProvider } from './provider';
import { referenceImageEstimate } from './referenceImages';
import type { DiscoveryFetcher } from './types';
import { createZip } from './zip';
import { DECOR_VERSION } from './decorPrompts';
import { extractDecor, decorWritingPayload, decorImagePrompt, validateDecorArticle, decorHtml, type DecorSource } from './decorArticle';
import { refineArticle, REFINEMENT_VERSION, REFINEMENT_INPUT_LIMIT, type RefinementReport } from './refinement';

const now = () => new Date().toISOString();
const MAX_SELECTED = 12;
type Photo = { id: string; caption: string; group: string; path: string; selected: boolean; width: number; height: number; output?: string; error?: string; phase?: string; preparationId?: string };
type Job = { id: string; state: string; createdAt: string; updatedAt: string; source: DecorSource; photos: Photo[]; brief: string; settings: ContentSettings; quote?: any; limit?: number; article?: any; refinement?: RefinementReport; error?: string; warnings: string[]; archived?: boolean };
export class DecorStore {
  constructor(public store: IntelligenceStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS decor_jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decor_calls(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES decor_jobs(id),stage TEXT NOT NULL,state TEXT NOT NULL,reserved REAL NOT NULL,actual REAL,request_id TEXT,receipt TEXT,error TEXT,UNIQUE(job_id,stage));`);
  }
  get(id: string): Job {
    const row = this.store.db.prepare('SELECT * FROM decor_jobs WHERE id=?').get(id) as any;
    if (!row) throw new Error('Home & Decor article not found.');
    return { ...JSON.parse(row.data_json), id: row.id, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private save(job: Job) {
    job.updatedAt = now();
    this.store.db.prepare('UPDATE decor_jobs SET state=?,updated_at=?,data_json=? WHERE id=?').run(job.state, job.updatedAt, JSON.stringify(job), job.id);
  }
  list() { return (this.store.db.prepare('SELECT id FROM decor_jobs ORDER BY created_at DESC LIMIT 200').all() as any[]).map(r => this.detail(r.id)); }
  detail(id: string) {
    const job = this.get(id);
    const calls = this.store.db.prepare('SELECT stage,state,reserved,actual,error FROM decor_calls WHERE job_id=?').all(id) as any[];
    return { ...job, source: { title: job.source.title, url: job.source.url, text: job.source.text }, photos: job.photos.map(({ path, output, ...p }) => ({ ...p, originalUrl: `/api/recipe-intelligence/decor/${id}/photo/${p.id}`, outputUrl: output ? `/api/recipe-intelligence/decor/${id}/output/${p.id}` : null })),
      calls, actual: calls.reduce((n, c) => n + (c.actual || 0), 0), held: calls.filter(c => c.actual === null && c.state !== 'rejected').reduce((n, c) => n + c.reserved, 0) };
  }
  create(url: unknown, text?: unknown) {
    const sourceUrl = publicUrl(String(url || '')).href;
    if (text !== undefined && (typeof text !== 'string' || text.trim().length < 300 || text.length > 40000)) throw new Error('Paste 300–40,000 characters of article text, starting with its title.');
    const id = randomUUID();
    const pasted = typeof text === 'string' ? text.trim() : '';
    const job: Job = { id, state: pasted ? 'review' : 'import_queued', createdAt: now(), updatedAt: now(), source: { title: pasted ? pasted.split('\n')[0].slice(0, 300) : 'Importing article…', url: sourceUrl, text: pasted, photos: [] }, photos: [],
      brief: 'Natural daylight, realistic lived-in rooms. Muted sage, warm oak and warm white accents. Keep each room group consistent.', settings: contentSettings(this.store), warnings: [] };
    this.store.db.prepare('INSERT INTO decor_jobs VALUES(?,?,?,?,?)').run(id, job.state, job.createdAt, job.updatedAt, JSON.stringify(job));
    return this.detail(id);
  }
  private editable(job: Job) { if (job.state !== 'review' || this.store.db.prepare('SELECT 1 FROM decor_calls WHERE job_id=?').get(job.id)) throw new Error('This article has already been queued or generated. Create a new import to change its references.'); }
  private async photo(job: Job, bytes: Buffer, caption: string, sourceUrl?: string) {
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Reference photos must be under 10 MB.');
    const input = sharp(bytes, { limitInputPixels: 40_000_000 }); const meta = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || !meta.width || !meta.height || meta.width < 160 || meta.height < 120 || (meta.pages || 1) > 1) throw new Error('Use a still JPEG, PNG or WebP of at least 160 × 120 pixels.');
    const data = await input.rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    const hash = digest(data.data);
    if (job.photos.some(p => p.path.endsWith(`-${hash}.png`))) return;
    const id = randomUUID(), path = `articles/home-decor/${job.id}/reference-${id}-${hash}.png`;
    atomicWrite(this.store.root, path, data.data);
    job.photos.push({ id, caption: caption.slice(0, 1000), group: 'room-1', path, selected: false, width: data.info.width, height: data.info.height });
  }
  async upload(id: string, bytes: Buffer, caption: string) {
    const job = this.get(id); this.editable(job);
    if (job.photos.length >= 30) throw new Error('Keep up to 30 reference candidates.');
    await this.photo(job, bytes, caption);
    // An upload can overlap a selection request; never overwrite a newer quote or approval.
    this.store.db.transaction(() => { const current = this.get(id); this.editable(current); if (current.updatedAt !== job.updatedAt) throw new Error('The selection changed during upload. Please upload again.'); delete job.quote; this.save(job); }).immediate();
    return this.detail(id);
  }
  select(id: string, input: any) {
    return this.store.db.transaction(() => {
      const job = this.get(id); this.editable(job);
      if (!Array.isArray(input.photos) || input.photos.length > MAX_SELECTED || new Set(input.photos.map((p: any) => p.id)).size !== input.photos.length || input.photos.some((p: any) => !job.photos.some(photo => photo.id === p.id) || typeof p.group !== 'string' || !/^[a-zA-Z0-9 _-]{1,40}$/.test(p.group))) throw new Error('Choose up to 12 original photos and valid room groups.');
      if (typeof input.brief !== 'string' || input.brief.length > 2000) throw new Error('Use a design brief of up to 2,000 characters.');
      job.brief = input.brief.trim();
      job.photos.forEach(p => { const selected = input.photos.find((s: any) => s.id === p.id); p.selected = !!selected; if (selected) p.group = selected.group; });
      const settings = contentSettings(this.store);
      job.settings = { ...settings, output: input.photos.length ? 'article_images' : 'article_only', images: input.photos.length > 0 };
      const photos = job.photos.filter(p => p.selected);
      if (photos.length && /\bkitchen\b/i.test(job.source.title)) throw new Error('Kitchen design uses editable local Blender models. Choose article only here; kitchen images are not sent to a paid image API.');
      const payload = decorWritingPayload(job.source, photos.map(p => ({ ...p, dataUrl: '' })), job.settings, job.brief);
      const lines: any[] = [{ stage: 'article', ...stageEstimate('article', job.settings, Buffer.byteLength(JSON.stringify(payload)) + photos.length * 10000) }];
      lines.push({ stage: 'refinement', profile: REFINEMENT_VERSION, ...stageEstimate('refinement', job.settings, REFINEMENT_INPUT_LIMIT) });
      for (const photo of photos) lines.push({ stage: photo.id, ...referenceImageEstimate(job.settings, decorImagePrompt({ subject: ' '.repeat(3000) }, job.brief, photo.group), 12000) });
      job.quote = { version: randomUUID(), profile: DECOR_VERSION, lines, estimated: lines.reduce((n, l) => n + l.estimated, 0), limit: Math.ceil(lines.reduce((n, l) => n + l.reservation, 0) * 100) / 100 };
      this.save(job); return this.detail(id);
    }).immediate();
  }
  approve(id: string, version: unknown) {
    return this.store.db.transaction(() => {
      const job = this.get(id); this.editable(job);
      if (!job.quote || job.quote.version !== version || job.quote.profile !== DECOR_VERSION) throw new Error('Confirm photo selection and review the current estimate first.');
      job.limit = job.quote.limit; job.state = 'queued'; this.save(job); return this.detail(id);
    }).immediate();
  }
  archive(id: string, value: unknown) { const job = this.get(id); if (typeof value !== 'boolean') throw new Error('Choose Archive or Restore.'); if (['queued', 'running', 'importing', 'import_queued'].includes(job.state)) throw new Error('Wait for the current work before archiving.'); job.archived = value; this.save(job); return this.detail(id); }
  remove(id: string) {
    return this.store.db.transaction(() => {
    const job = this.get(id);
    if (['importing', 'queued', 'running'].includes(job.state)) throw new Error('Wait for the current request before deleting this article.');
    // Delete only this UUID-owned directory; storagePath checks junctions and root containment.
    if (!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Invalid article folder.');
    const folder = storagePath(this.store.root, 'articles', 'home-decor', job.id);
    fs.rmSync(folder, { recursive: true, force: true });
    this.store.db.prepare('DELETE FROM decor_calls WHERE job_id=?').run(id); this.store.db.prepare('DELETE FROM decor_jobs WHERE id=?').run(id);
    return { deleted: true };
    }).immediate();
  }
  file(id: string, photoId: string, output: boolean) {
    const photo = this.get(id).photos.find(p => p.id === photoId);
    const relative = output ? photo?.output : photo?.path;
    if (!relative) throw new Error('Photo is not available.');
    return fs.readFileSync(storagePath(this.store.root, relative));
  }
  async exportedFile(id: string, photoId: string) { return (await new ArtifactStore(this.store).prepareSavedImage(this.file(id, photoId, true))).data; }
  async retryPreparation(id: string, photoId: string) {
    const job = this.get(id), photo = job.photos.find(p => p.id === photoId);
    if (!photo?.preparationId) throw new Error('This photo has no saved preparation to retry.');
    const ready = await retryImage(photo.preparationId, this.store.root), image = readVerifiedImage(ready.variants.webp!, this.store.root);
    photo.output = `articles/home-decor/${id}/generated-${photo.id}.webp`;
    atomicWrite(this.store.root, photo.output, image.data); delete photo.error; delete photo.preparationId; photo.phase = 'ready';
    job.state = 'queued'; delete job.error; this.save(job); return this.detail(id);
  }
  async document(id: string, zip = false) {
    const job = this.get(id); if (!job.article) throw new Error('The article is not ready.');
    const images = job.photos.filter(p => p.output);
    const html = decorHtml(job.article, images.map(p => ({ id: p.id, url: zip ? `image-${p.id}.webp` : `/api/recipe-intelligence/decor/${id}/output/${p.id}` })));
    const files = await Promise.all(images.map(async p => ({ name: `image-${p.id}.webp`, data: await this.exportedFile(id, p.id) })));
    return zip ? createZip([{ name: 'article.html', data: Buffer.from(html) }, ...files]) : Buffer.from(html);
  }
  recover() {
    this.store.db.prepare("UPDATE decor_jobs SET state='import_queued' WHERE state='importing'").run();
    this.store.db.prepare("UPDATE decor_jobs SET state='uncertain' WHERE state='running'").run();
    this.store.db.prepare("UPDATE decor_calls SET state='uncertain',error='Worker stopped; this request will not repeat automatically.' WHERE state='dispatched'").run();
  }
  claim(): string | null {
    return this.store.db.transaction(() => {
      const row = this.store.db.prepare("SELECT id,state FROM decor_jobs WHERE state IN ('import_queued','queued') ORDER BY created_at LIMIT 1").get() as any;
      if (!row) return null;
      this.store.db.prepare('UPDATE decor_jobs SET state=? WHERE id=?').run(row.state === 'import_queued' ? 'importing' : 'running', row.id);
      return row.id;
    }).immediate();
  }
  async process(id: string, fetcher: DiscoveryFetcher, provider: ContentProvider, signal?: AbortSignal) {
    const job = this.get(id);
    try {
      if (job.state === 'importing') {
        const response = await fetcher.get(job.source.url, { signal });
        if (response.status !== 200) throw new Error(`Website returned HTTP ${response.status}. Import by pasting the article text and uploading its reference photos.`);
        job.source = extractDecor(response.body.toString('utf8'), response.url);
        for (const candidate of job.source.photos) {
          if (signal?.aborted) throw new Error('Import interrupted.');
          try { const image = await fetcher.get(candidate.url, { signal }); if (image.status !== 200) throw new Error(`HTTP ${image.status}`); await this.photo(job, image.body, candidate.caption, candidate.url); }
          catch { job.warnings.push(`Could not import photo: ${candidate.caption || 'Uncaptioned image'}. You can upload it manually.`); }
        }
        job.state = 'review'; this.save(job); return;
      }
      if (job.state !== 'running') return;
      const photos = job.photos.filter(p => p.selected);
      if (!job.article) {
        const references = photos.map(p => ({ ...p, dataUrl: `data:image/png;base64,${this.file(id, p.id, false).toString('base64')}` }));
        const result = await this.call(job, 'article', 'text', decorWritingPayload(job.source, references, job.settings, job.brief), provider, signal);
        const canonical = { article: validateDecorArticle(JSON.parse(outputText(result)), photos.map(p => p.id)) };
        atomicWrite(this.store.root, `articles/home-decor/${id}/article-canonical.json`, JSON.stringify(canonical));
        const refined = await refineArticle(canonical, 'decor', job.settings.textModel, payload => this.call(job, 'refinement', 'text', payload, provider, signal));
        job.article = refined.article; job.refinement = refined.report;
        if (refined.report.status === 'rejected') job.warnings.push(refined.report.reason);
        atomicWrite(this.store.root, `articles/home-decor/${id}/editorial-refinement.json`, JSON.stringify(refined.report));
        atomicWrite(this.store.root, `articles/home-decor/${id}/article.json`, JSON.stringify(job.article));
        this.save(job);
      }
      for (const photo of photos) {
        if (signal?.aborted) throw new Error('Generation interrupted. Completed files are saved.');
        const plan = job.article.imagePlans.find((p: any) => p.id === photo.id);
        if (!plan.relevant || plan.kitchen || /\bkitchen\b/i.test(plan.subject)) { photo.error = plan.kitchen || /\bkitchen\b/i.test(plan.subject) ? 'Kitchen images require local Blender modeling; no paid image call was made.' : plan.reason || 'Not relevant to this article; skipped.'; this.save(job); continue; }
        if (photo.output) continue;
        const { partial_images, complexity, ...options } = job.settings.imageSettings;
        const sameRoom = photos.find(p => p.group === photo.group && p.output);
        const references = [`data:image/png;base64,${this.file(id, photo.id, false).toString('base64')}`, ...(sameRoom ? [`data:image/webp;base64,${this.file(id, sameRoom.id, true).toString('base64')}`] : [])];
        photo.phase = 'generating'; this.save(job);
        const result = await this.call(job, photo.id, 'image', { model: job.settings.imageModel, n: 1, ...options, ...(complexity && complexity !== 'default' ? { complexity } : {}), prompt: decorImagePrompt(plan, job.brief, photo.group), references }, provider, signal);
        const b64 = result.data?.[0]?.b64_json;
        if (typeof b64 !== 'string' || !b64.length || b64.length > 55_000_000) throw new Error('Image response has no usable image. The receipt was saved.');
        photo.phase = 'preparing'; this.save(job);
        let ready;
        try { ready = await prepareImage(Buffer.from(b64, 'base64'), { root: this.store.root, formats: ['png', 'webp'] }); }
        catch (e) { if (e instanceof ImagePreparationError) { photo.preparationId = e.assetId; photo.error = e.message; photo.phase = 'failed'; this.save(job); } throw e; }
        const data = readVerifiedImage(ready.variants.webp!, this.store.root).data;
        photo.output = `articles/home-decor/${id}/generated-${photo.id}.webp`;
        atomicWrite(this.store.root, photo.output, data); photo.phase = 'ready'; this.save(job);
      }
      job.state = 'completed'; delete job.error; this.save(job);
    } catch (error) {
      job.error = error instanceof Error ? error.message.slice(0, 400) : 'Operation failed.';
      job.state = this.store.db.prepare("SELECT 1 FROM decor_calls WHERE job_id=? AND state IN ('uncertain','dispatched')").get(id) ? 'uncertain' : 'failed';
      this.save(job);
    }
  }
  private async call(job: Job, stage: string, operation: 'text' | 'image', payload: any, provider: ContentProvider, signal?: AbortSignal) {
    const previous = this.store.db.prepare("SELECT receipt FROM decor_calls WHERE job_id=? AND stage=? AND state='complete'").get(job.id, stage) as any;
    if (previous?.receipt) return JSON.parse(fs.readFileSync(storagePath(this.store.root, previous.receipt), 'utf8')).body;
    if (operation === 'image') await checkImageProcessing();
    const id = randomUUID();
    this.store.db.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM decor_calls WHERE job_id=? AND stage=?').get(job.id, stage)) throw new Error('A request already exists for this step. It will not repeat automatically.');
      const line = job.quote?.lines.find((l: any) => l.stage === stage);
      const used = (this.store.db.prepare("SELECT COALESCE(SUM(CASE WHEN state='rejected' THEN 0 ELSE COALESCE(actual,reserved) END),0) total FROM decor_calls WHERE job_id=?").get(job.id) as any).total;
      if (!line || !job.limit || used + line.reservation > job.limit + 0.000001) throw new Error('The remaining approved budget is insufficient. Saved results are kept.');
      this.store.db.prepare("INSERT INTO decor_calls(id,job_id,stage,state,reserved) VALUES(?,?,?,'dispatched',?)").run(id, job.id, stage, line.reservation);
    }).immediate();
    try {
      const result = await provider.request(operation, payload, signal, requestId => this.store.db.prepare('UPDATE decor_calls SET request_id=? WHERE id=?').run(requestId, id), id);
      const receipt = `articles/home-decor/${job.id}/receipt-${id}.json`;
      atomicWrite(this.store.root, receipt, JSON.stringify(result));
      this.store.db.prepare("UPDATE decor_calls SET state='complete',actual=?,request_id=?,receipt=? WHERE id=?").run(actualCost(operation, payload.model, result.body), result.requestId, receipt, id);
      return result.body;
    } catch (error) {
      this.store.db.prepare('UPDATE decor_calls SET state=?,error=? WHERE id=?').run(error instanceof ProviderFailure && error.definitelyRejected ? 'rejected' : 'uncertain', 'Provider request failed; automatic retry is disabled.', id);
      throw error;
    }
  }
}
