'use strict';
// Supply RECIPE_INTELLIGENCE_SECRET_KEY through the host environment or Node's
// --env-file. Never put credentials in command-line arguments or the bundle.
const path = require('node:path');
const { preparePortableWorkspace, restorePortableWorkspace } = require('../.intelligence-build/lib/recipe-intelligence/portableWorkspace.js');
(async () => {
  const [action, source, destination, checksum] = process.argv.slice(2);
  if (!source || !destination || !['prepare', 'restore'].includes(action)) throw Error('Usage: migrate-portable-workspace.cjs prepare <source-root> <new-bundle-folder> OR restore <bundle-folder> <new-workspace-folder> <manifest-sha256>');
  const result = action === 'prepare'
    ? await preparePortableWorkspace(path.resolve(source), path.resolve(destination))
    : await restorePortableWorkspace(path.resolve(source), path.resolve(destination), checksum);
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
