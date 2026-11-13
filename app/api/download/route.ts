import { NextResponse } from "next/server";
import { readVerifiedImage } from "@/lib/verifiedImages";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const url = new URL(req.url).searchParams.get("url") || "";
    const id = /^\/api\/image-assets\/([a-f0-9]{64})$/.exec(url)?.[1];
    if (!id) return NextResponse.json({ error: "Only a backend-verified image can be downloaded." }, { status: 409 });
    const file = readVerifiedImage(id);
    return new Response(new Uint8Array(file.data), { headers: { "Content-Type": file.mediaType, "Content-Disposition": 'attachment; filename="image.' + file.format + '"', "Cache-Control": "private, no-store", "X-Image-Metadata": "verified" } });
  } catch { return NextResponse.json({ error: "Image verification is missing or failed. Retry preparation." }, { status: 409 }); }
}
