import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { intelligenceEnabled, serverMode } from "@/lib/recipe-intelligence/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!serverMode() || !intelligenceEnabled()) return Response.json({ ready: false }, { status: 503 });
  let db: Database.Database | undefined;
  try {
    const file = path.join(process.env.RECIPE_INTELLIGENCE_ROOT!, "database", "recipe-intelligence.sqlite");
    if (!fs.existsSync(file)) throw new Error();
    db = new Database(file, { readonly: true, fileMustExist: true });
    const lease = db.prepare("SELECT expires_at FROM worker_lease WHERE id=1").get() as { expires_at: number } | undefined;
    const ready = !!lease && lease.expires_at > Date.now();
    const revision = /^[a-f0-9]{40}$/.test(process.env.APP_REVISION || "") ? process.env.APP_REVISION : null;
    return Response.json({ ready, revision, deploymentProtocol: 1 }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ready: false }, { status: 503 }); }
  finally { db?.close(); }
}
