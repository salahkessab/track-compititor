import { randomUUID, createHash } from "node:crypto";
import { IntelligenceStore } from "./database";
import { dayInZone, extractArticle, parsePublication, validDay, type ArticleEvidence, type PublicationDate } from "./article";
import { normalizeUrl, sameSite } from "./urls";
import type { DiscoveryFetcher } from "./types";

const now = () => new Date().toISOString();
const SEGMENT = 250;
export class ReportStore {
  constructor(public store: IntelligenceStore) {}
  get(id: string): any {
    const report = this.store.db.prepare("SELECT * FROM reports WHERE id=?").get(id) as any;
    if (!report) throw new Error("Report not found.");
    return report;
  }
  create(input: { siteIds: string[]; from: string; to: string; timezone: string }): string {
    if (!validDay(input.from) || !validDay(input.to) || input.from > input.to) throw new Error("Choose a valid inclusive publication-date range.");
    new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
    const ids = [...new Set(input.siteIds)];
    if (!ids.length || ids.length > 10) throw new Error("Select 1 to 10 websites.");
    ids.forEach(id => { if (this.store.getSite(id).status !== "active") throw new Error("Activate selected websites before searching."); });
    return this.store.db.transaction(() => {
      const id = randomUUID();
      this.store.db.prepare("INSERT INTO reports(id,title,site_ids,from_date,to_date,timezone,status,created_at) VALUES(?,?,?,?,?,?,'running',?)")
        .run(id, `${input.from} to ${input.to}`, JSON.stringify(ids), input.from, input.to, input.timezone, now());
      for (const siteId of ids) {
        // Discovery is manual and belongs to this explicitly requested search.
        this.store.createScan(siteId);
      }
      this.sync(id, true); return id;
    }).immediate();
  }
  insertJob(reportId: string, siteId: string, kind: string, url: string, priority: number, recipeId: number | null = null) {
    this.store.db.prepare("INSERT OR IGNORE INTO report_jobs(report_id,site_id,kind,url,priority,recipe_id) VALUES(?,?,?,?,?,?)")
      .run(reportId, siteId, kind, normalizeUrl(url), priority, recipeId);
  }
  sync(id: string, includeCached = false) {
    const r = this.get(id);
    for (const siteId of JSON.parse(r.site_ids)) {
      const records = this.store.db.prepare(`SELECT r.*,
        (SELECT json_extract(o.evidence,'$.feedPublished') FROM recipe_observations o WHERE o.recipe_id=r.id AND json_extract(o.evidence,'$.feedPublished') IS NOT NULL ORDER BY o.id DESC LIMIT 1) AS feed_hint
        FROM recipe_records r WHERE r.site_id=? AND r.duplicate_of IS NULL AND
        ((? AND r.verification_status='verified') OR (r.verification_status!='verified' AND NOT EXISTS(SELECT 1 FROM report_jobs j WHERE j.report_id=? AND j.recipe_id=r.id))) ORDER BY r.id`).all(siteId, Number(includeCached), id) as any[];
      for (const record of records) {
        if (record.verification_status === "verified") this.include(r, record);
        else {
          const hint = parsePublication(record.feed_hint);
          const matchingHint = hint && dayInZone(hint, r.timezone) >= r.from_date && dayInZone(hint, r.timezone) <= r.to_date;
          this.insertJob(id, siteId, "article", record.canonical_url, matchingHint ? 5 : hint ? 15 : 20, record.id);
        }
      }
      const apis = this.store.db.prepare("SELECT url FROM discovery_sources WHERE site_id=? AND kind='wordpress_api'").all(siteId) as { url: string }[];
      for (const source of apis) {
        // Only advertised public endpoints qualify. A one-day margin avoids assuming a server timezone.
        const api = new URL(source.url);
        if (!sameSite(this.store.getSite(siteId).url, api.href)) continue;
        const after = new Date(Date.parse(r.from_date) - 86400000).toISOString().slice(0, 19);
        const before = new Date(Date.parse(r.to_date) + 2 * 86400000).toISOString().slice(0, 19);
        if (api.searchParams.has("rest_route")) api.searchParams.set("rest_route", "/wp/v2/posts");
        else api.pathname = api.pathname.replace(/\/?$/, "/") + "wp/v2/posts";
        api.searchParams.set("after", after); api.searchParams.set("before", before);
        api.searchParams.set("per_page", "100"); api.searchParams.set("page", "1");
        api.searchParams.set("_fields", "link,title,date,date_gmt,modified");
        this.insertJob(id, siteId, "wordpress", api.href, 0);
      }
    }
  }
  include(report: any, record: any) {
    if (record.verification_status !== "verified" || !record.publication_json) return;
    const day = dayInZone(JSON.parse(record.publication_json), report.timezone);
    if (day >= report.from_date && day <= report.to_date) this.store.db.prepare("INSERT OR IGNORE INTO report_items(report_id,recipe_id,added_at) VALUES(?,?,?)").run(report.id, record.id, now());
  }
  record(job: any, evidence: ArticleEvidence): number {
    return this.store.db.transaction(() => {
      let id = job.recipe_id as number;
      const original = this.store.db.prepare("SELECT * FROM recipe_records WHERE id=?").get(id) as any;
      if (!original) throw new Error("Recipe record disappeared.");
      const alias = this.store.db.prepare("SELECT recipe_id FROM recipe_url_aliases WHERE site_id=? AND url=?").get(job.site_id, evidence.canonical) as any;
      if (alias && alias.recipe_id !== id) {
        const destination = this.store.db.prepare("SELECT * FROM recipe_records WHERE id=?").get(alias.recipe_id) as any;
        // Canonical alias is verified from the article, never guessed from a redirect or path.
        this.store.db.prepare("UPDATE recipe_records SET duplicate_of=? WHERE id=?").run(destination.id, id);
        this.store.db.prepare("UPDATE recipe_url_aliases SET recipe_id=? WHERE recipe_id=?").run(destination.id, id);
        this.store.db.prepare("INSERT OR IGNORE INTO report_items SELECT report_id,?,added_at FROM report_items WHERE recipe_id=?").run(destination.id, id);
        this.store.db.prepare("DELETE FROM report_items WHERE recipe_id=?").run(id);
        id = destination.id;
        if (destination.publication_json && destination.verification_status === "verified" && evidence.publication) {
          const prior: PublicationDate = JSON.parse(destination.publication_json);
          if (dayInZone(prior, "UTC") < dayInZone(evidence.publication, "UTC")) evidence.publication = prior;
        }
      } else {
        const occupied = this.store.db.prepare("SELECT id FROM recipe_records WHERE site_id=? AND canonical_url=?").get(job.site_id, evidence.canonical) as any;
        // Retained duplicate rows may still be referenced by historical work.
        if (!occupied || occupied.id === id) this.store.db.prepare("UPDATE recipe_records SET canonical_url=? WHERE id=?").run(evidence.canonical, id);
        this.store.db.prepare("INSERT OR IGNORE INTO recipe_url_aliases(site_id,url,recipe_id) VALUES(?,?,?)").run(job.site_id, evidence.canonical, id);
      }
      const modified = evidence.dates.find(d => d.kind === "modified")?.parsed;
      this.store.db.prepare(`UPDATE recipe_records SET title=?,verification_status=?,publication_json=?,published_at=?,modified_at=?,verified_at=?,verification_reason=?,recipe_json=? WHERE id=?`)
        .run(evidence.title, evidence.status, evidence.publication ? JSON.stringify(evidence.publication) : null, evidence.publication?.utc || null,
          modified?.utc || null, now(), evidence.reason, evidence.recipe ? JSON.stringify(evidence.recipe) : null, id);
      this.store.db.prepare("INSERT INTO publication_evidence(recipe_id,fetched_url,at,evidence_json,classification,reason) VALUES(?,?,?,?,?,?)")
        .run(id, job.url, now(), JSON.stringify(evidence.dates), evidence.status, evidence.reason);
      // Re-verification removes stale membership before adding matches with the new evidence.
      this.store.db.prepare("DELETE FROM report_items WHERE recipe_id=?").run(id);
      const record = this.store.db.prepare("SELECT * FROM recipe_records WHERE id=?").get(id);
      for (const r of this.store.db.prepare("SELECT * FROM reports").all() as any[]) if (JSON.parse(r.site_ids).includes(job.site_id)) this.include(r, record);
      return id;
    }).immediate();
  }
  action(id: string, action: string) {
    const r = this.get(id);
    if (!["pause", "resume", "retry", "cancel"].includes(action)) throw new Error("Unknown report action.");
    if (action === "resume" || action === "retry") {
      if (r.status === "cancelled") throw new Error("Create a new report after cancellation.");
      if (action === "retry") this.store.db.prepare("UPDATE report_jobs SET state='queued',error=NULL,owner=NULL WHERE report_id=? AND state='failed'").run(id);
      this.sync(id);
      const done = (this.store.db.prepare("SELECT count(*) n FROM report_jobs WHERE report_id=? AND state IN ('done','failed')").get(id) as any).n;
      this.store.db.prepare("UPDATE reports SET status='running',completed_at=NULL,segment_start=? WHERE id=?").run(done, id);
    } else this.store.db.prepare("UPDATE reports SET status=? WHERE id=?").run(action === "pause" ? "paused" : "cancelled", id);
  }
  claim(owner: string): any {
    return this.store.db.transaction(() => {
      if (!this.store.db.prepare("SELECT 1 FROM worker_lease WHERE owner=? AND expires_at>?").get(owner, Date.now())) return null;
      const row = this.store.db.prepare(`SELECT j.* FROM report_jobs j JOIN reports r ON r.id=j.report_id JOIN tracked_sites s ON s.id=j.site_id
        WHERE j.state='queued' AND r.status='running' AND s.status='active' ORDER BY j.priority,j.id LIMIT 1`).get() as any;
      if (!row) return null;
      const r = this.get(row.report_id);
      const done = (this.store.db.prepare("SELECT count(*) n FROM report_jobs WHERE report_id=? AND state IN ('done','failed')").get(r.id) as any).n;
      if (done - r.segment_start >= SEGMENT) { this.action(r.id, "pause"); return null; }
      this.store.db.prepare("UPDATE report_jobs SET state='running',owner=?,attempts=attempts+1 WHERE id=?").run(owner, row.id);
      return { ...row, owner };
    }).immediate();
  }
  recover() { this.store.db.prepare("UPDATE report_jobs SET state='queued',owner=NULL WHERE state='running'").run(); }
  refresh() {
    for (const r of this.store.db.prepare("SELECT * FROM reports WHERE status='running'").all() as any[]) {
      this.sync(r.id);
      const ids: string[] = JSON.parse(r.site_ids);
      const scanPending = ids.some(id => !!this.store.db.prepare("SELECT 1 FROM scan_runs WHERE site_id=? AND status IN ('running','queued')").get(id));
      const pending = this.store.db.prepare("SELECT 1 FROM report_jobs WHERE report_id=? AND state IN ('queued','running')").get(r.id);
      if (!pending && !scanPending) this.store.db.prepare("UPDATE reports SET status='completed',completed_at=? WHERE id=?").run(now(), r.id);
    }
  }
  detail(id: string, page: number | null = 0) {
    const r = this.get(id); const ids: string[] = JSON.parse(r.site_ids);
    const stats = this.store.db.prepare(`SELECT count(*) total, COALESCE(sum(state='done'),0) processed, COALESCE(sum(state='failed'),0) errors,
      COALESCE(sum(state IN ('queued','running')),0) remaining FROM report_jobs WHERE report_id=?`).get(id) as any;
    const coverage = ["Incomplete coverage: processing every available source does not establish a complete historical archive."];
    for (const siteId of ids) {
      const site = this.store.getSite(siteId);
      if (site.status !== "active") coverage.push(`${site.name}: website is ${site.status}; pending work is retained.`);
      const sources = this.store.db.prepare("SELECT kind,status FROM discovery_sources WHERE site_id=?").all(siteId) as any[];
      if (sources.some(s => ["rss", "atom"].includes(s.kind))) coverage.push(`${site.name}: feeds may include only recent entries.`);
      if (!sources.length || sources.some(s => !["available", "not_found"].includes(s.status))) coverage.push(`${site.name}: some discovery sources are unavailable or unprocessed.`);
      const unresolved = (this.store.db.prepare("SELECT count(*) n FROM recipe_records WHERE site_id=? AND duplicate_of IS NULL AND verification_status!='verified'").get(siteId) as any).n;
      if (unresolved) coverage.push(`${site.name}: ${unresolved} URLs lack verified recipe publication dates.`);
    }
    const matches = (this.store.db.prepare("SELECT count(*) n FROM report_items WHERE report_id=?").get(id) as any).n;
    const rows = this.store.db.prepare(`SELECT x.id,x.title,x.canonical_url,x.publication_json,x.verification_reason,x.recipe_json,s.name site_name
      FROM report_items i JOIN recipe_records x ON x.id=i.recipe_id JOIN tracked_sites s ON s.id=x.site_id
      WHERE i.report_id=? ORDER BY i.added_at,x.id LIMIT ? OFFSET ?`).all(id, page === null ? -1 : 100, page === null ? 0 : page * 100) as any[];
    return { ...r, siteIds: ids, stats, coverage, matches, page: page || 0, pageSize: 100, processing: r.status === "completed" ? "Available sources processed" : "Processing available sources",
      rows: rows.map(x => ({ ...x, publication: JSON.parse(x.publication_json), recipe: x.recipe_json ? JSON.parse(x.recipe_json) : null })),
      errors: this.store.db.prepare("SELECT url,error FROM report_jobs WHERE report_id=? AND state='failed' LIMIT 100").all(id) };
  }
  list() { return this.store.db.prepare(`SELECT r.*, (SELECT count(*) FROM report_items i WHERE i.report_id=r.id) AS matches
    FROM reports r ORDER BY created_at DESC LIMIT 100`).all(); }
}

