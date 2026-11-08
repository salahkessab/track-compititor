const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../lib/recipeLayerLayout.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleRecord = { exports: {} };
new Function('module', 'exports', compiled)(moduleRecord, moduleRecord.exports);
const { fitPhotoLayer } = moduleRecord.exports;

test('landscape, square and portrait photos fit entirely without stretching', () => {
  const area = { x: 32, y: 36, width: 1136, height: 1090 };
  for (const [width, height] of [[1600, 900], [900, 1600], [639, 639], [1, 10000]]) {
    const box = fitPhotoLayer(area, width, height);
    assert.ok(box.x >= area.x && box.y >= area.y);
    assert.ok(box.x + box.width <= area.x + area.width);
    assert.ok(box.y + box.height <= area.y + area.height);
    assert.ok(box.width >= 1 && box.height >= 1);
    if (width > 1) assert.ok(Math.abs(box.width / box.height - width / height) < 0.005);
  }
});

test('invalid photo dimensions are rejected before creating a layer', () => {
  assert.throws(() => fitPhotoLayer({ x: 0, y: 0, width: 100, height: 100 }, 0, 50));
  assert.throws(() => fitPhotoLayer({ x: 0, y: 0, width: 100, height: 100 }, Infinity, 50));
});
