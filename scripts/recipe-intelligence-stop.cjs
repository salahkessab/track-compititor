'use strict';
const path = require('node:path');
const { configDirectory, readJson, controlRequest } = require('./recipe-intelligence-launcher.cjs');
async function stop() {
  const instance = readJson(path.join(configDirectory(), 'instance.json'));
  if (!instance) { console.log('Recipe Intelligence is already stopped.'); return; }
  try { await controlRequest(instance); } catch { throw new Error('The saved launcher is not responding. No other processes were stopped.'); }
  await controlRequest(instance, 'stop');
  for (let i = 0; i < 150; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { await controlRequest(instance); } catch { console.log('Recipe Intelligence stopped. Pending scans will resume on the next launch.'); return; }
  }
  throw new Error('Shutdown is still finishing. No unrelated processes were stopped.');
}
if (require.main === module) stop().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { stop };
