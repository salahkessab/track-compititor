import robotsParser from "robots-parser";
import { IntelligenceStore } from "./database";
import { discoverHead, parseSource } from "./discovery";
import { normalizeUrl, sameSite, sourceUrl } from "./urls";
import { DiscoveryError, type DiscoveryFetcher, type ScanItem } from "./types";

export class DiscoveryEngine {
  constructor(private store: IntelligenceStore, private fetcher: DiscoveryFetcher, private owner: string, private retryBaseMs = 2000) {}

  async process(item: ScanItem, signal?: AbortSignal): Promise<void> {
    try {
      const prior = this.store.source(item.site_id, item.url);
      const response = await this.fetcher.get(item.url, { signal,
        etag: prior?.last_success_at ? prior.etag : undefined,
        lastModified: prior?.last_success_at ? prior.last_modified : undefined,
      });
      if (signal?.aborted) throw new Error("Request interrupted.");
      if (response.status === 429 || response.status >= 500) throw new DiscoveryError(`Source returned HTTP ${response.status}.`, true, response.retryAfterMs);
      if ([401, 403].includes(response.status)) throw new DiscoveryError(`Source access is restricted (HTTP ${response.status}).`);
      if ([404, 410].includes(response.status) && item.kind !== "robots") {
        if (item.expected) throw new DiscoveryError(`Advertised or previously available source returned HTTP ${response.status}.`);
        this.store.db.transaction(() => {
          if (!this.store.canCommit(item, this.owner)) return;
          this.store.sourceResult(item, { status: "not_found" }); this.store.taskState(item, "skipped");
        }).immediate();
        return;
      }
      if (response.status === 304) {
        if (!prior?.last_success_at) throw new DiscoveryError("Source returned 304 without a saved successful checkpoint.");
        this.store.db.transaction(() => {
          if (!this.store.canCommit(item, this.owner)) return;
          // Revisit children even when the index itself has not changed.
          for (const child of this.store.db.prepare("SELECT url FROM discovery_sources WHERE site_id=? AND parent_url=?").all(item.site_id, item.url) as { url: string }[]) {
            this.store.enqueue(item.run_id, item.site_id, child.url, "source", item.depth + (prior.kind === "sitemap_index" ? 1 : 0), true, item.url);
          }
          this.store.sourceResult(item, { status: "available" }); this.store.taskState(item, "done");
          this.store.log(item.run_id, item.site_id, "info", "Source unchanged; saved discoveries retained.", item.url);
        }).immediate();
        return;
      }
      if (!(response.status >= 200 && response.status < 300) && !(item.kind === "robots" && [404, 410].includes(response.status))) {
        throw new DiscoveryError(`Unexpected source response (HTTP ${response.status}).`);
      }
      const text = response.body.toString("utf8").replace(/^\uFEFF/, "");
      if (/verify you are human|checking your browser|<title[^>]*>[^<]*(access denied|just a moment|sign in|log in)/i.test(text)) {
        throw new DiscoveryError("Source requires human verification or sign-in. No bypass was attempted.");
      }
      let next: string[] = [], apis: string[] = [];
      let parsed: ReturnType<typeof parseSource> | undefined;
      if (item.kind === "robots") {
        if (response.status === 200 && /<html[\s>]|<!doctype html/i.test(text)) throw new DiscoveryError("Expected robots.txt but received an HTML page.");
        next = response.status === 200 ? robotsParser(item.url, text).getSitemaps().map(value => sourceUrl(value, response.url)).filter((url): url is string => !!url) : [];
      } else if (item.kind === "homepage") {
        if (!sameSite(item.url, response.url)) throw new DiscoveryError("Homepage redirects to a different website. Add the destination as a separate site.");
        const head = discoverHead(text, response.url); next = head.feeds; apis = head.apis;
      } else {
        if (/^\s*(?:<!doctype html|<html[\s>])/i.test(text) && !item.expected) {
          this.store.db.transaction(() => {
            if (!this.store.canCommit(item, this.owner)) return;
            this.store.sourceResult(item, { status: "unsupported", error: "This guessed URL returned HTML, not a structured source." });
            this.store.taskState(item, "skipped");
          }).immediate();
          return;
        }
        parsed = parseSource(text, response.url); next = parsed.next;
      }
      this.store.db.transaction(() => {
        if (!this.store.canCommit(item, this.owner)) return;
        this.store.sourceResult(item, { kind: parsed?.kind || item.kind, status: "available", finalUrl: response.url,
          etag: response.etag, lastModified: response.lastModified });
        if (parsed) this.store.recordCandidates(item, parsed.candidates);
        for (const nextUrl of next) {
          this.store.enqueue(item.run_id, item.site_id, nextUrl, "source", item.depth + (parsed?.kind === "sitemap_index" ? 1 : 0), true, item.url);
          this.store.db.prepare("UPDATE scan_items SET expected=1 WHERE run_id=? AND url=? AND kind='source'").run(item.run_id, normalizeUrl(nextUrl));
        }
        for (const api of apis) this.store.ensureSource(item.site_id, api, "wordpress_api", item.url);
        this.store.taskState(item, "done");
        this.store.log(item.run_id, item.site_id, "info", parsed
          ? `Processed ${parsed.kind}: ${parsed.candidates.length} URL observations and ${parsed.next.length} linked sources. Articles remain unverified.`
          : item.kind === "robots" ? "Robots directives checked." : `Found ${next.length} advertised feeds/sitemaps and ${apis.length} public API links.`, item.url);
      }).immediate();
    } catch (error) {
      this.store.db.transaction(() => {
        if (!this.store.canCommit(item, this.owner)) {
          this.store.db.prepare("UPDATE scan_items SET state='queued',owner=NULL WHERE id=? AND owner=?").run(item.id, this.owner);
          return;
        }
        if (signal?.aborted) {
          this.store.db.prepare("UPDATE scan_items SET state='queued',owner=NULL,attempts=max(0,attempts-1) WHERE id=?").run(item.id);
          return;
        }
        const message = error instanceof Error ? error.message : "Source processing failed.";
        const retry = error instanceof DiscoveryError && error.retryable && item.attempts < 3;
        if (retry) {
          const wait = Math.max(error.retryAfterMs, this.retryBaseMs * 2 ** (item.attempts - 1));
          this.store.taskState(item, "queued", message, wait);
          this.store.log(item.run_id, item.site_id, "warning", `${message} Retry ${item.attempts + 1} of 3 queued.`, item.url);
        } else {
          this.store.taskState(item, "failed", message);
          this.store.sourceResult(item, { status: "error", error: message });
          this.store.log(item.run_id, item.site_id, "error", message, item.url);
          if (item.kind === "robots") this.store.db.prepare("UPDATE scan_items SET state='blocked',error='Robots access could not be established.' WHERE run_id=? AND state='queued'").run(item.run_id);
        }
      }).immediate();
    } finally { this.store.finalizeRuns(); }
  }
}
