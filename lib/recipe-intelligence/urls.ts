import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as [string, number][]) blocked.addSubnet(address, prefix, "ipv4");
// Exclude special protocol ranges as well as private/documentation addresses.
// Registry: https://www.iana.org/assignments/iana-ipv6-special-registry/
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as [string, number][]) blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return !blocked.check(address, "ipv4");
  if (isIP(address) !== 6) return false;
  const first = parseInt(address.split(":")[0], 16);
  return first >= 0x2000 && first <= 0x3fff && !blocked.check(address, "ipv6");
}

export function publicUrl(input: string, base?: string): URL {
  if (typeof input !== "string" || input.length > 4096 || /[\x00-\x20\x7f]/.test(input)) throw new Error("Invalid public URL.");
  const url = new URL(input, base);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
    !host.includes(".") && !isIP(host) || /(?:^|\.)(localhost|local|internal|home|lan)$/.test(host) ||
    isIP(host) && !isPublicAddress(host)) throw new Error("Use a public HTTP or HTTPS website on its standard port.");
  return url;
}

export function normalizeUrl(input: string, base?: string): string {
  const url = publicUrl(input, base);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

export function normalizeSite(input: string): string {
  const text = input.trim();
  const url = publicUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  url.search = ""; url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function sameSite(a: string, b: string): boolean {
  try {
    const clean = (s: string) => publicUrl(s).hostname.toLowerCase().replace(/^www\./, "");
    return clean(a) === clean(b);
  } catch { return false; }
}

export function sourceUrl(input: string, base: string): string | null {
  try { return normalizeUrl(input.trim(), base); } catch { return null; }
}
