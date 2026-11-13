'use strict';

// This supervisor owns its child handles. It never terminates a process by name or a saved PID.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');

const repo = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const configDirectory = () => path.resolve(process.env.RECIPE_INTELLIGENCE_CONFIG_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'RecipeIntelligence'));
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}
function powershell(script, extra = {}) {
  return execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from("$ProgressPreference = 'SilentlyContinue'; " + script, 'utf16le').toString('base64')], {
    env: { ...process.env, ...extra }, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024,
  }).trim();
}
function folderPickerExecutable() {
  const source = path.join(__dirname, 'recipe-intelligence-folder-picker.cs');
  const version = createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 12);
  const executable = path.join(configDirectory(), `folder-picker-${version}.exe`);
  if (!fs.existsSync(executable)) powershell(`Add-Type -TypeDefinition ([IO.File]::ReadAllText($env:RI_PICKER_SOURCE)) -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $env:RI_PICKER_EXE -OutputType WindowsApplication`, { RI_PICKER_SOURCE: source, RI_PICKER_EXE: executable });
  return executable;
}
async function chooseRoot(previous, owned, log) {
  if (process.platform !== 'win32') throw new Error('Use --root with an absolute local directory outside Windows.');
  const executable = folderPickerExecutable();
  const resultFile = path.join(configDirectory(), `folder-choice-${randomUUID()}.txt`);
  log.write('Opening the Windows storage folder dialog.\n');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [resultFile, previous || ''], { windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] });
      owned.add(child); child.stderr.on('data', value => log.write(value));
      child.once('error', error => { owned.delete(child); reject(error); });
      child.once('exit', code => { owned.delete(child); code === 0 ? resolve() : reject(new Error('Storage selection was interrupted.')); });
    });
    return fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').trim() : '';
  } finally { if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile); }
}
function validateDrive(root) {
  if (!path.isAbsolute(root) || /^\\\\|^\/\//.test(root)) throw new Error('Choose an absolute folder on a local drive.');
  if (process.platform === 'win32') {
    const result = powershell(`$drive = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($env:RI_SELECTED_ROOT)); [Console]::Write($drive.DriveType.ToString())`, { RI_SELECTED_ROOT: root });
    if (!['Fixed', 'Removable', 'Ram'].includes(result)) throw new Error('The live database must be on a local drive, not a network or unavailable drive.');
  }
}
function fingerprint() {
  const hash = createHash('sha256').update(process.versions.node + process.platform + process.arch);
  function visit(relative) {
    const absolute = path.join(repo, relative);
    if (!fs.existsSync(absolute)) return;
    if (fs.statSync(absolute).isDirectory()) for (const item of fs.readdirSync(absolute).sort()) visit(path.join(relative, item));
    else hash.update(relative).update(fs.readFileSync(absolute));
  }
  for (const target of ['app', 'lib', 'config', 'public', 'workers', 'wordpress', 'extensions/recipe-intelligence-capture', 'package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json', 'tsconfig.local.json', 'tsconfig.intelligence.json', 'tailwind.config.ts', 'postcss.config.mjs', 'middleware.ts']) visit(target);
  return hash.digest('hex');
}
function runNode(args, env, log, owned) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    owned?.add(child);
    child.stdout.on('data', chunk => log.write(chunk)); child.stderr.on('data', chunk => log.write(chunk));
    child.once('error', error => { owned?.delete(child); reject(error); });
    child.once('exit', code => { owned?.delete(child); code === 0 ? resolve() : reject(new Error(`Local build failed (exit ${code}). See startup.log in the local application settings folder.`)); });
  });
}
async function prepareBuild(log, owned, readOnly = false) {
  const previous = readJson(path.join(repo, '.intelligence-build', 'local-build.json'));
  const lockHash = createHash('sha256').update(fs.readFileSync(path.join(repo, 'package-lock.json'))).digest('hex');
  let dependenciesReady = true;
  try {
    for (const dependency of ['next', 'typescript', 'saxes', 'robots-parser', 'cheerio', 'sharp', '@aws-sdk/client-s3', 'exiftool-vendored']) require.resolve(dependency);
    // A native module stays locked in the loading process on Windows even after
    // closing SQLite. Probe in a short-lived child so npm ci can replace it.
    const probe = require('node:child_process').spawnSync(process.execPath,
      ['-e', "const db=new(require('better-sqlite3'))(':memory:');db.close()"],
      { cwd: repo, windowsHide: true, stdio: 'ignore', timeout: 15_000 });
    if (probe.status !== 0) dependenciesReady = false;
  } catch { dependenciesReady = false; }
  if (!dependenciesReady || previous && previous.lockHash !== lockHash) {
    const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(npm)) throw new Error('Install Node.js 24 LTS with npm, then run npm ci in the application folder.');
    // better-sqlite3 13 ships Node-API binaries, but npm otherwise synthesizes
    // node-gyp rebuild from binding.gyp and asks Windows users for a compiler.
    await runNode([npm, 'ci', '--ignore-scripts'], process.env, log, owned);
    // Restore the optional native canvas package used by the existing design
    // tools. Its explicit install script downloads the vendor's prebuilt binary.
    if (fs.existsSync(path.join(repo, 'node_modules', 'canvas', 'package.json'))) {
      try { await runNode([npm, 'rebuild', 'canvas'], process.env, log, owned); }
      catch { log.write('Optional native canvas could not be prepared. Browser-based design tools remain available.\n'); }
    }
  }
  const current = fingerprint();
  if (previous?.fingerprint === current && fs.existsSync(path.join(repo, '.local-next', 'BUILD_ID')) && (readOnly || fs.existsSync(path.join(repo, '.intelligence-build', 'workers', 'recipe-intelligence.js')))) return;
  log.write(`${new Date().toISOString()} Preparing ${readOnly ? 'the recovery view (no worker)' : 'the local worker and application'}.\n`);
  if (!readOnly) await runNode([require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.intelligence.json'], process.env, log, owned);
  const nextEnvironmentFile = path.join(repo, 'next-env.d.ts');
  const originalNextEnvironment = fs.existsSync(nextEnvironmentFile) ? fs.readFileSync(nextEnvironmentFile) : null;
  try {
    await runNode([require.resolve('next/dist/bin/next'), 'build'], { ...process.env, RECIPE_INTELLIGENCE_BUILD: '1', RECIPE_INTELLIGENCE_LOCAL: '0', NEXT_TELEMETRY_DISABLED: '1' }, log, owned);
  } finally {
    // Next rewrites this shared generated declaration even with a separate tsconfig/distDir.
    if (originalNextEnvironment && fs.readFileSync(nextEnvironmentFile, 'utf8').includes('./.local-next/types/routes.d.ts')) fs.writeFileSync(nextEnvironmentFile, originalNextEnvironment);
  }
  atomicJson(path.join(repo, '.intelligence-build', 'local-build.json'), { fingerprint: current, lockHash, builtAt: new Date().toISOString() });
}
function controlRequest(instance, action = 'health') {
  return new Promise((resolve, reject) => {
    if (!instance || !Number.isInteger(instance.controlPort) || instance.controlPort < 1 || instance.controlPort > 65535 || typeof instance.token !== 'string') return reject(new Error('No running launcher was found.'));
    const request = http.request({ hostname: '127.0.0.1', port: instance.controlPort, path: `/${action}`, method: action === 'stop' ? 'POST' : 'GET', headers: { 'X-RI-Control': instance.token }, timeout: 2500 }, response => {
      let data = ''; response.on('data', chunk => { data += chunk; if (data.length > 16384) request.destroy(new Error('Invalid launcher response.')); });
      response.on('end', () => {
        try { const value = JSON.parse(data); if (response.statusCode !== 200 || value.instanceId !== instance.instanceId) throw new Error('Launcher identity did not match.'); resolve(value); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Launcher did not respond.'))); request.end();
  });
}
async function freePort(preferred = 0) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number.isInteger(preferred) && preferred > 0 && preferred <= 65535 ? preferred : 0, '127.0.0.1', resolve); });
  } catch (error) { if (preferred && ['EADDRINUSE', 'EACCES'].includes(error.code)) return freePort(); throw error; }
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
function openBrowser(instance) {
  const url = `http://127.0.0.1:${instance.appPort}/?tab=recipe-intelligence#ri-token=${instance.token}`;
  if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else console.log('Local application is ready. Open it using the saved local launcher session.');
}
function parseArgs(args) {
  const options = { noBrowser: false, choose: false, root: null, buildOnly: false, readOnly: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) options.root = path.resolve(args[++i]);
    else if (args[i] === '--no-browser') options.noBrowser = true;
    else if (args[i] === '--choose-folder') options.choose = true;
    else if (args[i] === '--build-only') options.buildOnly = true;
    else if (args[i] === '--read-only') options.readOnly = true;
    else throw new Error(`Unknown launcher option: ${args[i]}`);
  }
  return options;
}
async function main(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Install Node.js 24 LTS or newer before starting Recipe Intelligence.');
  const options = parseArgs(args);
  const config = configDirectory(); fs.mkdirSync(config, { recursive: true });
  const instanceFile = path.join(config, 'instance.json');
  const settingsFile = path.join(config, 'settings.json');
  const log = fs.createWriteStream(path.join(config, 'startup.log'), { flags: 'a', mode: 0o600 });
  if (options.buildOnly) { try { await prepareBuild(log, undefined, options.readOnly); } finally { log.end(); } return; }
  const instance = { version: 1, instanceId: randomUUID(), token: randomBytes(32).toString('hex'), pid: process.pid, repo, controlPort: 0, appPort: 0, ready: false, root: null };
  const children = new Set(); const outputStreams = new Set();
  let ownsLock = false, stopping = false, shutdownPromise, startupFailure;
  const server = http.createServer((request, response) => {
    const supplied = Buffer.from(String(request.headers['x-ri-control'] || '')); const expected = Buffer.from(instance.token);
    if (request.headers.origin || request.socket.remoteAddress !== '127.0.0.1' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { response.writeHead(403).end(); return; }
    if (request.url === '/health' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ instanceId: instance.instanceId, ready: instance.ready, root: instance.root, appPort: instance.appPort, pid: process.pid, children: [...children].map(child => child.pid) }));
    } else if (request.url === '/stop' && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ instanceId: instance.instanceId, stopping: true }));
      void shutdown();
    } else response.writeHead(404).end();
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  async function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    stopping = true; instance.ready = false;
    shutdownPromise = (async () => {
      for (const child of children) if (child.connected) child.send('stop'); else child.kill();
      for (let i = 0; i < 100 && children.size; i++) await wait(100);
      for (const child of children) child.kill();
      for (let i = 0; i < 30 && children.size; i++) await wait(100);
      if (ownsLock && readJson(instanceFile)?.instanceId === instance.instanceId) fs.unlinkSync(instanceFile);
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      for (const stream of outputStreams) stream.end();
      log.write(`${new Date().toISOString()} Local application stopped.\n`); log.end();
    })();
    return shutdownPromise;
  }
  process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  instance.controlPort = server.address().port;
  try {
    // A listening control endpoint exists before publishing the lock, so concurrent launches can verify ownership.
    for (let attempt = 0; attempt < 5 && !ownsLock; attempt++) {
      try { fs.writeFileSync(instanceFile, JSON.stringify(instance), { flag: 'wx', mode: 0o600 }); ownsLock = true; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = readJson(instanceFile);
        let live;
        try { live = await controlRequest(existing); } catch { /* Only an unresponsive lock is eligible for replacement. */ }
        if (live) {
          if (options.choose || options.root && live.root && path.resolve(live.root).toLowerCase() !== options.root.toLowerCase()) throw new Error('Stop the local application before choosing a different storage folder.');
          log.write(`${new Date().toISOString()} Reusing the existing local application.\n`);
          if (!options.noBrowser) {
            for (let i = 0; !live.ready && i < 300; i++) { await wait(1000); live = await controlRequest(existing); }
            if (!live.ready) throw new Error('The local application is still preparing. Check startup.log, then launch again.');
            openBrowser({ ...existing, appPort: live.appPort });
          }
          await shutdown(); return;
        }
        // Do not remove a lock replaced by another launcher while its health was checked.
        const current = readJson(instanceFile);
        let ownerAlive = false;
        if (existing?.pid > 0) { try { process.kill(existing.pid, 0); ownerAlive = true; } catch (error) { ownerAlive = error.code === 'EPERM'; } }
        if (ownerAlive) throw new Error('The existing launcher is still running but is not responding yet. Check startup.log and try again shortly. No duplicate application was started.');
        if (current && current.instanceId === existing?.instanceId) fs.unlinkSync(instanceFile);
        else if (!current) { await wait(100); continue; }
      }
    }
    if (!ownsLock) throw new Error('Another launcher is starting. Try opening it again.');
    const settings = readJson(settingsFile);
    const selected = options.root || (options.choose || !settings?.root ? await chooseRoot(settings?.root, children, log) : settings.root);
    if (!selected) { await shutdown(); return; }
    validateDrive(selected);
    await prepareBuild(log, children, options.readOnly);
    if (stopping) return;
    const { prepareRoot } = require(path.join(repo, '.intelligence-build', 'lib', 'recipe-intelligence', 'paths.js'));
    instance.root = prepareRoot(selected);
    instance.appPort = await freePort(settings?.port);
    atomicJson(settingsFile, { version: 1, root: instance.root, port: instance.appPort });
    atomicJson(instanceFile, instance);
    const env = { ...process.env, RECIPE_INTELLIGENCE_LOCAL: '1', RECIPE_INTELLIGENCE_BUILD: '1', RECIPE_INTELLIGENCE_ROOT: instance.root,
      RECIPE_INTELLIGENCE_TOKEN: instance.token, RECIPE_INTELLIGENCE_ORIGIN: `http://127.0.0.1:${instance.appPort}`, RECIPE_INTELLIGENCE_READ_ONLY: options.readOnly ? '1' : '0', NEXT_TELEMETRY_DISABLED: '1' };
    delete env.VERCEL;
    function startChild(args, name, childEnv, ipc = false) {
      const stream = fs.createWriteStream(path.join(instance.root, 'logs', name), { flags: 'a', mode: 0o600 }); outputStreams.add(stream);
      // Windows HTTPS inspection certificates are installed in the OS trust
      // store, not Node's bundled roots. Keep TLS verification enabled while
      // using the same trusted certificate authorities as Windows browsers.
      const nodeArgs = process.platform === 'win32' ? ['--use-system-ca', ...args] : args;
      const child = spawn(process.execPath, nodeArgs, { cwd: repo, env: childEnv, windowsHide: true, stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
      children.add(child); child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
      child.on('error', error => { children.delete(child); startupFailure = new Error(`Could not start ${name}: ${error.message}`); log.write(`${startupFailure.message}\n`); void shutdown(); });
      child.on('exit', code => { children.delete(child); if (!stopping) { startupFailure = new Error(`${name} stopped unexpectedly (exit ${code}). Check the logs and launch again to resume pending work.`); log.write(`${startupFailure.message}\n`); void shutdown(); } });
      return child;
    }
    startChild([require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(instance.appPort)], 'application.log', env);
    const workerEnv = { ...env };
    // Only the server-side content worker needs OpenAI. Discovery has no provider calls.
    for (const key of Object.keys(workerEnv)) if (key !== 'OPENAI_API_KEY' && /API_KEY|API_TOKEN|SECRET|FAL_KEY|APP_PASSWORD|RECIPE_INTELLIGENCE_TOKEN/i.test(key)) delete workerEnv[key];
    let workerReady = options.readOnly;
    if (!options.readOnly) {
      const worker = startChild([path.join(repo, '.intelligence-build', 'workers', 'recipe-intelligence.js')], 'worker.log', workerEnv, true);
      worker.on('message', message => { if (message?.type === 'ready') workerReady = true; });
    }
    let appReady = false;
    for (let i = 0; i < 150 && !stopping && (!workerReady || !appReady); i++) {
      try {
        const response = await fetch(`${env.RECIPE_INTELLIGENCE_ORIGIN}/api/recipe-intelligence/capabilities`, { signal: AbortSignal.timeout(1000) });
        appReady = response.ok && (await response.json()).enabled === true;
      } catch { appReady = false; }
      if (!workerReady || !appReady) await wait(1000);
    }
    if (stopping) { await shutdown(); if (startupFailure) throw startupFailure; return; }
    if (!workerReady || !appReady) throw new Error('Local startup timed out. Check startup.log and the logs folder inside your selected storage folder.');
    instance.ready = true; atomicJson(instanceFile, instance);
    log.write(`${new Date().toISOString()} Ready on loopback port ${instance.appPort}. ${options.readOnly ? 'Recovery view only; worker and mutations are disabled.' : 'No monitoring starts until requested.'}\n`);
    if (!options.noBrowser) openBrowser(instance);
  } catch (error) { const interrupted = stopping; await shutdown(); if (!interrupted || startupFailure) throw error; }
}

if (require.main === module) main().catch(error => {
  const message = error instanceof Error ? error.message : 'Local startup failed.';
  console.error(message);
  if (process.platform === 'win32' && !process.argv.includes('--no-browser') && !process.argv.includes('--build-only')) {
    try { spawn(folderPickerExecutable(), ['--error', message], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); } catch { /* Console and startup log remain available. */ }
  }
  process.exitCode = 1;
});
module.exports = { main, configDirectory, readJson, atomicJson, controlRequest, fingerprint, parseArgs, validateDrive };
