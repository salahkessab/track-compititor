'use strict';
// End-to-end local runtime checks. Only .invalid hosts are queued; no provider calls are made.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { controlRequest, readJson } = require('./recipe-intelligence-launcher.cjs');
const repo = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-intelligence-smoke-'));
  const config = path.join(temporary, 'Launcher settings');
  const root = path.join(temporary, 'Selected storage with spaces');
  const env = { ...process.env, RECIPE_INTELLIGENCE_CONFIG_DIR: config, OPENAI_API_KEY: 'smoke-not-a-real-key', APP_PASSWORD: 'smoke-password' };
  const launches = new Set(); let instance;
  function start(args = []) {
    const child = spawn(process.execPath, [path.join(__dirname, 'recipe-intelligence-launcher.cjs'), '--no-browser', ...args], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    child.output = () => output; launches.add(child); child.once('exit', () => launches.delete(child)); return child;
  }
  async function ready(child) {
    for (let i = 0; i < 360; i++) {
      instance = readJson(path.join(config, 'instance.json'));
      if (instance) {
        try { const health = await controlRequest(instance); if (health.ready) return { ...instance, ...health }; } catch { /* Startup may still be pending. */ }
      }
      if (child.exitCode !== null) throw new Error(`Launcher exited: ${child.output()}`);
      await wait(1000);
    }
    throw new Error(`Startup timeout. Inspect ${path.join(config, 'startup.log')}`);
  }
  async function api(route, method = 'GET', body) {
    const origin = `http://127.0.0.1:${instance.appPort}`;
    const response = await fetch(`${origin}/api/recipe-intelligence/${route}`, {
      method, headers: { Origin: origin, 'X-Recipe-Intelligence': '1', 'X-RI-Key': instance.token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json(); assert.ok(response.ok, `${route}: ${JSON.stringify(result)}`); return result;
  }
  async function stop() {
    if (!instance) return;
    try { await controlRequest(instance, 'stop'); } catch { return; }
    for (let i = 0; i < 180; i++) { await wait(100); try { await controlRequest(instance); } catch { return; } }
    throw new Error('Controlled shutdown did not finish.');
  }
  try {
    console.log('Preparing an isolated local build and first launch...');
    const first = start(['--root', root]); instance = await ready(first);
    assert.equal(readJson(path.join(config, 'settings.json')).root, fs.realpathSync(root));
    assert.equal(instance.children.length, 2);
    const snapshot = await api('snapshot'); assert.equal(snapshot.worker.online, true);
    assert.equal(snapshot.settings.root, fs.realpathSync(root));
    console.log('PASS: selected-folder setup, worker startup, local API, and two owned children.');

    // Basic Auth still protects the pre-existing application while the local API uses its own session.
    const origin = `http://127.0.0.1:${instance.appPort}`;
    assert.equal((await fetch(origin)).status, 401);
    assert.equal((await fetch(origin, { headers: { Authorization: `Basic ${Buffer.from('owner:smoke-password').toString('base64')}` } })).status, 200);
    assert.equal((await fetch(`${origin}/api/recipe-intelligence/snapshot`)).status, 401);
    assert.equal((await fetch(`${origin}/api/recipe-intelligence/sites`, { method: 'POST', headers: { 'X-RI-Key': instance.token, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    console.log('PASS: existing application authentication and local session/CSRF protection.');

    const second = start();
    await new Promise((resolve, reject) => { second.once('exit', code => code === 0 ? resolve() : reject(new Error(second.output()))); second.once('error', reject); });
    const reused = await controlRequest(instance);
    assert.equal(reused.pid, first.pid); assert.deepEqual(reused.children, instance.children);
    console.log('PASS: a second launch reuses the same app and worker.');
    const site = (await api('sites', 'POST', { name: 'Smoke kitchen', url: 'https://resume-check.invalid/' })).site;
    await api('settings', 'PATCH', { timezone: 'Africa/Casablanca' });
    const backup = await api('backup', 'POST', {}); assert.ok(fs.existsSync(path.join(root, 'backups', backup.file)));
    assert.equal((await api('integrity', 'POST', {})).result, 'ok');

    // Keep an unrelated Node process alive to prove Stop does not kill processes by executable name.
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
    try { await stop(); assert.equal(unrelated.exitCode, null); } finally { unrelated.kill(); }
    await wait(300);
    assert.equal(fs.existsSync(path.join(config, 'instance.json')), false);
    console.log('PASS: backup integrity and controlled shutdown preserve an unrelated Node process.');

    const { IntelligenceStore } = require('../.intelligence-build/lib/recipe-intelligence/database.js');
    const store = await IntelligenceStore.open(root);
    const run = store.createScan(site.id); store.acquireLease('interrupted-worker');
    const item = store.claim('interrupted-worker');
    store.db.transaction(() => store.recordCandidates(item, [{ url: `${site.url}saved-soup/`, title: 'Saved soup', feedPublished: '2020-01-01' }])).immediate();
    store.db.prepare('UPDATE worker_lease SET expires_at=0').run(); store.close();

    const priorPort = instance.appPort;
    const restarted = start(); instance = await ready(restarted);
    assert.equal(instance.appPort, priorPort, 'Reuse the free local port to preserve browser origin');
    const restored = await api('snapshot'); assert.equal(restored.sites.length, 1);
    assert.equal(restored.sites[0].id, site.id); assert.equal(restored.sites[0].urls, 1);
    assert.equal((await api(`history?siteId=${site.id}`)).rows[0].published_at, null);
    let finished;
    for (let i = 0; i < 60; i++) {
      finished = (await api('snapshot')).runs.find(value => value.id === run);
      if (finished.status === 'failed') break;
      await wait(1000);
    }
    assert.equal(finished.status, 'failed', 'Recovered .invalid source must finish with an isolated DNS error');
    assert.equal((await api(`history?siteId=${site.id}`)).total, 1);
    console.log('PASS: restart restores data and reclaims an interrupted scan; failed discovery retains saved results.');
    const report = await api('reports', 'POST', { siteIds: [site.id], from: '2020-01-01', to: '2020-01-03', timezone: 'Africa/Casablanca' });
    const partial = await api(`reports/${report.jobId}`);
    assert.equal(partial.matches, 0); assert.ok(partial.coverage.some(message => message.includes('Incomplete coverage')));
    await api(`reports/${report.jobId}/action`, 'POST', { action: 'pause' });
    const defaults = (await api('snapshot')).contentSettings;
    assert.equal(defaults.basis, 'original'); assert.equal(defaults.mode, 'full');
    assert.equal(defaults.articleFormat, 'master_recipe_v1');
    await api('content-settings', 'PATCH', { ...defaults, images: false, mode: 'before_articles' });
    assert.equal((await api('model-check')).configured, true);
    const checkDb = await IntelligenceStore.open(root);
    assert.equal(checkDb.db.prepare('SELECT count(*) n FROM api_calls').get().n, 0); checkDb.close();
    console.log('PASS: reports return partial coverage, pause durably, and tracking makes zero paid calls with an API key configured.');
    await stop(); await wait(300);
    instance = await ready(start());
    assert.equal((await api(`reports/${report.jobId}`)).status, 'paused');
    assert.equal((await api('snapshot')).contentSettings.mode, 'before_articles');
    assert.equal((await api('snapshot')).contentSettings.articleFormat, 'master_recipe_v1');
    console.log('PASS: historical reports and content defaults survive another launcher restart.');
    await stop();
    console.log('All Windows launcher smoke checks passed. No paid requests were made.');
  } finally {
    await stop().catch(() => {});
    for (const child of launches) child.kill();
    await wait(500);
    if (path.dirname(temporary) !== os.tmpdir()) throw new Error('Unsafe smoke cleanup path.');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
