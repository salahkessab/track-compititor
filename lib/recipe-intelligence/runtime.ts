import { createHash, timingSafeEqual } from "node:crypto";

export function serverMode() { return process.env.RECIPE_INTELLIGENCE_MODE === "server"; }

export function serverKey(): Buffer {
  const value = process.env.RECIPE_INTELLIGENCE_SECRET_KEY || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("Set a permanent 32-byte base64 RECIPE_INTELLIGENCE_SECRET_KEY on the server.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Invalid server encryption key.");
  return key;
}

export function serverOrigin(): string {
  const value = process.env.RECIPE_INTELLIGENCE_ORIGIN || "";
  let url: URL; try { url = new URL(value); } catch { throw new Error("Set the public HTTPS Recipe Intelligence origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== value || !url.hostname.includes(".") || url.hostname === "localhost") throw new Error("Use an HTTPS origin without a path, credentials or query.");
  return value;
}

export function validateServerRuntime() {
  if (!serverMode()) throw new Error("Server mode is not enabled.");
  if (process.env.VERCEL) throw new Error("The server worker requires a persistent Node server; do not enable it in a Vercel function.");
  if (process.env.RECIPE_INTELLIGENCE_LOCAL === "1") throw new Error("Choose either server or local mode.");
  if (!process.env.APP_PASSWORD) throw new Error("Set APP_PASSWORD before starting the server.");
  serverKey(); serverOrigin();
  if (!process.env.RECIPE_INTELLIGENCE_ROOT) throw new Error("Set the persistent server storage directory.");
}

export function intelligenceEnabled() {
  if (serverMode()) { try { validateServerRuntime(); return true; } catch { return false; } }
  return process.env.RECIPE_INTELLIGENCE_LOCAL === "1" && !process.env.VERCEL && !!process.env.RECIPE_INTELLIGENCE_TOKEN;
}

export function serverAuthenticated(request: Request): boolean {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ") || header.length > 8192 || !process.env.APP_PASSWORD) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 1) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(process.env.APP_PASSWORD));
}
