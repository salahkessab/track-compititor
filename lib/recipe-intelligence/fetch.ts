import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { request as httpRequest } from "node:http";
import type { TcpSocketConnectOpts } from "node:net";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { Readable } from "node:stream";
import robotsParser from "robots-parser";
import { publicUrl, isPublicAddress } from "./urls";
import { DiscoveryError, type DiscoveryFetcher, type FetchOptions, type FetchResult } from "./types";

export const USER_AGENT = "RecipeIntelligence/1.0";
const MAX_WIRE_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 50 * 1024 * 1024;

export async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Request interrupted.");
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new Error("Request interrupted.")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.min(ms, 2_147_000_000));
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function decodeBody(body: Buffer, encoding: string, limit = MAX_XML_BYTES): Promise<Buffer> {
  const gzip = encoding === "gzip" || body[0] === 0x1f && body[1] === 0x8b;
  const decoder = gzip ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
  if (!decoder) {
    if (encoding && encoding !== "identity") throw new DiscoveryError("Unsupported response compression.");
    if (body.length > limit) throw new DiscoveryError("Response exceeds the size limit.");
    return body;
  }
  const output: Buffer[] = []; let total = 0;
  const stream = Readable.from([body]).pipe(decoder);
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > limit) throw new DiscoveryError("Decompressed response exceeds the size limit.");
      output.push(chunk);
    }
  } finally { stream.destroy(); }
  return Buffer.concat(output);
}

export async function resolvePublic(hostname: string): Promise<{ address: string; family: number }[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new DiscoveryError("DNS lookup timed out.", true)), 10_000); }),
    ]);
    if (!answers.length || answers.some(answer => !isPublicAddress(answer.address))) throw new DiscoveryError("Blocked non-public network destination.");
    return answers;
  } finally { if (timer) clearTimeout(timer); }
}

export function retryAfter(value?: string): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()) || 0;
}

export class PublicDiscoveryFetcher implements DiscoveryFetcher {
  private tails = new Map<string, Promise<void>>();
  private nextRequest = new Map<string, number>();
  private delays = new Map<string, number>();
  private policies = new Map<string, { expires: number; value: Promise<{ policy: ReturnType<typeof robotsParser>; result: FetchResult }> }>();
  private activeRequests = 0;

  constructor(private spacing = 2000) {}

