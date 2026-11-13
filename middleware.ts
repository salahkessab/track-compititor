import { NextResponse, type NextRequest } from "next/server";

// HTTP Basic Auth gate.
// Set APP_PASSWORD in .env.local and in Vercel env vars.
// Username can be anything; password must match APP_PASSWORD.

export function middleware(req: NextRequest) {
  // Middleware authentication can run before Vercel's declarative redirect.
  // Send the old production entry point to its authenticated persistent host.
  if (process.env.VERCEL && req.nextUrl.hostname === "track-compititor.vercel.app") {
    const destination = new URL("https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech");
    destination.pathname = req.nextUrl.pathname;
    destination.search = req.nextUrl.search;
    return NextResponse.redirect(destination, 307);
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
