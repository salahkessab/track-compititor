#!/usr/bin/env node
// Runs this checkout as an isolated EXPERIMENT next to the normal app.
//
//   node scripts/run-experiment.cjs            start (offline: provider keys removed)
//   node scripts/run-experiment.cjs --allow-paid   start with this folder's own .env.local keys (ask first)
//   node scripts/run-experiment.cjs stop       stop ONLY the experiment
//
// Isolation: its own launcher config/lock, its own storage root, its own random free port and its own
// build folder (inside this checkout). It never reads or writes the normal app's config or storage.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const home = path.resolve(process.env.EXPERIMENT_HOME || path.join(os.homedir(), 'RecipeStudioExperiment'));
const configDir = path.join(home, 'config');
const dataDir = path.join(home, 'data');
const productionConfig = path.resolve(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'RecipeIntelligence'));
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

function refuseProductionPaths() {
  const production = new Set([productionConfig]);
  if (process.env.RECIPE_INTELLIGENCE_ROOT) production.add(path.resolve(process.env.RECIPE_INTELLIGENCE_ROOT));
  try { const saved = JSON.parse(fs.readFileSync(path.join(productionConfig, 'settings.json'), 'utf8')); if (saved.root) production.add(path.resolve(saved.root)); } catch { /* no normal install found: nothing to protect */ }
  for (const protectedPath of production) {
    if (inside(home, protectedPath) || inside(protectedPath, home)) throw new Error(`EXPERIMENT_HOME (${home}) overlaps a normal app location (${protectedPath}). Choose a different folder.`);
  }
}

function isolatedEnvironment(allowPaid) {
  const env = { ...process.env, RECIPE_INTELLIGENCE_CONFIG_DIR: configDir, RECIPE_INTELLIGENCE_ROOT: dataDir, NEXT_TELEMETRY_DISABLED: '1' };
  delete env.IMAGE_ASSET_ROOT; delete env.RECIPE_INTELLIGENCE_MODE; delete env.RECIPE_INTELLIGENCE_ORIGIN; delete env.SERVER_DOMAIN; delete env.VERCEL;
  for (const key of Object.keys(env)) if (/^(R2_|WORDPRESS|WP_)/i.test(key)) delete env[key];
  env.R2_ENABLED = '0';
  if (!allowPaid) { env.OPENAI_API_KEY = ''; env.FAL_KEY = ''; env.ANTHROPIC_API_KEY = ''; } // blank values also win over any .env.local file
  else {
    // The background worker is a plain Node process and does not read .env.local itself, so pass only the OpenAI key to it.
    // Other providers stay blank. The value is never printed.
    env.FAL_KEY = ''; env.ANTHROPIC_API_KEY = '';
    try {
      const line = fs.readFileSync(path.join(repo, '.env.local'), 'utf8').split(/\r?\n/).find((entry) => /^OPENAI_API_KEY\s*=/.test(entry));
      const value = line && line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
      if (value) env.OPENAI_API_KEY = value;
    } catch { /* no .env.local: the provider will report a missing key */ }
  }
  return env;
}

function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required (this app pins Node 24).');
  refuseProductionPaths();
  fs.mkdirSync(configDir, { recursive: true }); fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(home, 'EXPERIMENT_DATA_ONLY.txt'), 'Test data for the claude/article-image-experiment build. Safe to delete when the experiment ends.\n');
  const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'start';
  const allowPaid = process.argv.includes('--allow-paid');
  const env = isolatedEnvironment(allowPaid);
  if (command === 'stop') { process.exitCode = spawnSync(process.execPath, [path.join(repo, 'scripts', 'recipe-intelligence-stop.cjs')], { env, stdio: 'inherit' }).status ?? 1; return; }
  if (command !== 'start') throw new Error(`Unknown command: ${command}`);
  console.log(`Experiment data : ${dataDir}\nExperiment config: ${configDir}\nProvider calls  : ${allowPaid ? 'ENABLED by --allow-paid (uses this folder\'s .env.local)' : 'disabled (offline mode)'}`);
  const instanceFile = path.join(configDir, 'instance.json');
  const watcher = setInterval(() => {
    try { const instance = JSON.parse(fs.readFileSync(instanceFile, 'utf8')); if (instance.ready && instance.appPort) { console.log(`\nExperiment is ready: http://127.0.0.1:${instance.appPort}\nStop it with: node scripts/run-experiment.cjs stop`); clearInterval(watcher); } } catch { /* not started yet */ }
  }, 1500);
  Object.assign(process.env, env);
  require('./recipe-intelligence-launcher.cjs').main(['--root', dataDir, '--no-browser']).catch((error) => { clearInterval(watcher); console.error(error.message); process.exitCode = 1; });
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
