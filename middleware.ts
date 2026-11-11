import { NextResponse, type NextRequest } from "next/server";

// HTTP Basic Auth gate.
// Set APP_PASSWORD in .env.local and in Vercel env vars.
// Username can be anything; password must match APP_PASSWORD.

export function middleware(req: NextRequest) {
  // These local-only routes enforce their own launch session and origin checks.
  if (process.env.RECIPE_INTELLIGENCE_LOCAL === "1" && !process.env.VERCEL && req.nextUrl.pathname.startsWith("/api/recipe-intelligence/")) return NextResponse.next();
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // no password set → app is open

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const [, pwd] = decoded.split(":");
    if (pwd === password) return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Horse Studio", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