  private async raw(input: string, options: FetchOptions): Promise<FetchResult & { location?: string }> {
    const url = publicUrl(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const prior = this.tails.get(host) || Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    this.tails.set(host, tail);
    await prior;
    let acquired = false;
    try {
      await pause(Math.max(0, (this.nextRequest.get(host) || 0) - Date.now()), options.signal);
      if (options.signal?.aborted) throw new Error("Request interrupted.");
      while (this.activeRequests >= 3) await pause(25, options.signal);
      this.activeRequests++; acquired = true;
      const chosen = await resolvePublic(url.hostname);
      this.nextRequest.set(host, Date.now() + Math.max(this.spacing, this.delays.get(host) || 0));
      const headers: Record<string, string> = {
        "User-Agent": USER_AGENT, Accept: "application/xml,application/rss+xml,application/atom+xml,application/json,text/xml,text/html,text/plain;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      };
      if (options.etag) headers["If-None-Match"] = options.etag;
      if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;
      const result = await new Promise<FetchResult & { location?: string; encoding: string }>((resolve, reject) => {
        const request = url.protocol === "https:" ? httpsRequest : httpRequest;
        const requestOptions: RequestOptions & Pick<TcpSocketConnectOpts, "autoSelectFamily" | "autoSelectFamilyAttemptTimeout"> = {
          // Keep every validated address pinned so Node can fall back from an
          // unreachable IPv6 route to IPv4 without performing another DNS lookup.
          headers, family: 0, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250,
          timeout: 15_000, signal: options.signal,
          lookup: ((_host: string, lookupOptions: any, callback: any) => lookupOptions?.all
            ? callback(null, chosen) : callback(null, chosen[0].address, chosen[0].family)),
        };
        const req = request(url, requestOptions, response => {
          const chunks: Buffer[] = []; let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_WIRE_BYTES) { req.destroy(new DiscoveryError("Response exceeds the download size limit.")); return; }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("aborted", () => reject(new DiscoveryError("Response was interrupted.", true)));
          response.on("end", () => resolve({
            url: url.href, status: response.statusCode || 0, body: Buffer.concat(chunks),
            contentType: String(response.headers["content-type"] || ""), encoding: String(response.headers["content-encoding"] || ""),
            location: response.headers.location, etag: response.headers.etag,
            lastModified: response.headers["last-modified"], retryAfterMs: retryAfter(response.headers["retry-after"]),
          }));
        });
        const timeout = setTimeout(() => req.destroy(new DiscoveryError("Request deadline exceeded.", true)), 30_000);
        req.on("timeout", () => req.destroy(new DiscoveryError("Website request timed out.", true)));
        req.on("error", reject); req.on("close", () => clearTimeout(timeout)); req.end();
      });
      if ([429, 503].includes(result.status) && result.retryAfterMs) this.nextRequest.set(host, Date.now() + result.retryAfterMs);
      if ([301, 302, 303, 307, 308, 304].includes(result.status)) return { ...result, body: Buffer.alloc(0) };
      return { ...result, body: await decodeBody(result.body, result.encoding, url.pathname === "/robots.txt" ? 512_000 : MAX_XML_BYTES) };
    } catch (error) {
      if (error instanceof DiscoveryError || options.signal?.aborted) throw error;
      throw new DiscoveryError("Website connection failed. Check availability and retry.", true);
    } finally { if (acquired) this.activeRequests--; release(); if (this.tails.get(host) === tail) this.tails.delete(host); }
  }

  private async chain(input: string, options: FetchOptions, checkRobots: boolean): Promise<FetchResult> {
    let url = publicUrl(input).href;
    const visited = new Set<string>();
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (visited.has(url)) throw new DiscoveryError("Redirect loop detected.");
      visited.add(url);
      if (checkRobots) {
        const { policy } = await this.robots(new URL(url).origin, options.signal);
        if (policy.isAllowed(url, USER_AGENT) === false) throw new DiscoveryError("Access disallowed by robots.txt.");
      }
      const response = await this.raw(url, options);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location) throw new DiscoveryError("Redirect has no destination.");
        url = publicUrl(response.location, url).href;
        // Validators describe one resource and must not be forwarded to an unrelated redirect target.
        options = { signal: options.signal };
      } else return response;
    }
    throw new DiscoveryError("Too many redirects.");
  }

  private async robots(origin: string, signal?: AbortSignal) {
    const cached = this.policies.get(origin);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = (async () => {
      const url = `${origin}/robots.txt`;
      const result = await this.chain(url, { signal }, false);
      if (![200, 404, 410].includes(result.status)) throw new DiscoveryError(`Cannot establish robots access (HTTP ${result.status}).`, result.status >= 500 || result.status === 429, result.retryAfterMs);
      const body = result.status === 200 ? result.body.toString("utf8") : "";
      if (/<!doctype html|<html[\s>]|verify you are human|checking your browser/i.test(body)) throw new DiscoveryError("Robots access returned a challenge or HTML page.");
      const policy = robotsParser(url, body);
      const delay = policy.getCrawlDelay(USER_AGENT);
      if (delay !== undefined && Number.isFinite(delay) && delay >= 0) {
        const host = new URL(origin).hostname.replace(/^www\./, "");
        this.delays.set(host, delay * 1000);
        this.nextRequest.set(host, Math.max(this.nextRequest.get(host) || 0, Date.now() + delay * 1000));
      }
      return { policy, result };
    })();
    this.policies.set(origin, { expires: Date.now() + 3_600_000, value });
    try { return await value; } catch (error) { this.policies.delete(origin); throw error; }
  }

  async get(input: string, options: FetchOptions = {}): Promise<FetchResult> {
    const url = publicUrl(input);
    if (url.pathname === "/robots.txt" && !url.search) return (await this.robots(url.origin, options.signal)).result;
    return this.chain(url.href, options, true);
  }
}
