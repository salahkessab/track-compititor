import { buildCaptureExtensionPackage } from "../../../lib/recipe-intelligence/extensionPackage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const archive = await buildCaptureExtensionPackage();
    return new Response(new Uint8Array(archive.bytes), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archive.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Extension-Version": archive.version,
    } });
  } catch {
    return Response.json({ error: "The extension download is unavailable. Rebuild or update the app and try again." }, { status: 503 });
  }
}
