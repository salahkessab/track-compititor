// Additive migrations preserve the original discovery index and its checkpoints.
export const CURRENT_SCHEMA = 7;
export const MIGRATION_2 = `
ALTER TABLE recipe_records ADD COLUMN publication_json TEXT;
ALTER TABLE recipe_records ADD COLUMN verification_reason TEXT;
ALTER TABLE recipe_records ADD COLUMN verified_at TEXT;
ALTER TABLE recipe_records ADD COLUMN recipe_json TEXT;
ALTER TABLE recipe_records ADD COLUMN duplicate_of INTEGER REFERENCES recipe_records(id);
CREATE TABLE publication_evidence (
 id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL REFERENCES recipe_records(id),
 fetched_url TEXT NOT NULL, at TEXT NOT NULL, evidence_json TEXT NOT NULL, classification TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE reports (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, site_ids TEXT NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL,
 timezone TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
 segment_start INTEGER NOT NULL DEFAULT 0, coverage_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE report_jobs (
 id INTEGER PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), site_id TEXT NOT NULL REFERENCES tracked_sites(id),
 kind TEXT NOT NULL, url TEXT NOT NULL, recipe_id INTEGER REFERENCES recipe_records(id), priority INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, owner TEXT, page_hash TEXT,
 UNIQUE(report_id,kind,url)
);
CREATE TABLE report_items (
 report_id TEXT NOT NULL REFERENCES reports(id), recipe_id INTEGER NOT NULL REFERENCES recipe_records(id),
 added_at TEXT NOT NULL, PRIMARY KEY(report_id,recipe_id)
);
CREATE TABLE content_batches (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, settings_json TEXT NOT NULL,
 quote_json TEXT NOT NULL, approved_at TEXT, limit_usd REAL NOT NULL DEFAULT 0, error TEXT
);
CREATE TABLE content_items (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES content_batches(id), recipe_id INTEGER NOT NULL REFERENCES recipe_records(id),
 basis TEXT NOT NULL, independent_research INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'queued',
 source_json TEXT, research_json TEXT NOT NULL DEFAULT '[]', selection_reason TEXT, article_json TEXT,
 warnings_json TEXT NOT NULL DEFAULT '[]', review_kind TEXT, article_approved INTEGER NOT NULL DEFAULT 0,
 images_approved INTEGER NOT NULL DEFAULT 0, correction_attempted INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1, error TEXT, UNIQUE(batch_id,recipe_id)
);
CREATE TABLE content_stages (
 id INTEGER PRIMARY KEY, item_id TEXT NOT NULL REFERENCES content_items(id), kind TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued', attempt INTEGER NOT NULL DEFAULT 0, owner TEXT, error TEXT,
 result_json TEXT, updated_at TEXT NOT NULL, UNIQUE(item_id,kind)
);
CREATE TABLE api_calls (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES content_batches(id), stage_id INTEGER NOT NULL REFERENCES content_stages(id),
 model TEXT NOT NULL, operation TEXT NOT NULL, state TEXT NOT NULL, reserved_usd REAL NOT NULL,
 actual_usd REAL, usage_json TEXT, provider_id TEXT, response_path TEXT, request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL, completed_at TEXT, resolution TEXT
);
CREATE TABLE artifacts (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES content_items(id), name TEXT NOT NULL,
 relative_path TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, media_type TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(item_id,name)
);
CREATE TABLE model_checks (
 model TEXT PRIMARY KEY, checked_at TEXT NOT NULL, metadata_json TEXT NOT NULL, production_confirmed_at TEXT
);
CREATE INDEX report_work ON report_jobs(state,priority,id);
CREATE INDEX reports_membership ON report_items(recipe_id);
CREATE INDEX evidence_recipe ON publication_evidence(recipe_id,id DESC);
CREATE INDEX content_work ON content_stages(state,item_id,id);
CREATE INDEX calls_budget ON api_calls(batch_id,state);
CREATE INDEX canonical_duplicates ON recipe_records(duplicate_of);
PRAGMA user_version=2;
`;
export const MIGRATION_3 = `
ALTER TABLE api_calls ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
UPDATE api_calls SET attempt=COALESCE((SELECT attempt FROM content_stages WHERE id=api_calls.stage_id),0)
 WHERE rowid IN (SELECT max(rowid) FROM api_calls GROUP BY stage_id);
CREATE INDEX calls_stage_attempt ON api_calls(stage_id,attempt);
PRAGMA user_version=3;
`;

