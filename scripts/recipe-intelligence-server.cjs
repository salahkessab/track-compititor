'use strict';
// One persistent host owns the web process and worker. No desktop launcher,
// Windows service, cron job, or browser tab is required.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadEnvConfig } = require('@next/env');

async function main() {
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const { validateServerRuntime } = require('../.intelligence-build/lib/recipe-intelligence/runtime.js');
  validateServerRuntime();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server PORT.');
  const { restoreServerMigration } = require('../.intelligence-build/lib/recipe-intelligence/serverMigration.js');
  await restoreServerMigration();
  const root = process.env.RECIPE_INTELLIGENCE_ROOT;
  if (!fs.existsSync(path.join(root, 'database', 'recipe-intelligence.sqlite')) && process.env.RECIPE_INTELLIGENCE_ALLOW_EMPTY !== '1') throw new Error('Restore the migration before starting, or explicitly enable an empty workspace.');
  const { IntelligenceStore } = require('../.intelligence-build/lib/recipe-intelligence/database.js');
  const store = await IntelligenceStore.open(root);
  try {
    if (store.integrity() !== 'ok') throw new Error('Database integrity check failed.');
    const { serverKey } = require('../.intelligence-build/lib/recipe-intelligence/runtime.js');
    const keyId = require('node:crypto').createHash('sha256').update(serverKey()).digest('hex');
    const savedKey = store.db.prepare("SELECT value FROM settings WHERE key='server_key_id'").get();
    if (savedKey && savedKey.value !== keyId) throw new Error('The server encryption key changed. Restore the original key before restarting.');
    store.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('server_key_id',?)").run(keyId);
    if (process.env.RECIPE_INTELLIGENCE_MIGRATION_KEY) {
      const { objectStorage } = require('../.intelligence-build/lib/recipe-intelligence/r2.js');
      const storage = objectStorage(store);
      const rows = store.db.prepare("SELECT relative_path,sha256 FROM r2_objects WHERE is_current=1 AND state='synced'").all();
      for (const row of rows) await storage.ensure(row.relative_path, row.sha256);
      console.log(`Verified ${rows.length} migrated file locations.`);
    }
  } finally { store.close(); }
  let stopping = false;
  const children = [];
  const stop = () => {
    if (stopping) return; stopping = true;
    for (const child of children) { if (child.connected) child.send('stop'); else child.kill('SIGTERM'); }
    const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }, 25000);
    timer.unref();
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.on('message', message => { if (message === 'stop') stop(); });
  process.on('disconnect', stop);
  const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
  const start = (name, args, ipc = false) => {
    const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', ...(ipc ? ['ipc'] : [])] });
    children.push(child);
    child.on('error', () => { console.error(`${name} could not start.`); process.exitCode = 1; stop(); });
    child.on('exit', code => { if (!stopping) { console.error(`${name} stopped; the host must restart the service.`); process.exitCode = code || 1; stop(); } });
  };
  start('Worker', ['.intelligence-build/workers/recipe-intelligence.js'], true);
  start('Web', [require.resolve('next/dist/bin/next'), 'start', '--hostname', '0.0.0.0', '--port', String(port)]);
  // Test/managed launchers may attach IPC. It must not keep an already stopped
  // supervisor alive after both owned children exit.
  process.channel?.unref();
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
