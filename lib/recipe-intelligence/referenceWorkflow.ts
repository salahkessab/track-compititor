import fs from "node:fs";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import type { BatchStore, BatchEngine, Selection } from "./batches";
import { ImportStore, preparationError } from "./imports";
import { completeRecipe } from "./article";
import { contentSettings, validateContentSettings, type ContentSettings } from "./settings";
import { writingPayload, writingProfile } from "./prompts";
import { stageEstimate, outputText, PRICING_VERSION } from "./provider";
import { PHOTO_PROFILE_VERSION, ANALYSIS_PROFILE_VERSION, PHOTO_INSTRUCTIONS, ANALYSIS_INSTRUCTIONS, analysisEstimate, photoEstimate, analysisPayload, photoPayload, checkedAnalysis } from "./photoProfile";
import { storagePath } from "./paths";
import { digest } from "./artifacts";
import { normalizeUrl, publicUrl } from "./urls";

const now = () => new Date().toISOString();
export const isPhotoStage = (kind: string) => kind.startsWith("photo:") || kind.startsWith("analysis:");
export function prepareImportEstimate(b: BatchStore, importId: string, input: Partial<ContentSettings>) {
  const imports = new ImportStore(b.store), imported = imports.detail(importId);
  if (["queued", "running", "capturing"].includes(imported.status)) throw new Error("Still reading the recipe and its images. The estimate will appear when preparation finishes.");
  if (imported.status === "failed") throw new Error(preparationError(imported.error || "This recipe could not be read. Try another URL or paste its text."));
  const settings = validateContentSettings({ ...contentSettings(b.store), ...input });
  if (settings.output !== "images_only" && !completeRecipe(imported.recipe)) throw new Error("The page did not contain readable ingredients and instructions. Paste the recipe text or use another URL.");
  if (settings.images && settings.imageWorkflow === "reference") {
    const usable = imported.photos.filter((p: any) => p.state === "ready");
    if (!usable.length && completeRecipe(imported.recipe)) settings.imageWorkflow = "legacy";
    else if (!imported.selection_confirmed) imports.select(importId, usable.map((p: any) => p.id));
  }
  // A repeated estimate request reuses the same unpaid draft instead of creating duplicates.
  const candidates = b.store.db.prepare("SELECT DISTINCT b.id,b.settings_json FROM content_batches b JOIN content_items i ON i.batch_id=b.id WHERE i.import_id=? AND b.approved_at IS NULL AND b.status='awaiting_cost_approval'").all(importId) as any[];
  const existing = candidates.find(c => JSON.stringify(validateContentSettings(JSON.parse(c.settings_json))) === JSON.stringify(settings));
  const batch = existing ? prepareReferenceBatch(b, existing.id) : b.create([{ importId }], settings);
  if (batch.quote.pending || !batch.quote.lines.length) throw new Error(batch.items.find((i: any) => i.error)?.error || "Choose at least one image, or select article only.");
  return batch;
}
export function createReferenceBatch(b: BatchStore, selections: Selection[], input: Partial<ContentSettings>) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 20) throw new Error("Select between one and twenty recipes or photo sets.");
  if (new Set(selections.map(s => s.importId || s.recipeId)).size !== selections.length) throw new Error("Select each recipe once.");
  const settings = validateContentSettings({ ...contentSettings(b.store), ...input }); const imports = new ImportStore(b.store);
  const choices = selections.map(s => {
    if (s.importId && s.recipeId !== undefined) throw new Error("Choose an import or a historical recipe, not both.");
    if (s.alternativeUrls && (!Array.isArray(s.alternativeUrls) || s.alternativeUrls.length > 5)) throw new Error("Provide at most five alternative recipe URLs.");
    const alternativeUrls = (s.alternativeUrls || []).map(url => publicUrl(normalizeUrl(url)).href);
    if (s.independentResearch !== undefined && typeof s.independentResearch !== "boolean") throw new Error("Invalid research choice.");
    let imported: any, source: any;
    if (s.importId) { imported = imports.get(s.importId); if (imported.status === "capturing") throw new Error("Finish the browser import before estimating."); source = imported.recipe_json && JSON.parse(imported.recipe_json); }
    else { const r = b.store.db.prepare("SELECT * FROM recipe_records WHERE id=? AND verification_status='verified' AND duplicate_of IS NULL").get(s.recipeId || null) as any; if (!r?.recipe_json) throw new Error("Choose a verified recipe or a prepared import."); source = JSON.parse(r.recipe_json); imported = imports.create(source.url); }
    if (!s.recipeId && settings.output !== "images_only" && imported.kind === "upload") throw new Error("An article needs a recipe URL. Uploaded photographs alone support images only.");
    const basis = s.basis || settings.basis; if (!["original", "best_complete"].includes(basis)) throw new Error("Invalid recipe basis.");
    return { ...s, alternativeUrls, imported, source, basis };
  });
  const id = randomUUID();
  b.store.db.transaction(() => {
    b.store.db.prepare("INSERT INTO content_batches(id,created_at,status,settings_json,quote_json) VALUES(?,?,'awaiting_cost_approval',?,?)").run(id, now(), JSON.stringify(settings), JSON.stringify({ createdAt: now(), lines: [], estimated: 0, recommendedLimit: 0, pending: choices.length }));
    for (const c of choices) {
      const itemId = randomUUID();
      b.store.db.prepare("INSERT INTO content_items(id,batch_id,recipe_id,import_id,basis,independent_research,state,source_json,research_json) VALUES(?,?,?,?,?,?,'preparing',?,?)").run(itemId, id, c.recipeId || null, c.imported.id, c.basis, Number(c.independentResearch === true), c.source ? JSON.stringify(c.source) : null, JSON.stringify((c.alternativeUrls || []).slice(0, 5).map(url => ({ url, recipe: null }))));
    }
  }).immediate();
  prepareReferenceBatch(b, id); return b.detail(id);
}
export function prepareReferenceBatch(b: BatchStore, id: string) {
  const batch = b.get(id), settings: ContentSettings = JSON.parse(batch.settings_json); const db = b.store.db;
  if (settings.imageWorkflow !== "reference" && !(db.prepare("SELECT 1 FROM content_items WHERE batch_id=? AND import_id IS NOT NULL").get(id))) return;
  const lines: any[] = []; let pending = 0; let changed = false;
  for (const item of db.prepare("SELECT * FROM content_items WHERE batch_id=?").all(id) as any[]) {
    const config = item.config_json ? JSON.parse(item.config_json) : null;
    const hasCalls = !!db.prepare("SELECT 1 FROM api_calls WHERE stage_id IN (SELECT id FROM content_stages WHERE item_id=?)").get(item.id);
    if (config && !["preparing", "photo_selection"].includes(item.state) && (hasCalls || config.importRevision === new ImportStore(b.store).get(item.import_id).revision)) { lines.push(...config.lines); continue; }
    const imported = new ImportStore(b.store).get(item.import_id);
    let source = item.source_json ? JSON.parse(item.source_json) : imported.recipe_json ? JSON.parse(imported.recipe_json) : null;
    const discovered = imported.recipe_json ? JSON.parse(imported.recipe_json) : null;
    if (source && discovered && source.url === discovered.url && JSON.stringify([source.ingredients, source.instructions, source.yield, source.prepTime, source.cookTime, source.totalTime]) === JSON.stringify([discovered.ingredients, discovered.instructions, discovered.yield, discovered.prepTime, discovered.cookTime, discovered.totalTime])) source = { ...source, evidenceVersion: discovered.evidenceVersion, supportingEvidence: discovered.supportingEvidence, displayTimes: discovered.displayTimes };
    const wantsPhotos = settings.images && settings.imageWorkflow === "reference";
    const photos = db.prepare("SELECT * FROM reference_photos WHERE import_id=? AND selected=1 AND state='ready' ORDER BY position").all(item.import_id) as any[];
    let reason = settings.images && settings.imageWorkflow === "reference" || !source ? (["queued", "running"].includes(imported.status) ? "Preparing recipe and original photographs." : imported.error && preparationError(imported.error)) : null;
    if (!reason && settings.output !== "images_only" && !completeRecipe(source)) reason = "Essential recipe facts are missing. Supply a complete recipe URL or choose images only in a new job.";
    if (!reason && settings.images && settings.imageWorkflow === "legacy" && !completeRecipe(source)) reason = "Text-based images need complete recipe facts. Use original reference editing for uploaded photo sets.";
    if (!reason && wantsPhotos && (!imported.selection_confirmed || !photos.length)) reason = "Select the photographs to edit, or create an article-only/text-image job when no reference is usable.";
    if (reason) { pending++; db.prepare("UPDATE content_items SET state=?,review_kind='photos',error=? WHERE id=?").run(["queued", "running"].includes(imported.status) ? "preparing" : "photo_selection", reason, item.id); continue; }
    const itemLines: any[] = [];
    if (settings.output !== "images_only") for (const kind of ["article", ...(settings.correction ? ["correction"] : []), ...(item.basis === "best_complete" || item.independent_research ? ["research"] : [])]) {
      const inputBytes = Math.max(32000, Buffer.byteLength(JSON.stringify(writingPayload(source, settings))) + (kind === "correction" ? 12000 : 0));
      itemLines.push({ itemId: item.id, kind, inputBytes, ...stageEstimate(kind, settings, inputBytes) });
    }
    if (wantsPhotos) {
      for (let i = 0; i < photos.length; i += 10) itemLines.push({ itemId: item.id, kind: `analysis:${i / 10}`, count: photos.slice(i, i + 10).length, ...analysisEstimate(photos.slice(i, i + 10)) });
      for (const p of photos) itemLines.push({ itemId: item.id, kind: `photo:${p.id}`, referenceId: p.id, ...photoEstimate(settings) });
    } else if (settings.images) for (const kind of ["featured", "alternate", "pinterest"]) itemLines.push({ itemId: item.id, kind, ...stageEstimate(kind, settings) });
    const frozen = { importRevision: imported.revision, sourceUrl: source?.url || imported.url, palette: settings.palette, photoProfile: PHOTO_PROFILE_VERSION, photoInstructions: PHOTO_INSTRUCTIONS, analysisProfile: ANALYSIS_PROFILE_VERSION, analysisInstructions: ANALYSIS_INSTRUCTIONS, writingProfile: writingProfile(settings.articleFormat), writingRequest: source && settings.output !== "images_only" ? writingPayload(source, settings) : null, lines: itemLines };
    db.transaction(() => {
      db.prepare("DELETE FROM content_photos WHERE item_id=?").run(item.id);
      if (!hasCalls) db.prepare("DELETE FROM content_stages WHERE item_id=? AND (kind LIKE 'photo:%' OR kind LIKE 'analysis:%')").run(item.id);
      if (wantsPhotos) photos.forEach((p, i) => db.prepare("INSERT INTO content_photos(id,item_id,reference_id,position,source_url,relative_path,sha256,width,height,mime_type,caption) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), item.id, p.id, i, p.source_url, p.relative_path, p.sha256, p.width, p.height, p.mime_type, p.caption));
      const kinds = ["source", "research", "select", "article", "correction", "save_article", ...(wantsPhotos ? itemLines.filter(l => isPhotoStage(l.kind)).map(l => l.kind) : settings.images ? ["featured", "alternate", "pinterest"] : [])];
      for (const kind of kinds) db.prepare("INSERT OR IGNORE INTO content_stages(item_id,kind,state,updated_at) VALUES(?,?,'waiting',?)").run(item.id, kind, now());
      const start = item.selection_reason ? (settings.output === "images_only" ? "source" : "article") : "source";
      b.stage(item.id, start, "queued");
      db.prepare("UPDATE content_items SET config_json=?,source_json=?,state=?,review_kind=NULL,error=NULL WHERE id=?").run(JSON.stringify(frozen), source ? JSON.stringify(source) : null, batch.approved_at ? "awaiting_item_approval" : "queued", item.id);
    }).immediate();
    changed = true;
    lines.push(...itemLines);
  }
  const quote = { version: PRICING_VERSION, promptVersion: PHOTO_PROFILE_VERSION, createdAt: new Date(Math.max(Date.now(), Date.parse(JSON.parse(batch.quote_json).createdAt) + 1)).toISOString(), lines, pending, currency: "USD", estimated: lines.reduce((s, l) => s + l.estimated, 0), recommendedLimit: Math.ceil(lines.reduce((s, l) => s + l.reservation, 0) * 100) / 100, explanation: "Selected references only. Includes cached photo understanding, requested writing, one optional correction, and each selected edit. Unknown outcomes retain their reservations; saved results can be repaired without paying again. Pending photo selections are excluded and require a refreshed estimate and approval." };
  if (changed || JSON.parse(batch.quote_json).pending !== pending) db.prepare("UPDATE content_batches SET quote_json=? WHERE id=?").run(JSON.stringify(quote), id);
  return b.detail(id);
}
export function validateReferenceApproval(b: BatchStore, id: string) {
  const items = b.store.db.prepare("SELECT * FROM content_items WHERE batch_id=?").all(id) as any[];
  if (!items.some(i => i.config_json)) throw new Error(items.find(i => i.error)?.error || "The recipe is still being prepared. Wait for the estimate before generating.");
  for (const item of items) if (item.config_json && ["queued", "awaiting_item_approval"].includes(item.state) && !b.store.db.prepare("SELECT 1 FROM api_calls WHERE stage_id IN (SELECT id FROM content_stages WHERE item_id=?)").get(item.id)) {
    if (JSON.parse(item.config_json).importRevision !== new ImportStore(b.store).get(item.import_id).revision) throw new Error("Photo selection changed. Refresh the estimate before approving.");
  }
}
export function nextReferenceStage(b: BatchStore, item: any) {
  const db = b.store.db;
  const next = db.prepare("SELECT kind FROM content_stages WHERE item_id=? AND (kind LIKE 'analysis:%' OR kind LIKE 'photo:%') AND state IN ('waiting','queued') ORDER BY CASE WHEN kind LIKE 'analysis:%' THEN 0 ELSE 1 END,id LIMIT 1").get(item.id) as any;
  if (next) b.next(item.id, next.kind);
  else { const review = db.prepare("SELECT 1 FROM content_stages WHERE item_id=? AND state='review'").get(item.id); const failed = db.prepare("SELECT 1 FROM content_stages WHERE item_id=? AND state IN ('failed','uncertain')").get(item.id); db.prepare("UPDATE content_items SET state=?,review_kind=? WHERE id=?").run(review ? "review" : failed ? "partial" : "completed", review ? "photo_context" : null, item.id); }
}
function bytes(b: BatchStore, p: any) { const data = fs.readFileSync(storagePath(b.store.root, p.relative_path)); if (digest(data) !== p.sha256) throw new Error("Original reference checksum changed."); return `data:${p.mime_type};base64,${data.toString("base64")}`; }
export async function processReferenceStage(engine: BatchEngine, stage: any, item: any, settings: ContentSettings, signal?: AbortSignal) {
  const b = engine.batches, db = b.store.db; const photos = db.prepare("SELECT * FROM content_photos WHERE item_id=? ORDER BY position").all(item.id) as any[];
  const source = item.source_json ? JSON.parse(item.source_json) : null;
  const config = item.config_json ? JSON.parse(item.config_json) : {};
  if (stage.kind.startsWith("analysis:")) {
    const group = photos.slice(Number(stage.kind.split(":")[1]) * 10, Number(stage.kind.split(":")[1]) * 10 + 10);
    const inputs: any[] = [];
    for (const p of group) {
      try {
        const original = fs.readFileSync(storagePath(b.store.root, p.relative_path)); if (digest(original) !== p.sha256) throw new Error("Original reference checksum changed.");
        // High-detail vision uses a bounded 2048px view. Edits still receive the untouched original below.
        const image = await sharp(original, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
        inputs.push({ ...p, id: p.reference_id, dataUrl: `data:image/jpeg;base64,${image.toString("base64")}` });
      } catch { b.stage(item.id, `photo:${p.reference_id}`, "failed", null, "Original photograph is unavailable or changed. Restore its original file before retrying."); }
    }
    if (!inputs.length) { b.stage(item.id, stage.kind, "done"); nextReferenceStage(b, item); return; }
    const result = await engine.paid(stage, item, { ...settings, textModel: "gpt-5.5" }, "text", analysisPayload(inputs, source, config.analysisInstructions, config.analysisProfile), signal, analysisEstimate(group));
    const raw = JSON.parse(outputText(result));
    for (const p of group.filter(p => inputs.some(i => i.id === p.reference_id))) {
      if (p.analysis_json && JSON.parse(p.analysis_json).needsReview === false) continue;
      try { const matching = Array.isArray(raw.photos) ? raw.photos.filter((v: any) => v.id === p.reference_id) : []; if (matching.length !== 1) throw new Error("Photo context is missing or duplicated."); const analysis = checkedAnalysis(matching[0], p.reference_id, source?.instructions?.length || 0);
        db.prepare("UPDATE content_photos SET analysis_json=?,error=? WHERE id=?").run(JSON.stringify(analysis), analysis.needsReview ? analysis.reason : null, p.id);
        if (analysis.needsReview) b.stage(item.id, `photo:${p.reference_id}`, "review", null, analysis.reason);
        else db.prepare("UPDATE content_stages SET state='waiting',error=NULL WHERE item_id=? AND kind=? AND state='review'").run(item.id, `photo:${p.reference_id}`);
      } catch (e) { const error = e instanceof Error ? e.message : "Review photo context."; db.prepare("UPDATE content_photos SET error=? WHERE id=?").run(error, p.id); b.stage(item.id, `photo:${p.reference_id}`, "review", null, error); }
    }
  } else {
    const photo = photos.find(p => stage.kind === `photo:${p.reference_id}`); if (!photo?.analysis_json) { b.stage(item.id, stage.kind, "review", null, "Photo understanding must be completed or reviewed first."); nextReferenceStage(b, item); return; }
    const analysis = JSON.parse(photo.analysis_json);
    const payload = photoPayload(analysis, settings, bytes(b, photo), config.photoInstructions, config.photoProfile);
    const response = await engine.paid(stage, item, settings, "image", payload, signal, photoEstimate(settings, config.photoInstructions));
    if (!response.data?.[0]?.b64_json) throw new Error("The saved response contains no usable edited photograph.");
    await b.artifacts.referenceImage(item, photo, response.data[0].b64_json, payload.prompt);
  }
  const existing = db.prepare("SELECT result_json FROM content_stages WHERE id=?").get(stage.id) as any;
  b.stage(item.id, stage.kind, "done", existing?.result_json ? JSON.parse(existing.result_json) : null); nextReferenceStage(b, item);
}
export function reviewPhoto(b: BatchStore, itemId: string, referenceId: string, input: any) {
  const item = b.item(itemId); const photo = b.store.db.prepare("SELECT * FROM content_photos WHERE item_id=? AND reference_id=?").get(itemId, referenceId) as any;
  const stage = b.store.db.prepare("SELECT state FROM content_stages WHERE item_id=? AND kind=?").get(itemId, `photo:${referenceId}`) as any;
  if (!photo || stage?.state !== "review") throw new Error("This photo is not awaiting context review.");
  const source = item.source_json ? JSON.parse(item.source_json) : null; const analysis = checkedAnalysis({ ...input, id: referenceId, needsReview: false, reason: "Photo context confirmed by the user." }, referenceId, source?.instructions?.length || 0);
  if (analysis.needsReview) throw new Error("Confirm the visible food, vessel and supported ingredient names.");
  b.store.db.prepare("UPDATE content_photos SET analysis_json=?,error=NULL WHERE id=?").run(JSON.stringify(analysis), photo.id); b.next(itemId, `photo:${referenceId}`);
}