export class ReportEngine {
  constructor(public reports: ReportStore, private fetcher: DiscoveryFetcher, private owner: string) {}
  async process(job: any, signal?: AbortSignal) {
    const db = this.reports.store.db;
    const owns = () => !!db.prepare(`SELECT 1 FROM report_jobs j JOIN worker_lease w ON w.id=1 JOIN reports r ON r.id=j.report_id
      WHERE j.id=? AND j.state='running' AND j.owner=? AND w.owner=? AND w.expires_at>? AND r.status!='cancelled'`).get(job.id, this.owner, this.owner, Date.now());
    try {
      const response = await this.fetcher.get(job.url, { signal });
      if (response.status !== 200) throw new Error(`Source returned HTTP ${response.status}.`);
      if (signal?.aborted || !owns()) return;
      if (!sameSite(this.reports.store.getSite(job.site_id).url, response.url)) throw new Error("The source redirected outside this tracked website.");
      if (job.kind === "wordpress") {
        const posts = JSON.parse(response.body.toString("utf8"));
        if (!Array.isArray(posts) || posts.length > 100) throw new Error("Public posts API returned an unsupported page.");
        const pageHash = createHash("sha256").update(JSON.stringify(posts.map(p => p.link).sort())).digest("hex");
        if (posts.length && db.prepare("SELECT 1 FROM report_jobs WHERE report_id=? AND site_id=? AND kind='wordpress' AND page_hash=? AND id!=?").get(job.report_id, job.site_id, pageHash, job.id)) throw new Error("Public API pagination repeated a previous page.");
        db.transaction(() => {
          for (const post of posts) {
            if (typeof post.link !== "string" || !sameSite(job.url, post.link)) continue;
            const url = normalizeUrl(post.link);
            const sourceId = this.reports.store.ensureSource(job.site_id, job.url, "wordpress_results");
            const alias = db.prepare("SELECT recipe_id FROM recipe_url_aliases WHERE site_id=? AND url=?").get(job.site_id, url) as any;
            if (!alias) db.prepare("INSERT OR IGNORE INTO recipe_records(site_id,canonical_url,title,first_seen_at,last_seen_at,origin) VALUES(?,?,?,?,?,'baseline_existing')")
              .run(job.site_id, url, String(post.title?.rendered || "").slice(0, 500), now(), now());
            const recipeId = alias?.recipe_id || (db.prepare("SELECT id FROM recipe_records WHERE site_id=? AND canonical_url=?").get(job.site_id, url) as any).id;
            db.prepare("INSERT OR IGNORE INTO recipe_url_aliases(site_id,url,recipe_id) VALUES(?,?,?)").run(job.site_id, url, recipeId);
            db.prepare("INSERT OR IGNORE INTO recipe_observations(recipe_id,source_id,run_id,observed_at,evidence) VALUES(?,?,?,?,?)")
              .run(recipeId, sourceId, job.report_id, now(), JSON.stringify({ apiPublicationHint: post.date, apiUtcHint: post.date_gmt, reason: "Candidate only; article evidence required." }));
            this.reports.insertJob(job.report_id, job.site_id, "article", url, 1, recipeId);
            db.prepare("UPDATE report_jobs SET priority=1 WHERE report_id=? AND kind='article' AND url=?").run(job.report_id, url);
          }
          if (posts.length === 100) {
            const next = new URL(job.url); const page = Number(next.searchParams.get("page"));
            if (page >= 100) throw new Error("Public API pagination reached the 100-page limit.");
            next.searchParams.set("page", String(page + 1)); this.reports.insertJob(job.report_id, job.site_id, "wordpress", next.href, 2);
          }
          db.prepare("UPDATE report_jobs SET page_hash=? WHERE id=?").run(pageHash, job.id);
        }).immediate();
      } else {
        const record = db.prepare("SELECT * FROM recipe_records WHERE id=?").get(job.recipe_id) as any;
        const feeds = (db.prepare("SELECT evidence FROM recipe_observations WHERE recipe_id=? ORDER BY id DESC LIMIT 30").all(job.recipe_id) as any[])
          .flatMap(o => { try { const v = JSON.parse(o.evidence); return v.feedPublished ? [v.feedPublished] : []; } catch { return []; } });
        const evidence = extractArticle(response.body.toString("utf8"), response.url, feeds, record?.publication_json ? JSON.parse(record.publication_json) : null);
        this.reports.record(job, evidence);
      }
      if (owns()) db.prepare("UPDATE report_jobs SET state='done',error=NULL,owner=NULL WHERE id=?").run(job.id);
    } catch (e) {
      if (owns()) db.prepare("UPDATE report_jobs SET state=?,error=?,owner=NULL WHERE id=?")
        .run(signal?.aborted ? "queued" : "failed", signal?.aborted ? null : (e instanceof Error ? e.message : "Article inspection failed.").slice(0, 500), job.id);
    } finally {
      if (signal?.aborted && owns()) db.prepare("UPDATE report_jobs SET state='queued',owner=NULL WHERE id=?").run(job.id);
    }
  }
}
