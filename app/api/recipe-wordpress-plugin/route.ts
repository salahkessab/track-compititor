import { buildWordPressPackage } from "../../../lib/recipe-intelligence/wordpressPackage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const archive = await buildWordPressPackage();
    return new Response(new Uint8Array(archive.bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${archive.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ error: "Plugin package unavailable. Rebuild the app and try again." }, { status: 503 }); }
}
