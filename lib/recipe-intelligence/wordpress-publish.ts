import fs from "node:fs";
import * as cheerio from "cheerio";
import { randomUUID } from "node:crypto";
import { ArtifactStore, atomicWrite, digest } from "./artifacts";
import { storagePath } from "./paths";
import { publicUrl } from "./urls";
import { WordPressStore } from "./wordpress";

type Result = { postId: number; status: string; editUrl: string; postUrl: string; recipeCard: string; recipeId: number | null };
const active = new Set<string>();
function result(value: any, site: string): Result {
  if (!Number.isSafeInteger(value?.postId) || value.postId < 1 || !["draft", "publish", "pending", "private", "future"].includes(value.status)) throw new Error("WordPress did not confirm a saved post.");
  for (const name of ["editUrl", "postUrl"]) {
    const url = publicUrl(value[name]);
    if (url.protocol !== "https:" || url.origin !== new URL(site).origin) throw new Error("WordPress returned an unexpected post address.");
  }
  return { postId: value.postId, status: value.status, editUrl: value.editUrl, postUrl: value.postUrl, recipeCard: String(value.recipeCard), recipeId: Number.isSafeInteger(value.recipeId) ? value.recipeId : null };
}
function responseJson(response: { status: number; body: Buffer }) {
  if (response.status < 200 || response.status >= 300) throw new Error(`WordPress bridge returned HTTP ${response.status}. Check the website's plugin settings and drafts.`);
  return JSON.parse(response.body.toString("utf8"));
}
export class WordPressPublisher {
  constructor(private wp: WordPressStore) {}
  private row(site: string, item: string): any { return this.wp.store.db.prepare("SELECT * FROM wordpress_exports WHERE site_url=? AND item_id=?").get(site, item); }
  private artifact(itemId: string, name: string) {
    const row = this.wp.store.db.prepare("SELECT id,size_bytes FROM artifacts WHERE item_id=? AND name=?").get(itemId, name) as any;
    if (!row || row.size_bytes > 2_000_000) throw new Error(`Save or repair ${name} before sending this article.`);
    return JSON.parse(new ArtifactStore(this.wp.store).read(row.id).data.toString("utf8"));
  }
  async prepare(itemId: string, connectionId: string) {
    const profile = await this.wp.sync(connectionId);
    const plan = this.wp.plan(itemId, connectionId);
    const card = this.artifact(itemId, "recipe.json").recipeCard;
    const seo = this.artifact(itemId, "seo.json");
    if (!card || !Array.isArray(card.recipeIngredient) || !card.recipeIngredient.length || !Array.isArray(card.recipeInstructions) || !card.recipeInstructions.length) throw new Error("This article has no complete saved recipe card.");
    const recipe = { name: card.name, description: card.description || "", recipeIngredient: card.recipeIngredient,
      instructions: card.recipeInstructions.map((s: any) => typeof s === "string" ? s : s.text),
      ...(card.recipeYield ? { recipeYield: card.recipeYield } : {}), ...(card.prepTime ? { prepTime: card.prepTime } : {}), ...(card.cookTime ? { cookTime: card.cookTime } : {}), ...(card.totalTime ? { totalTime: card.totalTime } : {}) };
    const exportId = digest(`wordpress-export-v1|${plan.siteUrl}|${itemId}`);
    let html = plan.html || "";
    // New articles have explicit boundaries. Handle older Master Prompt articles too.
    html = html.replace(/<!--ri-card-start-->[\s\S]*?<!--ri-card-end-->/g, '<!--ri-recipe-card-->');
    const $ = cheerio.load(html, null, false);
    $("h1").first().remove();
    if (!html.includes('<!--ri-recipe-card-->')) {
      const heading = $("h2").filter((_i, e) => $(e).text().trim().toLowerCase() === "complete recipe card").first();
      if (heading.length) { heading.nextUntil("figure,h2").remove(); heading.replaceWith('<!--ri-recipe-card-->'); }
      else { if ($("article").length) $("article").append('<!--ri-recipe-card-->'); else $.root().append('<!--ri-recipe-card-->'); }
    }
    const payload = { exportId, profileRevision: profile.revision, recipeCard: profile.recipeCard, title: recipe.name,
      slug: seo.slug || "", excerpt: seo.description || "", content: $("article").length ? $("article").html()! : $.html(), mediaIds: plan.mediaIds, recipe };
    const reviewHash = digest(JSON.stringify({ documentHash: plan.documentHash, payload }));
    const old = this.row(plan.siteUrl, itemId);
    return { ...plan, profile, title: recipe.name, exportId, reviewHash, payload,
      previous: old ? { state: old.state, result: old.result_json ? result(JSON.parse(old.result_json), plan.siteUrl) : null, error: old.error } : null };
  }
  async send(itemId: string, input: Record<string, unknown>) {
    const connectionId = String(input.connectionId || "");
    if (!["draft", "publish"].includes(String(input.status))) throw new Error("Choose Save draft or Publish live.");
    if (input.status === "publish" && input.confirmPublish !== true) throw new Error("Confirm Publish live for this article and destination.");
    const prepared = await this.prepare(itemId, connectionId);
    if (!prepared.profile.ready) throw new Error("Choose an active supported default recipe card in WordPress Settings, then refresh.");
    if (input.status === "publish" && !prepared.profile.canPublish) throw new Error("This WordPress user cannot publish posts. Save a draft instead.");
    if (!prepared.ready) throw new Error("Upload all article images before sending the post.");
    if (input.reviewHash !== prepared.reviewHash) throw new Error("The article, images or website recipe-card settings changed. Review the updated export before sending.");
    const key = `${this.wp.store.root}|${prepared.exportId}`;
    if (active.has(key)) throw new Error("This article is already being sent. Wait for it to finish.");
    active.add(key);
    try {
      const previous = this.row(prepared.siteUrl, itemId);
      if (previous && previous.payload_json !== JSON.stringify(prepared.payload)) throw new Error("This article was already sent with different content or card settings. Open its WordPress draft to edit it; a duplicate will not be created.");
      if (previous) {
        // A lookup reconciles interrupted responses without repeating a publication request.
        const response = await this.wp.bridgeRequest(connectionId, `exports/${prepared.exportId}`);
        if (response.status === 200) {
          const saved = result(responseJson(response), prepared.siteUrl);
          this.saveResult(prepared.exportId, saved);
          if (input.status === "draft" || saved.status !== "draft") return saved;
          // Explicitly publishing an existing draft is the sole allowed follow-up mutation.
        } else {
          throw new Error("The earlier send has an uncertain outcome. Inspect WordPress drafts or try Check saved post; the app will not create a duplicate.");
        }
      }
      this.wp.store.db.transaction(() => {
        if (!this.wp.store.db.prepare("SELECT 1 FROM content_items WHERE id=? AND state NOT IN ('deleted','deleting','delete_failed')").get(itemId)) throw new Error("This recipe was deleted during preparation.");
        if (!previous && this.row(prepared.siteUrl, itemId)) throw new Error("Another request is sending this article.");
        this.wp.store.db.prepare("INSERT INTO wordpress_exports(site_url,item_id,export_id,document_hash,profile_json,payload_json,state,updated_at) VALUES(?,?,?,?,?,?,'sending',?) ON CONFLICT(site_url,item_id) DO UPDATE SET state='sending',updated_at=excluded.updated_at")
          .run(prepared.siteUrl, itemId, prepared.exportId, prepared.documentHash, JSON.stringify(prepared.profile), JSON.stringify(prepared.payload), new Date().toISOString());
      }).immediate();
      try {
        const response = await this.wp.bridgeRequest(connectionId, "exports", { ...prepared.payload, status: input.status, confirmPublish: input.status === "publish" });
        const receipt = `exports/wordpress-receipts/${connectionId}/post-${prepared.exportId}-${randomUUID()}.json`;
        atomicWrite(this.wp.store.root, receipt, JSON.stringify({ status: response.status, body: response.body.toString("utf8") }));
        this.wp.store.db.prepare("UPDATE wordpress_exports SET receipt_path=? WHERE export_id=?").run(receipt, prepared.exportId);
        return this.saveResult(prepared.exportId, result(responseJson(response), prepared.siteUrl));
      } catch (error) {
        this.wp.store.db.prepare("UPDATE wordpress_exports SET state='uncertain',error=?,updated_at=? WHERE export_id=?").run("Send could not be confirmed. Check saved post before taking further action.", new Date().toISOString(), prepared.exportId);
        throw error;
      }
    } finally { active.delete(key); }
  }
  private saveResult(id: string, value: Result) {
    this.wp.store.db.prepare("UPDATE wordpress_exports SET state='ready',result_json=?,error=NULL,updated_at=? WHERE export_id=?").run(JSON.stringify(value), new Date().toISOString(), id);
    return value;
  }
  async check(itemId: string, connectionId: string) {
    const plan = this.wp.plan(itemId, connectionId); const row = this.row(plan.siteUrl, itemId);
    if (!row) throw new Error("This article has not been sent to this website yet.");
    // Use a retained receipt even when the site is temporarily offline.
    if (row.receipt_path && row.state !== "ready") {
      try { const receipt = JSON.parse(fs.readFileSync(storagePath(this.wp.store.root, row.receipt_path), "utf8"));
        const saved = result(responseJson({ status: receipt.status, body: Buffer.from(receipt.body) }), plan.siteUrl); return this.saveResult(row.export_id, saved);
      } catch { /* Check the remote receipt; never issue a POST here. */ }
    }
    return this.saveResult(row.export_id, result(responseJson(await this.wp.bridgeRequest(connectionId, `exports/${row.export_id}`)), plan.siteUrl));
  }
}
