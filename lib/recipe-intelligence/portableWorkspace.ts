import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { assertMigrationIdle, prepareServerMigration, sealDatabase, unsealDatabase, validateMigrationDatabase } from './serverMigration';
import { windowsSecrets, serverSecrets, type SecretProtection } from './local-secrets';
import { digest } from './artifacts';
import { OPENAI_CREDENTIAL_SETTING } from './providerCredentials';

// Transfers a complete workspace to a private persistent host without requiring
// object-storage credentials. Originals and verification proofs travel together.
// Historical backups/logs stay in the independent local safety backup.
const folders = new Set(['articles','images','reports','research','exports','verified-images','editorial-trials-v5','editorial-trials-v5-reviewed','studio-storage']);
type FileEntry = { path: string; size: number; sha256: string };
type Manifest = { version: 1; createdAt: string; files: FileEntry[]; database: { sha256: string; size: number }; counts: Record<string,number> };
const databasePath = (root: string) => path.join(root, 'database', 'recipe-intelligence.sqlite');
function relative(value: string) {
  if (!value || value.length > 600 || /[\\:\x00-\x1f]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..') || !folders.has(value.split('/')[0])) throw new Error('Invalid portable workspace path.');
  return value;
}
function regularFile(root: string, name: string) {
  let file = root;
  for (const part of relative(name).split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Portable workspaces cannot contain symbolic links.');
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error('Unsupported portable workspace file.');
  return file;
}
function counts(db: Database.Database) {
  const result: Record<string,number> = {};
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]) {
    if (!/^[a-z_][a-z0-9_]*$/.test(row.name)) throw new Error('Invalid workspace table.');
    if (row.name !== 'worker_lease' && row.name !== 'settings') result[row.name] = (db.prepare(`SELECT count(*) n FROM ${row.name}`).get() as {n:number}).n;
  }
  return result;
}
function newLocation(value: string, outside?: string) {
  if (!path.isAbsolute(value)) throw new Error('Choose an absolute destination folder.');
  const destination = path.resolve(value);
  if (destination === path.parse(destination).root || fs.existsSync(destination)) throw new Error('Choose a new destination; existing workspaces are never overwritten.');
  fs.mkdirSync(path.dirname(destination), { recursive:true });
  const resolved = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  if (outside) { const rel = path.relative(fs.realpathSync(outside), resolved); if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) throw new Error('Keep migration copies outside the source workspace.'); }
  return resolved;
}
export async function preparePortableWorkspace(sourceRoot: string, destination: string, secrets: SecretProtection = windowsSecrets) {
  const source = fs.realpathSync(sourceRoot), target = newLocation(destination, source);
  const db = new Database(databasePath(source), {readonly:true,fileMustExist:true});
  try {
    validateMigrationDatabase(db); assertMigrationIdle(db);
    fs.mkdirSync(target,{mode:0o700}); fs.mkdirSync(path.join(target,'files'),{mode:0o700});
    const files: FileEntry[] = [], hashes = new Map<string,string>();
    const walk = (directory: string) => {
      for (const item of fs.readdirSync(path.join(source,directory),{withFileTypes:true})) {
        const name = relative(directory + '/' + item.name);
        if (item.isSymbolicLink()) throw new Error('Portable workspaces cannot contain symbolic links.');
        if (name === 'verified-images/locks') {
          for (const lock of fs.readdirSync(path.join(source,name))) {
            const owner = Number(fs.readFileSync(regularFile(source,name + '/' + lock),'utf8'));
            if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('Inspect an invalid image preparation lock before migration.');
            try { process.kill(owner,0); }
            catch (error: any) { if (error.code === 'ESRCH') continue; throw error; }
            throw new Error('Finish image preparation before migration.');
          }
          // Dead-process locks are machine-specific, not image data. Leave the
          // source unchanged and do not carry Windows PIDs onto the new host.
          continue;
        }
        if (item.isDirectory()) { walk(name); continue; }
        const original = regularFile(source,name), data = fs.readFileSync(original);
        const file = path.join(target,'files',...name.split('/'));
        fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
        fs.writeFileSync(file,data,{flag:'wx',mode:0o600});
        const hash = digest(data);
        if (digest(fs.readFileSync(file)) !== hash) throw new Error('Portable file verification failed.');
        files.push({path:name,size:data.length,sha256:hash}); hashes.set(name,hash);
      }
    };
    for (const name of folders) if (fs.existsSync(path.join(source,name))) {
      if (fs.lstatSync(path.join(source,name)).isSymbolicLink()) throw new Error('Portable workspaces cannot contain symbolic links.');
      walk(name);
    }
    const prepared = await prepareServerMigration(source,path.join(target,'database.ribak'),secrets,hashes);
    // A changing source is not a completed migration, even if each copy is valid.
    assertMigrationIdle(db);
    for (const entry of files) if (digest(fs.readFileSync(regularFile(source,entry.path))) !== entry.sha256) throw new Error('Source changed during migration. Create a fresh snapshot.');
    const manifest: Manifest = {version:1,createdAt:new Date().toISOString(),files,database:{sha256:prepared.sha256,size:prepared.size},counts:counts(db)};
    const sealed = sealDatabase(Buffer.from(JSON.stringify(manifest)));
    fs.writeFileSync(path.join(target,'manifest.ribak'),sealed,{flag:'wx',mode:0o600});
    return {directory:target,files:files.length,bytes:files.reduce((n,f)=>n+f.size,0)+prepared.size,manifestSha256:digest(sealed),counts:manifest.counts};
  } finally { db.close(); }
}

