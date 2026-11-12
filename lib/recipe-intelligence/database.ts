import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { prepareRoot, storagePath } from "./paths";
import { normalizeSite, normalizeUrl, sameSite } from "./urls";
import type { Candidate, ScanItem, Site, SiteStatus, TaskKind } from "./types";
import { CURRENT_SCHEMA, MIGRATION_2, MIGRATION_3, MIGRATION_4, MIGRATION_5, MIGRATION_6, MIGRATION_7, MIGRATION_8 } from "./migrations";

const SCHEMA = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE tracked_sites (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, site_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('active','paused','archived')), created_at TEXT NOT NULL,
 baseline_started_at TEXT, baseline_completed_at TEXT, last_scan_at TEXT, last_success_at TEXT
);
CREATE TABLE discovery_sources (
 id INTEGER PRIMARY KEY, site_id TEXT NOT NULL REFERENCES tracked_sites(id), url TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'unknown', parent_url TEXT, status TEXT NOT NULL DEFAULT 'pending',
 discovered_at TEXT NOT NULL, last_checked_at TEXT, last_success_at TEXT, error TEXT,
 etag TEXT, last_modified TEXT, final_url TEXT, UNIQUE(site_id,url)
);
CREATE TABLE recipe_records (
 id INTEGER PRIMARY KEY, site_id TEXT NOT NULL REFERENCES tracked_sites(id), canonical_url TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('baseline_existing','later_discovery')),
 verification_status TEXT NOT NULL DEFAULT 'unverified', published_at TEXT, modified_at TEXT,
 UNIQUE(site_id,canonical_url)
);
CREATE TABLE recipe_url_aliases (
 site_id TEXT NOT NULL REFERENCES tracked_sites(id), url TEXT NOT NULL,
 recipe_id INTEGER NOT NULL REFERENCES recipe_records(id), PRIMARY KEY(site_id,url)
);
CREATE TABLE recipe_observations (
 id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL REFERENCES recipe_records(id),
 source_id INTEGER NOT NULL REFERENCES discovery_sources(id), run_id TEXT NOT NULL,
 observed_at TEXT NOT NULL, evidence TEXT NOT NULL, UNIQUE(recipe_id,source_id,run_id)
);
CREATE TABLE scan_runs (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES tracked_sites(id), status TEXT NOT NULL,
 is_baseline INTEGER NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
 coverage TEXT NOT NULL DEFAULT 'incomplete', message TEXT, segment_start INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_open_scan ON scan_runs(site_id) WHERE status IN ('queued','running','paused');
CREATE TABLE scan_items (
 id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES scan_runs(id), site_id TEXT NOT NULL REFERENCES tracked_sites(id),
 url TEXT NOT NULL, kind TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0, expected INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL DEFAULT 0, owner TEXT, error TEXT, UNIQUE(run_id,url,kind)
);
CREATE TABLE scan_events (
 id INTEGER PRIMARY KEY, run_id TEXT REFERENCES scan_runs(id), site_id TEXT REFERENCES tracked_sites(id),
 at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, url TEXT
);
CREATE TABLE worker_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL, heartbeat_at TEXT NOT NULL);
CREATE INDEX recipes_by_site_date ON recipe_records(site_id,published_at);
CREATE INDEX recipes_by_status ON recipe_records(site_id,verification_status);
CREATE INDEX recipes_history ON recipe_records(site_id,first_seen_at DESC,id DESC);
CREATE INDEX observations_recipe ON recipe_observations(recipe_id,source_id);
CREATE INDEX runnable_items ON scan_items(state,available_at,site_id);
CREATE INDEX runs_site ON scan_runs(site_id,created_at DESC);
CREATE INDEX events_run ON scan_events(run_id,id DESC);
PRAGMA user_version=1;
`;

const nowIso = () => new Date().toISOString();
const PROBES = ["feed/", "rss", "sitemap.xml", "sitemap_index.xml", "wp-sitemap.xml", "post-sitemap.xml"];
export const SOURCE_SEGMENT_SIZE = 500;

export class IntelligenceStore {
  private constructor(public db: Database.Database, public root: string) {}

  static async open(input: string): Promise<IntelligenceStore> {
    const root = prepareRoot(input);
    const db = new Database(storagePath(root, "database", "recipe-intelligence.sqlite"));
    db.pragma("busy_timeout = 5000"); db.pragma("foreign_keys = ON");
    const version = Number(db.pragma("user_version", { simple: true }));
    try {
      if (version > CURRENT_SCHEMA) throw new Error("This database needs a newer application version.");
      const sqlite = String((db.prepare("SELECT sqlite_version() AS version").get() as { version: string }).version).split(".").map(Number);
      if (sqlite[0] < 3 || sqlite[0] === 3 && (sqlite[1] < 51 || sqlite[1] === 51 && sqlite[2] < 3)) throw new Error("SQLite 3.51.3 or newer is required.");
      if (version === 0) {
        const recognized = db.transaction(() => {
          if (Number(db.pragma("user_version", { simple: true })) !== 0) return true;
          if ((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }).n) return false;
          db.exec(SCHEMA); return true;
        }).immediate();
        if (!recognized) {
          await db.backup(storagePath(root, "backups", `before-migration-${Date.now()}-${randomUUID()}.sqlite`));
          throw new Error("The selected database is not an empty Recipe Intelligence database. A backup was saved.");
        }
      }
      if (Number(db.pragma("user_version", { simple: true })) < 2) {
        if (version > 0) await db.backup(storagePath(root, "backups", `before-migration-2-${Date.now()}-${randomUUID()}.sqlite`));
        db.transaction(() => { if (Number(db.pragma("user_version", { simple: true })) < 2) db.exec(MIGRATION_2); }).immediate();
      }
      if (Number(db.pragma("user_version", { simple: true })) < 3) {
        if (version > 0) await db.backup(storagePath(root, "backups", `before-migration-3-${Date.now()}-${randomUUID()}.sqlite`));
        db.transaction(() => { if (Number(db.pragma("user_version", { simple: true })) < 3) db.exec(MIGRATION_3); }).immediate();
      }
      if (Number(db.pragma("user_version", { simple: true })) < 4) {
        if (version > 0) await db.backup(storagePath(root, "backups", `before-migration-4-${Date.now()}-${randomUUID()}.sqlite`));
        db.pragma("foreign_keys = OFF");
        try {
          db.transaction(() => {
            if (Number(db.pragma("user_version", { simple: true })) < 4) db.exec(MIGRATION_4);
            if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Migration foreign-key validation failed.");
          }).immediate();
        } finally { db.pragma("foreign_keys = ON"); }
      }
      if (Number(db.pragma("user_version", { simple: true })) < 5) {
        if (version > 0) await db.backup(storagePath(root, "backups", `before-migration-5-${Date.now()}-${randomUUID()}.sqlite`));
        db.transaction(() => { if (Number(db.pragma("user_version", { simple: true })) < 5) db.exec(MIGRATION_5); }).immediate();
      }
      if (Number(db.pragma("user_version", { simple: true })) < 6) {
        if (version > 0) await db.backup(storagePath(root, "backups", `before-migration-6-${Date.now()}-${randomUUID()}.sqlite`));
        db.transaction(() => { if (Number(db.pragma("user_version", { simple: true })) < 6) db.exec(MIGRATION_6); }).immediate();
      }
      if (Number(db.pragma("user_version", { simple: true })) < 7) {
        if (version > 0) await db.backup(storagePath(root, "backups", `before-migration-7-${Date.now()}-${randomUUID()}.sqlite`));
        db.transaction(() => { if (Number(db.pragma("user_version", { simple: true })) < 7) db.exec(MIGRATION_7); }).immediate();
      }
      if (Number(db.pragma("user_version", { simple: true })) < 8) {
        if (version > 0) await db.backup(storagePath(root, "backups", `before-migration-8-${Date.now()}-${randomUUID()}.sqlite`));
        db.transaction(() => { if (Number(db.pragma("user_version", { simple: true })) < 8) db.exec(MIGRATION_8); }).immediate();
      }
      db.pragma("journal_mode = WAL"); db.pragma("synchronous = FULL");
      const store = new IntelligenceStore(db, root);
      store.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('reporting_timezone','Africa/Casablanca')").run();
      store.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('workspace_id',?)").run(randomUUID());
      return store;
    } catch (error) { db.close(); throw error; }
  }

  close() { this.db.close(); }
  getSite(id: string): Site {
    const site = this.db.prepare("SELECT * FROM tracked_sites WHERE id=?").get(id) as Site | undefined;
    if (!site) throw new Error("Website not found.");
    return site;
  }
  addSite(name: string, input: string): Site {
    const url = normalizeSite(input);
    const parsed = new URL(url);
    const key = parsed.hostname.replace(/^www\./, "") + parsed.pathname;
    const title = name.trim() || parsed.hostname;
    if (title.length > 160 || /[\x00-\x1f]/.test(title)) throw new Error("Website name must contain at most 160 characters.");
    return this.db.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM tracked_sites WHERE site_key=?").get(key) as Site | undefined;
      if (existing && existing.status !== "archived") return existing;
      const count = (this.db.prepare("SELECT count(*) AS n FROM tracked_sites WHERE status!='archived'").get() as { n: number }).n;
      if (count >= 10) throw new Error("You can track up to 10 websites, including paused websites. Archive one before adding another.");
      if (existing) {
        this.db.prepare("UPDATE tracked_sites SET status='active', name=?, url=? WHERE id=?").run(title, url, existing.id);
        return this.getSite(existing.id);
      }
      const id = randomUUID();
      this.db.prepare("INSERT INTO tracked_sites(id,name,url,site_key,status,created_at) VALUES(?,?,?,?,'active',?)").run(id, title, url, key, nowIso());
      return this.getSite(id);
    }).immediate();
  }

  setSiteStatus(id: string, status: SiteStatus) {
    if (!["active", "paused", "archived"].includes(status)) throw new Error("Invalid website status.");
    const site = this.getSite(id);
    if (site.status === "archived" && status !== "archived") throw new Error("Add the website again to restore its history.");
    this.db.transaction(() => {
      this.db.prepare("UPDATE tracked_sites SET status=? WHERE id=?").run(status, id);
      if (status !== "active") this.db.prepare("UPDATE scan_runs SET status=?, message=? WHERE site_id=? AND status IN ('queued','running','paused')")
        .run(status === "archived" ? "cancelled" : "paused", status === "archived" ? "Website archived; history retained." : "Website paused.", id);
    }).immediate();
  }

  source(siteId: string, url: string): any {
    return this.db.prepare("SELECT * FROM discovery_sources WHERE site_id=? AND url=?").get(siteId, url);
  }

  ensureSource(siteId: string, url: string, kind = "unknown", parent: string | null = null): number {
    this.db.prepare(`INSERT INTO discovery_sources(site_id,url,kind,parent_url,discovered_at) VALUES(?,?,?,?,?)
      ON CONFLICT(site_id,url) DO UPDATE SET parent_url=COALESCE(discovery_sources.parent_url,excluded.parent_url)`).run(siteId, url, kind, parent, nowIso());
    return Number(this.source(siteId, url).id);
  }

  enqueue(runId: string, siteId: string, url: string, kind: TaskKind, depth = 0, expected = true, parent: string | null = null) {
    const normalized = normalizeUrl(url);
    this.ensureSource(siteId, normalized, kind === "source" ? "unknown" : kind, parent);
    if (depth > 8) {
      this.db.prepare("INSERT OR IGNORE INTO scan_items(run_id,site_id,url,kind,depth,expected,state,error) VALUES(?,?,?,?,?,?,'failed','Nested-source depth limit reached.')")
        .run(runId, siteId, normalized, kind, depth, Number(expected));
      this.log(runId, siteId, "warning", "Nested-source depth limit reached; coverage remains incomplete.", normalized);
      return;
    }
    this.db.prepare("INSERT OR IGNORE INTO scan_items(run_id,site_id,url,kind,depth,expected) VALUES(?,?,?,?,?,?)")
      .run(runId, siteId, normalized, kind, depth, Number(expected));
  }

  createScan(siteId: string): string {
    return this.db.transaction(() => {
      const site = this.getSite(siteId);
      if (site.status !== "active") throw new Error("Activate this website before scanning it.");
      const existing = this.db.prepare("SELECT id FROM scan_runs WHERE site_id=? AND status IN ('queued','running','paused')").get(siteId) as { id: string } | undefined;
      if (existing) return existing.id;
      const id = randomUUID(), at = nowIso();
      this.db.prepare("INSERT INTO scan_runs(id,site_id,status,is_baseline,created_at) VALUES(?,?,'queued',?,?)")
        .run(id, siteId, Number(!site.baseline_completed_at), at);
      this.db.prepare("UPDATE tracked_sites SET baseline_started_at=COALESCE(baseline_started_at,?),last_scan_at=? WHERE id=?").run(at, at, siteId);
      this.enqueue(id, siteId, new URL("/robots.txt", site.url).href, "robots");
      this.enqueue(id, siteId, site.url, "homepage", 0, false);
      for (const probe of PROBES) this.enqueue(id, siteId, new URL(probe, site.url).href, "source", 0, false);
      for (const source of this.db.prepare("SELECT url FROM discovery_sources WHERE site_id=? AND kind IN ('rss','atom','sitemap','sitemap_index')").all(siteId) as { url: string }[]) {
        this.enqueue(id, siteId, source.url, "source");
        this.db.prepare("UPDATE scan_items SET expected=1 WHERE run_id=? AND url=? AND kind='source'").run(id, source.url);
      }
      this.log(id, siteId, "info", "Manual discovery queued. Publication dates and recipe identity remain unverified.");
      return id;
    }).immediate();
  }

  runAction(id: string, action: string) {
    this.db.transaction(() => {
      const run = this.db.prepare("SELECT * FROM scan_runs WHERE id=?").get(id) as any;
      if (!run) throw new Error("Scan not found.");
      if (!["pause", "resume", "cancel", "retry"].includes(action)) throw new Error("Invalid scan action.");
      if (["resume", "retry"].includes(action) && this.getSite(run.site_id).status !== "active") throw new Error("Activate this website first.");
      if (action === "pause" && !["queued", "running"].includes(run.status)) throw new Error("Only a pending scan can be paused.");
      if (action === "resume" && run.status !== "paused") throw new Error("Only a paused scan can be resumed.");
      if (action === "cancel" && !["queued", "running", "paused"].includes(run.status)) throw new Error("This scan is already finished.");
      if (action === "retry") {
        if (!["partial", "failed"].includes(run.status)) throw new Error("Only scans with failures can be retried.");
        if (this.db.prepare("SELECT id FROM scan_runs WHERE site_id=? AND id!=? AND status IN ('queued','running','paused')").get(run.site_id, id)) throw new Error("Finish the newer scan before retrying this one.");
        this.db.prepare("UPDATE scan_items SET state='queued',attempts=0,available_at=0,error=NULL,owner=NULL WHERE run_id=? AND state IN ('failed','blocked') AND depth<=8").run(id);
      }
      const processed = (this.db.prepare("SELECT count(*) n FROM scan_items WHERE run_id=? AND state NOT IN ('queued','running')").get(id) as { n: number }).n;
      this.db.prepare("UPDATE scan_runs SET status=?,message=?,completed_at=NULL,segment_start=? WHERE id=?")
        .run(action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "queued", `Scan ${action} requested.`, processed, id);
      this.log(id, run.site_id, "info", `Scan ${action} requested.`);
    }).immediate();
  }

  acquireLease(owner: string, at = Date.now()): boolean {
    return this.db.transaction(() => {
      const lease = this.db.prepare("SELECT * FROM worker_lease WHERE id=1").get() as any;
      if (lease && lease.owner !== owner && lease.expires_at > at) return false;
      this.db.prepare("INSERT INTO worker_lease(id,owner,expires_at,heartbeat_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at,heartbeat_at=excluded.heartbeat_at")
        .run(owner, at + 90_000, new Date(at).toISOString());
      if (!lease || lease.owner !== owner) this.db.prepare("UPDATE scan_items SET state='queued',owner=NULL WHERE state='running'").run();
      return true;
    }).immediate();
  }
  heartbeat(owner: string) {
    return this.db.prepare("UPDATE worker_lease SET expires_at=?,heartbeat_at=? WHERE id=1 AND owner=?").run(Date.now() + 90_000, nowIso(), owner).changes === 1;
  }
  releaseLease(owner: string) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE scan_items SET state='queued',owner=NULL WHERE state='running' AND owner=?").run(owner);
      this.db.prepare("DELETE FROM worker_lease WHERE owner=?").run(owner);
    }).immediate();
  }

  claim(owner: string, excludedSites: string[] = []): ScanItem | null {
    return this.db.transaction(() => {
      const lease = this.db.prepare("SELECT owner FROM worker_lease WHERE id=1 AND expires_at>?").get(Date.now()) as any;
      if (lease?.owner !== owner) return null;
      const conditions = excludedSites.length ? ` AND i.site_id NOT IN (${excludedSites.map(() => "?").join(",")})` : "";
      const item = this.db.prepare(`SELECT i.* FROM scan_items i JOIN scan_runs r ON r.id=i.run_id JOIN tracked_sites s ON s.id=i.site_id
        WHERE i.state='queued' AND i.available_at<=? AND r.status IN ('queued','running') AND s.status='active' ${conditions}
        AND (i.kind='robots' OR NOT EXISTS(SELECT 1 FROM scan_items robots WHERE robots.run_id=i.run_id AND robots.kind='robots' AND robots.state IN ('queued','running')))
        ORDER BY i.available_at,i.id LIMIT 1`).get(Date.now(), ...excludedSites) as ScanItem | undefined;
      if (!item) return null;
      const run = this.db.prepare("SELECT segment_start FROM scan_runs WHERE id=?").get(item.run_id) as { segment_start: number };
      const n = (this.db.prepare("SELECT count(*) n FROM scan_items WHERE run_id=? AND state NOT IN ('queued','running')").get(item.run_id) as { n: number }).n;
      if (n - run.segment_start >= SOURCE_SEGMENT_SIZE) {
        this.db.prepare("UPDATE scan_runs SET status='paused',message='Source segment finished. Resume to process the remaining sources.' WHERE id=?").run(item.run_id);
        return null;
      }
      this.db.prepare("UPDATE scan_items SET state='running',owner=?,attempts=attempts+1 WHERE id=?").run(owner, item.id);
      this.db.prepare("UPDATE scan_runs SET status='running',started_at=COALESCE(started_at,?),message=NULL WHERE id=?").run(nowIso(), item.run_id);
      return { ...item, state: "running", attempts: item.attempts + 1 };
    }).immediate();
  }

  canCommit(item: ScanItem, owner: string): boolean {
    return !!this.db.prepare(`SELECT i.id FROM scan_items i JOIN scan_runs r ON r.id=i.run_id JOIN worker_lease w ON w.id=1
      WHERE i.id=? AND i.owner=? AND i.state='running' AND r.status!='cancelled' AND w.owner=? AND w.expires_at>?`).get(item.id, owner, owner, Date.now());
  }
  taskState(item: ScanItem, state: string, error: string | null = null, delay = 0) {
    this.db.prepare("UPDATE scan_items SET state=?,error=?,available_at=?,owner=NULL WHERE id=?").run(state, error, delay ? Date.now() + delay : 0, item.id);
  }
  sourceResult(item: ScanItem, result: { kind?: string; status: string; finalUrl?: string; etag?: string; lastModified?: string; error?: string }) {
    this.db.prepare(`UPDATE discovery_sources SET kind=COALESCE(?,kind),status=?,last_checked_at=?,
      last_success_at=CASE WHEN ?='available' THEN ? ELSE last_success_at END,
      etag=COALESCE(?,etag),last_modified=COALESCE(?,last_modified),final_url=COALESCE(?,final_url),error=? WHERE site_id=? AND url=?`)
      .run(result.kind ?? null, result.status, nowIso(), result.status, nowIso(), result.etag ?? null,
        result.lastModified ?? null, result.finalUrl ?? null, result.error ?? null, item.site_id, item.url);
  }

  recordCandidates(item: ScanItem, candidates: Candidate[]) {
    const site = this.getSite(item.site_id);
    const sourceId = this.ensureSource(item.site_id, item.url);
    const run = this.db.prepare("SELECT is_baseline FROM scan_runs WHERE id=?").get(item.run_id) as { is_baseline: number };
    const at = nowIso();
    const insert = this.db.prepare(`INSERT INTO recipe_records(site_id,canonical_url,title,first_seen_at,last_seen_at,origin) VALUES(?,?,?,?,?,?)
      ON CONFLICT(site_id,canonical_url) DO UPDATE SET last_seen_at=excluded.last_seen_at,title=CASE WHEN excluded.title!='' THEN excluded.title ELSE recipe_records.title END`);
    const find = this.db.prepare("SELECT id FROM recipe_records WHERE site_id=? AND canonical_url=?");
    const alias = this.db.prepare("INSERT OR IGNORE INTO recipe_url_aliases(site_id,url,recipe_id) VALUES(?,?,?)");
    const observe = this.db.prepare("INSERT OR IGNORE INTO recipe_observations(recipe_id,source_id,run_id,observed_at,evidence) VALUES(?,?,?,?,?)");
    for (const candidate of candidates) {
      let url: string;
      try { url = normalizeUrl(candidate.url); } catch { continue; }
      if (!sameSite(site.url, url)) continue;
      const known = this.db.prepare("SELECT recipe_id FROM recipe_url_aliases WHERE site_id=? AND url=?").get(item.site_id, url) as { recipe_id: number } | undefined;
      if (!known) insert.run(item.site_id, url, (candidate.title || "").slice(0, 500), at, at, run.is_baseline ? "baseline_existing" : "later_discovery");
      const id = known?.recipe_id ?? (find.get(item.site_id, url) as { id: number }).id;
      if (known) this.db.prepare("UPDATE recipe_records SET last_seen_at=? WHERE id=?").run(at, id);
      alias.run(item.site_id, url, id);
      observe.run(id, sourceId, item.run_id, at, JSON.stringify({ ...candidate, url, reason: "Discovered in a structured source; article and original publication date have not been verified." }));
    }
  }

  finalizeRuns() {
    this.db.transaction(() => {
      const runs = this.db.prepare(`SELECT r.* FROM scan_runs r WHERE r.status IN ('queued','running')
        AND NOT EXISTS(SELECT 1 FROM scan_items i WHERE i.run_id=r.id AND i.state IN ('queued','running'))`).all() as any[];
      for (const run of runs) {
        const valid = (this.db.prepare(`SELECT count(*) n FROM scan_items i JOIN discovery_sources s ON s.site_id=i.site_id AND s.url=i.url
          WHERE i.run_id=? AND i.state='done' AND s.kind IN ('rss','atom','sitemap','sitemap_index')`).get(run.id) as { n: number }).n;
        const failures = (this.db.prepare("SELECT count(*) n FROM scan_items WHERE run_id=? AND state IN ('failed','blocked')").get(run.id) as { n: number }).n;
        const status = !valid ? "failed" : failures ? "partial" : "completed";
        const message = !valid ? "No usable feed or sitemap was processed. Check source errors and try again." : failures
          ? "Some sources could not be processed. Stored URLs are retained; retry failed sources."
          : "Available sources processed. Recipe identity and publication dates remain unverified; historical coverage is unknown.";
        this.db.prepare("UPDATE scan_runs SET status=?,coverage=?,message=?,completed_at=? WHERE id=?")
          .run(status, status === "completed" ? "available_sources_processed" : "incomplete", message, nowIso(), run.id);
        if (status === "completed") this.db.prepare("UPDATE tracked_sites SET last_success_at=?,baseline_completed_at=COALESCE(baseline_completed_at,?) WHERE id=?")
          .run(nowIso(), nowIso(), run.site_id);
        this.log(run.id, run.site_id, status === "completed" ? "info" : "warning", message);
      }
    }).immediate();
  }

  log(runId: string | null, siteId: string | null, level: string, message: string, url: string | null = null) {
    this.db.prepare("INSERT INTO scan_events(run_id,site_id,at,level,message,url) VALUES(?,?,?,?,?,?)").run(runId, siteId, nowIso(), level, message.slice(0, 1000), url);
    this.db.prepare("DELETE FROM scan_events WHERE id < (SELECT COALESCE(max(id),0)-5000 FROM scan_events)").run();
  }

  snapshot() {
    const sites = this.db.prepare("SELECT * FROM tracked_sites WHERE status!='archived' ORDER BY created_at,id").all() as Site[];
    const runs = this.db.prepare(`SELECT r.*,s.name AS site_name,
      (SELECT count(*) FROM scan_items WHERE run_id=r.id) AS total,
      (SELECT count(*) FROM scan_items WHERE run_id=r.id AND state NOT IN ('queued','running')) AS processed,
      (SELECT count(*) FROM scan_items WHERE run_id=r.id AND state IN ('failed','blocked')) AS errors,
      (SELECT count(*) FROM scan_items WHERE run_id=r.id AND state IN ('queued','running')) AS remaining
      FROM scan_runs r JOIN tracked_sites s ON s.id=r.site_id ORDER BY r.created_at DESC,r.id LIMIT 50`).all();
    const lease = this.db.prepare("SELECT heartbeat_at,expires_at FROM worker_lease WHERE id=1").get() as any;
    return {
      sites: sites.map(site => ({ ...site,
        urls: (this.db.prepare("SELECT count(*) n FROM recipe_records WHERE site_id=?").get(site.id) as { n: number }).n,
        sources: this.db.prepare("SELECT * FROM discovery_sources WHERE site_id=? ORDER BY CASE status WHEN 'available' THEN 0 ELSE 1 END,id LIMIT 200").all(site.id),
      })), runs, worker: { online: !!lease && lease.expires_at > Date.now(), heartbeat_at: lease?.heartbeat_at ?? null },
      settings: { root: this.root, workspaceId: (this.db.prepare("SELECT value FROM settings WHERE key='workspace_id'").get() as { value: string }).value, timezone: (this.db.prepare("SELECT value FROM settings WHERE key='reporting_timezone'").get() as { value: string }).value },
    };
  }
  history(siteId: string, page = 0) {
    this.getSite(siteId);
    const offset = Math.min(Math.max(0, Math.floor(page)), 100_000) * 50;
    return {
      rows: this.db.prepare(`SELECT r.*,
        (SELECT group_concat(DISTINCT s.kind) FROM recipe_observations o JOIN discovery_sources s ON s.id=o.source_id WHERE o.recipe_id=r.id) AS sources,
        (SELECT o.evidence FROM recipe_observations o WHERE o.recipe_id=r.id ORDER BY o.id DESC LIMIT 1) AS evidence
        FROM recipe_records r WHERE r.site_id=? ORDER BY r.first_seen_at DESC,r.id DESC LIMIT 50 OFFSET ?`).all(siteId, offset),
      total: (this.db.prepare("SELECT count(*) n FROM recipe_records WHERE site_id=?").get(siteId) as { n: number }).n,
    };
  }
  events(runId?: string) {
    return runId ? this.db.prepare("SELECT * FROM scan_events WHERE run_id=? ORDER BY id DESC LIMIT 200").all(runId)
      : this.db.prepare("SELECT * FROM scan_events ORDER BY id DESC LIMIT 200").all();
  }
  updateTimezone(timezone: string) {
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new Error("Choose a valid IANA timezone."); }
    this.db.prepare("UPDATE settings SET value=? WHERE key='reporting_timezone'").run(timezone);
  }
  async backup(): Promise<string> {
    const name = `recipe-intelligence-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.sqlite`;
    const destination = storagePath(this.root, "backups", name);
    await this.db.backup(destination);
    const check = new Database(destination, { readonly: true });
    try { if (check.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Backup integrity check failed."); }
    finally { check.close(); }
    return name;
  }
  integrity() { return this.db.pragma("integrity_check", { simple: true }); }
}
