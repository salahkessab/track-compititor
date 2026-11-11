import { request as httpsRequest, type RequestOptions } from "node:https";
import type { TcpSocketConnectOpts } from "node:net";
import { randomBytes } from "node:crypto";
import { resolvePublic } from "./fetch";
import { publicUrl } from "./urls";

export type WordPressRequest = { method: "GET" | "POST"; authorization?: string; contentType?: string; body?: Buffer };
export type WordPressResponse = { status: number; body: Buffer };
export type WordPressTransport = (url: string, options: WordPressRequest) => Promise<WordPressResponse>;

export function wordpressSite(input: unknown): string {
  if (typeof input !== "string") throw new Error("Enter your WordPress website address.");
  const text = input.trim();
  const url = publicUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (url.protocol !== "https:" || url.search || url.hash || /%(?:2e|2f|5c)/i.test(url.pathname) || /\/(?:wp-admin|wp-json)(?:\/|$)/i.test(url.pathname)) throw new Error("Use the HTTPS website address, without wp-admin, wp-json or query parameters.");
  return url.href.replace(/\/+$/, "") + "/";
}

// Credentials only go to the configured HTTPS host. Never follow redirects,
// including same-host redirects which might replay a non-idempotent POST.
export const wordpressRequest: WordPressTransport = async (input, options) => {
  const url = publicUrl(input);
  if (url.protocol !== "https:") throw new Error("WordPress connections require HTTPS.");
  const addresses = await resolvePublic(url.hostname);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: "application/json", "Accept-Encoding": "identity", "User-Agent": "RecipeIntelligence/1.0" };
    if (options.authorization) headers.Authorization = options.authorization;
    if (options.contentType) headers["Content-Type"] = options.contentType;
    if (options.body) headers["Content-Length"] = String(options.body.length);
    const requestOptions: RequestOptions & Pick<TcpSocketConnectOpts, "autoSelectFamily" | "autoSelectFamilyAttemptTimeout"> = {
      method: options.method, headers, agent: false, timeout: 30_000,
      family: 0, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250,
      lookup: (_hostname, lookupOptions, callback: any) => lookupOptions.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
    };
    const req = httpsRequest(url, requestOptions, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) { req.destroy(new Error("WordPress response exceeded its size limit.")); return; }
        chunks.push(chunk);
      });
      response.on("aborted", () => reject(new Error("WordPress response was interrupted.")));
      response.on("error", () => reject(new Error("WordPress response was interrupted.")));
      response.on("end", () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => req.destroy(new Error("WordPress request timed out.")), 120_000);
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => req.destroy(new Error("WordPress request timed out.")));
    req.on("error", () => reject(new Error("Could not complete the WordPress request. Check your connection and website.")));
    req.end(options.body);
  });
};

export function mediaMultipart(bytes: Buffer, filename: string, fields: Record<string, string>) {
  const boundary = `ri-${randomBytes(24).toString("hex")}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
