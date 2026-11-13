const test = require('node:test'), assert = require('node:assert/strict');
const { workspaceDiskStorage } = require('../.intelligence-build/lib/recipe-intelligence/diskStorage.js');

test('capacity is read from the workspace mount and excludes reserved blocks from writable space', async () => {
  let measured;
  const value = await workspaceDiskStorage('/data/private-workspace', async root => {
    measured = root; return { bsize: 4096, blocks: 1000, bfree: 800, bavail: 750 };
  });
  assert.equal(measured, '/data/private-workspace');
  assert.deepEqual(value, { status: 'available', totalBytes: 4096000, usedBytes: 1024000, freeBytes: 3072000, usedPercent: 25 });
  assert.equal(JSON.stringify(value).includes('/data/'), false);
});

test('a full disk is reported as full, while unreadable or invalid capacity is never shown as empty', async () => {
  const full = await workspaceDiskStorage('/data', async () => ({ bsize: 4096, blocks: 1000, bavail: 0 }));
  assert.equal(full.status, 'available'); assert.equal(full.freeBytes, 0); assert.equal(full.usedPercent, 100);
  for (const stats of [{ bsize: 4096, blocks: 0, bavail: 0 }, { bsize: 4096, blocks: 100, bavail: -1 }, { bsize: 4096, blocks: 100, bavail: 101 }, { bsize: 4096, blocks: NaN, bavail: 1 }, { bsize: 4096, blocks: Number.MAX_SAFE_INTEGER, bavail: 1 }]) {
    assert.deepEqual(await workspaceDiskStorage('/data', async () => stats), { status: 'unavailable' });
  }
  assert.deepEqual(await workspaceDiskStorage('/private', async () => { throw new Error('Permission denied /private'); }), { status: 'unavailable' });
});
