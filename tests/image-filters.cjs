const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../lib/imageFilters.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleRecord = { exports: {} };
new Function('module', 'exports', compiled)(moduleRecord, moduleRecord.exports);
const { applyImageAdjustments, IMAGE_FILTER_PRESETS, ORIGINAL_ADJUSTMENTS } = moduleRecord.exports;

test('the original preset leaves every channel exactly unchanged', () => {
  const bytes = new Uint8ClampedArray([10, 100, 200, 255, 200, 20, 90, 90, 7, 8, 9, 0]);
  const original = bytes.slice();
  applyImageAdjustments(bytes, 3, ORIGINAL_ADJUSTMENTS);
  assert.deepEqual(bytes, original);
});

test('presets adjust colors without changing alpha or transparent pixels', () => {
  const original = new Uint8ClampedArray([30, 90, 180, 255, 120, 80, 40, 100, 1, 2, 3, 0]);
  assert.equal(IMAGE_FILTER_PRESETS.length, 9);
  assert.equal(new Set(IMAGE_FILTER_PRESETS.map(preset => preset.id)).size, 9);
  for (const preset of IMAGE_FILTER_PRESETS.slice(1)) {
    const output = original.slice();
    applyImageAdjustments(output, 3, preset.adjustments);
    assert.notDeepEqual(output.slice(0, 3), original.slice(0, 3), preset.label);
    assert.equal(output[3], 255); assert.equal(output[7], 100);
    assert.deepEqual(output.slice(8, 12), original.slice(8, 12));
  }
});

test('warmth moves red and blue in opposite directions and grain is repeatable', () => {
  const pixels = new Uint8ClampedArray(4 * 16).fill(120);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const warm = pixels.slice();
  applyImageAdjustments(warm, 4, { ...ORIGINAL_ADJUSTMENTS, warmth: 20 });
  assert.ok(warm[0] > pixels[0]); assert.ok(warm[2] < pixels[2]);
  const first = pixels.slice(), second = pixels.slice();
  applyImageAdjustments(first, 4, { ...ORIGINAL_ADJUSTMENTS, grain: 15 });
  applyImageAdjustments(second, 4, { ...ORIGINAL_ADJUSTMENTS, grain: 15 });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, pixels);
});
