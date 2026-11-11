import { SaxesParser } from "saxes";
import { load } from "cheerio";
import { sourceUrl } from "./urls";
import type { Candidate, ParsedSource } from "./types";

export function parseSource(xml: string, base: string): ParsedSource {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML document types and external entities are not accepted.");
  const parser = new SaxesParser({ xmlns: false });
  const stack: { name: string; text: string; base: string }[] = [];
  let kind: ParsedSource["kind"] | undefined;
  let current: (Candidate & { depth: number; container: string }) | null = null;
  const candidates: Candidate[] = [], next = new Set<string>();
  const addNext = (value: string, context: string) => { const url = sourceUrl(value, context); if (url) next.add(url); };
  parser.on("opentag", tag => {
    if (stack.length > 64) throw new Error("XML nesting is too deep.");
    const name = tag.name.split(":").pop()!.toLowerCase();
    const attributes = tag.attributes as Record<string, string>;
    const parentBase = stack.at(-1)?.base || base;
    const nodeBase = attributes["xml:base"] ? sourceUrl(attributes["xml:base"], parentBase) || parentBase : parentBase;
    stack.push({ name, text: "", base: nodeBase });
    if (stack.length === 1) {
      kind = name === "urlset" ? "sitemap" : name === "sitemapindex" ? "sitemap_index"
        : name === "feed" ? "atom" : ["rss", "rdf"].includes(name) ? "rss" : undefined;
      if (!kind) throw new Error("Response is not a supported RSS, Atom, or sitemap document.");
    }
    if (!current && ((kind === "sitemap" && name === "url") || (kind === "sitemap_index" && name === "sitemap")
      || (kind === "rss" && name === "item") || (kind === "atom" && name === "entry"))) {
      current = { url: "", depth: stack.length, container: name };
    }
    if (name === "link" && attributes.href) {
      const rel = (attributes.rel || "alternate").toLowerCase();
      if (!current && rel === "next") addNext(attributes.href, nodeBase);
      if (current && kind === "atom" && rel === "alternate" && (!attributes.type || /html/i.test(attributes.type))) {
        current.url = sourceUrl(attributes.href, nodeBase) || current.url;
      }
    }
  });
  const text = (value: string) => {
    if (!stack.length) return;
    const node = stack[stack.length - 1];
    if (node.text.length + value.length > 1_000_000) throw new Error("XML field is too large.");
    node.text += value;
  };
  parser.on("text", text); parser.on("cdata", text);
  parser.on("closetag", () => {
    const node = stack.at(-1)!;
    const value = node.text.trim();
    if (current && stack.length === current.depth + 1) {
      if (node.name === "loc" || kind === "rss" && node.name === "link") current.url = sourceUrl(value, node.base) || current.url;
      if (node.name === "title") current.title = load(value).text().trim().slice(0, 500);
      if (node.name === "pubdate" || node.name === "published" || kind === "rss" && node.name === "date") current.feedPublished = value.slice(0, 100);
      if (node.name === "updated") current.feedModified = value.slice(0, 100);
      if (node.name === "lastmod") current.sitemapLastmod = value.slice(0, 100);
    }
    if (current && node.name === current.container && stack.length === current.depth) {
      if (current.url) {
        if (kind === "sitemap_index") next.add(current.url);
        else { const { depth: _depth, container: _container, ...candidate } = current; candidates.push(candidate); }
      }
      current = null;
      if (candidates.length + next.size > 50_000) throw new Error("Source exceeds the 50,000-entry limit; coverage is incomplete.");
    }
    stack.pop();
  });
  // SAX events avoid constructing a DOM for large sitemaps.
  for (let offset = 0; offset < xml.length; offset += 65536) parser.write(xml.slice(offset, offset + 65536));
  parser.close();
  if (!kind) throw new Error("Empty source document.");
  return { kind, candidates, next: [...next] };
}

export function discoverHead(html: string, base: string): { feeds: string[]; apis: string[] } {
  if (Buffer.byteLength(html) > 2_000_000) throw new Error("Homepage exceeds the discovery size limit.");
  const $ = load(html), feeds = new Set<string>(), apis = new Set<string>();
  $("head link[href]").each((_index, element) => {
    const rel = ($(element).attr("rel") || "").toLowerCase();
    const type = ($(element).attr("type") || "").toLowerCase();
    const url = sourceUrl($(element).attr("href") || "", base);
    if (!url) return;
    if (rel.split(/\s+/).includes("sitemap") || rel.split(/\s+/).includes("alternate") && /application\/(rss\+xml|atom\+xml)/.test(type)) feeds.add(url);
    if (rel === "https://api.w.org/") apis.add(url);
  });
  if (feeds.size > 100 || apis.size > 20) throw new Error("Homepage advertises too many discovery sources.");
  return { feeds: [...feeds], apis: [...apis] };
}
