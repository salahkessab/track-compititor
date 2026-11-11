export type SiteStatus = "active" | "paused" | "archived";
export type TaskKind = "robots" | "homepage" | "source";
export type RunStatus = "queued" | "running" | "paused" | "completed" | "partial" | "failed" | "cancelled";
export interface Site {
  id: string; name: string; url: string; status: SiteStatus; created_at: string;
  baseline_started_at: string | null; baseline_completed_at: string | null;
  last_scan_at: string | null; last_success_at: string | null;
}
export interface ScanItem {
  id: number; run_id: string; site_id: string; url: string; kind: TaskKind;
  depth: number; expected: number; attempts: number; state: string;
}
export interface Candidate {
  url: string; title?: string; feedPublished?: string; feedModified?: string; sitemapLastmod?: string;
}
export interface ParsedSource {
  kind: "rss" | "atom" | "sitemap" | "sitemap_index";
  candidates: Candidate[]; next: string[];
}
export interface FetchResult {
  url: string; status: number; body: Buffer; contentType: string;
  etag?: string; lastModified?: string; retryAfterMs?: number;
}
export interface FetchOptions {
  signal?: AbortSignal; etag?: string; lastModified?: string;
}
export interface DiscoveryFetcher {
  get(url: string, options?: FetchOptions): Promise<FetchResult>;
}
export class DiscoveryError extends Error {
  constructor(message: string, public retryable = false, public retryAfterMs = 0) { super(message); }
}
