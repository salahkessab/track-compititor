import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json({ error: "Only http(s) image URLs are supported" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const res = await fetch(parsed.toString(), { signal: controller.signal });
  clearTimeout(timeout);
  if (!res.ok) return NextResponse.json({ error: "Fetch failed" }, { status: 502 });

  const buf = await res.arrayBuffer();
  const type = res.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) {
    return NextResponse.json({ error: "URL did not return an image" }, { status: 415 });
  }
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  return new NextResponse(buf, {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="horse-${Date.now()}.${ext}"`,
      "cache-control": "no-store",
    },
  });
}
