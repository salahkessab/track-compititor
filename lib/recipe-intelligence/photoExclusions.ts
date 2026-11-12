import type { IntelligenceStore } from "./database";

export function excludedPhotoFile(store: IntelligenceStore, itemId: string, name: string): boolean {
  const match = /^photo-([a-f0-9-]{36})(?:\.|-prompt\.)/i.exec(name);
  return !!match && !!store.db.prepare("SELECT 1 FROM content_stages WHERE item_id=? AND kind=? AND state='skipped'").get(itemId, `photo:${match[1]}`);
}
