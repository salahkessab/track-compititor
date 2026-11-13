import { NextResponse, type NextRequest } from "next/server";

// HTTP Basic Auth gate.
// Set APP_PASSWORD in .env.local and in Vercel env vars.
// Username can be anything; password must match APP_PASSWORD.

export function middleware(req: NextRequest) {
  // Keep the public URL while the persistent server owns authentication and work.
  // Validate the browser origin before translating it for that exact upstream.
  if (process.env.VERCEL && req.nextUrl.hostname === "track-compititor.vercel.app") {
    const destination = new URL("https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech");
    destination.pathname = req.nextUrl.pathname;
    destination.search = req.nextUrl.search;
    const suppliedOrigin = req.headers.get("origin");
    const read = req.method === "GET" || req.method === "HEAD";
    if ((suppliedOrigin && suppliedOrigin !== "https://track-compititor.vercel.app") || (!read && !suppliedOrigin)) {
      return NextResponse.json({ error: "Workspace origin check failed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const headers = new Headers(req.headers);
    headers.set("host", destination.host);
    headers.set("x-forwarded-host", destination.host);
    if (suppliedOrigin) headers.set("origin", destination.origin);
    return NextResponse.rewrite(destination, { request: { headers } });
  }
  const server = process.env.RECIPE_INTELLIGENCE_MODE === "server" && !process.env.VERCEL;
  if (server && req.nextUrl.pathname === "/api/server-health") return NextResponse.next();
  if (server && !process.env.APP_PASSWORD) return new NextResponse("Server authentication is not configured.", { status: 503 });
  // These local-only routes enforce their own launch session and origin checks.
  if (process.env.RECIPE_INTELLIGENCE_LOCAL === "1" && !process.env.VERCEL && req.nextUrl.pathname.startsWith("/api/recipe-intelligence/")) return NextResponse.next();
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // no password set → app is open

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6)), colon = decoded.indexOf(":");
      if (colon > 0 && decoded.slice(colon + 1) === password) return NextResponse.next();
    } catch { /* Malformed credentials are rejected. */ }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${server ? "Recipe Intelligence" : "Horse Studio"}", charset="UTF-8"` },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