export async function restorePortableWorkspace(bundle: string, destination: string, expectedManifestSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) throw new Error('Pin the portable manifest checksum before restoring.');
  const target = newLocation(destination), manifestBytes = fs.readFileSync(path.join(bundle,'manifest.ribak'));
  if (digest(manifestBytes) !== expectedManifestSha256) throw new Error('Portable manifest checksum mismatch.');
  const manifest: Manifest = JSON.parse(unsealDatabase(manifestBytes).toString('utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 100000) throw new Error('Unsupported portable manifest.');
  const seen = new Set<string>();
  for (const entry of manifest.files) {
    relative(entry.path);
    if (seen.has(entry.path.toLowerCase()) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid or duplicate portable file.');
    seen.add(entry.path.toLowerCase());
    const data = fs.readFileSync(regularFile(path.join(bundle,'files'),entry.path));
    if (data.length !== entry.size || digest(data) !== entry.sha256) throw new Error('Portable file checksum mismatch.');
  }
  const encrypted = fs.readFileSync(path.join(bundle,'database.ribak'));
  if (encrypted.length !== manifest.database.size || digest(encrypted) !== manifest.database.sha256) throw new Error('Portable database checksum mismatch.');
  const database = unsealDatabase(encrypted);
  // Build a new sibling directory. No running workspace is touched on failure.
  const staging = target + '.restoring-' + randomUUID(); fs.mkdirSync(staging,{mode:0o700}); fs.mkdirSync(path.join(staging,'database'),{mode:0o700});
  fs.writeFileSync(databasePath(staging),database,{flag:'wx',mode:0o600});
  const db = new Database(databasePath(staging),{readonly:true,fileMustExist:true});
  try {
    validateMigrationDatabase(db); assertMigrationIdle(db);
    if (JSON.stringify(counts(db)) !== JSON.stringify(manifest.counts)) throw new Error('Portable workspace record counts changed.');
    for (const row of db.prepare("SELECT value FROM settings WHERE key LIKE 'wordpress_connection:%'").all() as {value:string}[]) await serverSecrets.unprotect(JSON.parse(row.value).protectedPassword);
    const provider = db.prepare('SELECT value FROM settings WHERE key=?').get(OPENAI_CREDENTIAL_SETTING) as {value:string}|undefined;
    if (provider) await serverSecrets.unprotect(JSON.parse(provider.value).protectedKey);
  } finally { db.close(); }
  for (const entry of manifest.files) {
    const data = fs.readFileSync(regularFile(path.join(bundle,'files'),entry.path));
    if (digest(data) !== entry.sha256) throw new Error('Portable file changed during restore.');
    const file = path.join(staging,...entry.path.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,data,{flag:'wx',mode:0o600});
    if (digest(fs.readFileSync(file)) !== entry.sha256) throw new Error('Restored file checksum mismatch.');
  }
  fs.writeFileSync(path.join(staging,'portable-migration.json'),JSON.stringify({manifestSha256:expectedManifestSha256,restoredAt:new Date().toISOString(),files:manifest.files.length}),{flag:'wx',mode:0o600});
  if (fs.existsSync(target)) throw new Error('Destination appeared during restore; refusing to overwrite it.');
  fs.renameSync(staging,target);
  return {directory:target,files:manifest.files.length,counts:manifest.counts};
}