// Rebuild only this parent table, with foreign_keys disabled outside the
// transaction. Child foreign keys continue to name content_items throughout.
export const MIGRATION_4 = `
CREATE TABLE recipe_imports (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, url TEXT, title TEXT NOT NULL,
 status TEXT NOT NULL, recipe_json TEXT, error TEXT, created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, selection_confirmed INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0, owner TEXT
);
CREATE TABLE reference_photos (
 id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES recipe_imports(id),
 source_url TEXT, name TEXT NOT NULL, position INTEGER NOT NULL, caption TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL, selected INTEGER NOT NULL DEFAULT 0, relative_path TEXT,
 sha256 TEXT, pixel_hash TEXT, width INTEGER, height INTEGER, mime_type TEXT, error TEXT
);
CREATE INDEX import_work ON recipe_imports(status,created_at);
CREATE INDEX import_photos ON reference_photos(import_id,position);
CREATE TABLE content_items_v4 (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES content_batches(id),
 recipe_id INTEGER REFERENCES recipe_records(id), import_id TEXT REFERENCES recipe_imports(id),
 basis TEXT NOT NULL, independent_research INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'queued',
 source_json TEXT, research_json TEXT NOT NULL DEFAULT '[]', selection_reason TEXT, article_json TEXT,
 warnings_json TEXT NOT NULL DEFAULT '[]', review_kind TEXT, article_approved INTEGER NOT NULL DEFAULT 0,
 images_approved INTEGER NOT NULL DEFAULT 0, correction_attempted INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1, error TEXT, config_json TEXT,
 UNIQUE(batch_id,recipe_id), UNIQUE(batch_id,import_id), CHECK(recipe_id IS NOT NULL OR import_id IS NOT NULL)
);
INSERT INTO content_items_v4(id,batch_id,recipe_id,basis,independent_research,state,source_json,research_json,selection_reason,article_json,warnings_json,review_kind,article_approved,images_approved,correction_attempted,version,error)
 SELECT id,batch_id,recipe_id,basis,independent_research,state,source_json,research_json,selection_reason,article_json,warnings_json,review_kind,article_approved,images_approved,correction_attempted,version,error FROM content_items;
DROP TABLE content_items;
ALTER TABLE content_items_v4 RENAME TO content_items;
CREATE TABLE content_photos (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES content_items(id),
 reference_id TEXT NOT NULL REFERENCES reference_photos(id), position INTEGER NOT NULL,
 source_url TEXT, relative_path TEXT NOT NULL, sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 mime_type TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', analysis_json TEXT, error TEXT,
 UNIQUE(item_id,reference_id)
);
CREATE INDEX content_photo_item ON content_photos(item_id,position);
ALTER TABLE content_stages ADD COLUMN request_path TEXT;
ALTER TABLE content_stages ADD COLUMN profile_version TEXT;
PRAGMA user_version=4;
`;

// Upload receipts are separate from generated artifacts and paid AI stages.
export const MIGRATION_5 = `
CREATE TABLE wordpress_media (
 site_url TEXT NOT NULL, sha256 TEXT NOT NULL, slug TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('uploading','ready','uncertain','failed')),
 media_id INTEGER, source_url TEXT, receipt_path TEXT, error TEXT,
 updated_at TEXT NOT NULL, PRIMARY KEY(site_url,sha256)
);
PRAGMA user_version=5;
`;

export const MIGRATION_6 = `
CREATE TABLE wordpress_exports (
 site_url TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES content_items(id),
 export_id TEXT NOT NULL UNIQUE, document_hash TEXT NOT NULL,
 profile_json TEXT NOT NULL, payload_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('sending','ready','uncertain')),
 result_json TEXT, receipt_path TEXT, error TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(site_url,item_id)
);
PRAGMA user_version=6;
`;

// Object storage metadata only; credentials remain in the server environment.
export const MIGRATION_7 = `
CREATE TABLE r2_objects (
 id INTEGER PRIMARY KEY, destination TEXT NOT NULL, relative_path TEXT NOT NULL,
 sha256 TEXT NOT NULL, object_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, media_type TEXT NOT NULL,
 mtime_ms REAL NOT NULL, is_current INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL CHECK(state IN ('pending','uploading','synced','failed','superseded','delete_pending','deleted')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at TEXT NOT NULL,
 UNIQUE(destination,relative_path,sha256)
);
CREATE INDEX r2_runnable ON r2_objects(destination,state,next_attempt,id);
CREATE TABLE r2_deleted_paths (relative_path TEXT PRIMARY KEY);
PRAGMA user_version=7;
`;
