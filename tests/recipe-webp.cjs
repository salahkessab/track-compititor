const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const sharp = require('sharp');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = id => {
    if (id.startsWith('@/')) return load(path.resolve(__dirname, '..', id.slice(2) + '.ts'));
    if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'));
    return require(id);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}
const { encodeRecipeWebp, compressRecipeWebp, WEBP_TARGET_BYTES } = load(path.resolve(__dirname, '../lib/recipeWebp.ts'));
const settings = load(path.resolve(__dirname, '../lib/openaiImageSettings.ts'));

test('compression prioritizes high quality over a hard byte limit', async () => {
  const attempts = [];
  const canvas = { toBlob(callback, type, quality) {
    attempts.push(quality);
    callback(new Blob([new Uint8Array(Math.round(quality * 500000))], { type }));
  } };
  const result = await encodeRecipeWebp(canvas);
  assert.deepEqual(attempts, [0.92, 0.90, 0.88]);
  assert.ok(result.size > WEBP_TARGET_BYTES, 'do not sacrifice quality to force 300 KB');
  assert.equal(result.type, 'image/webp');
});

test('compression stops at the highest quality that meets the target and detects PNG fallback', async () => {
  let calls = 0;
  const result = await encodeRecipeWebp({ toBlob(callback, type, quality) {
    calls++; assert.equal(quality, 0.92); callback(new Blob(['small'], { type }));
  } });
  assert.equal(calls, 1);
  assert.equal(result.type, 'image/webp');
  await assert.rejects(encodeRecipeWebp({ toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })) }), /cannot export WebP/);
  await assert.rejects(encodeRecipeWebp({ toBlob: callback => callback(null) }), /Could not compress/);
});

test('real WebP encoding preserves full WordPress dimensions and transparency', async () => {
  const sourceBytes = await sharp({ create: { width: 1536, height: 864, channels: 4, background: { r: 70, g: 120, b: 180, alpha: 0.5 } } }).png().toBuffer();
  const source = new Blob([sourceBytes], { type: 'image/png' });
  const oldDocument = global.document, oldBitmap = global.createImageBitmap;
  let closed = false, canvas;
  global.createImageBitmap = async blob => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    return { width: meta.width, height: meta.height, bytes, close() { closed = true; } };
  };
  global.document = { createElement() {
    canvas = { width: 0, height: 0, source: null,
      getContext() { return { drawImage: bitmap => { canvas.source = bitmap.bytes; } }; },
      toBlob(callback, type, quality) { sharp(canvas.source).webp({ quality: Math.round(quality * 100) }).toBuffer().then(bytes => callback(new Blob([bytes], { type }))); },
    };
    return canvas;
  } };
  try {
    const result = await compressRecipeWebp(source);
    const meta = await sharp(Buffer.from(await result.arrayBuffer())).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 1536); assert.equal(meta.height, 864); assert.equal(meta.hasAlpha, true);
    assert.equal(canvas.width, 1536); assert.equal(canvas.height, 864); assert.equal(closed, true);
    assert.equal(await compressRecipeWebp(result), result, 'small WebP must not be recompressed');
  } finally { global.document = oldDocument; global.createImageBitmap = oldBitmap; }
});

test('WordPress and logos are opt-in and horse defaults stay PNG', () => {
  const { OpenAIImageControls } = load(path.resolve(__dirname, '../app/components/OpenAIImageControls.tsx'));
  const props = { model: 'gpt-image-2.6-sunburst', value: { ...settings.DEFAULT_IMAGE_SETTINGS }, onChange() {}, disabled: false };
  const horse = renderToStaticMarkup(React.createElement(OpenAIImageControls, props));
  assert.doesNotMatch(horse, /WordPress|brand-icons|1536×864/);
  assert.equal(settings.DEFAULT_IMAGE_SETTINGS.output_format, 'png');
  const recipe = renderToStaticMarkup(React.createElement(OpenAIImageControls, { ...props, recipePresets: true, quickSettingsOnly: true }));
  for (const platform of ['facebook', 'pinterest', 'wordpress']) assert.ok(recipe.includes(`/brand-icons/${platform}.svg`));
  assert.match(recipe, /1536 × 864/);
  const { RECIPE_IMAGE_TO_IMAGE_SETTINGS } = load(path.resolve(__dirname, '../lib/recipeImageToImageSettings.ts'));
  assert.equal(RECIPE_IMAGE_TO_IMAGE_SETTINGS.output_format, 'webp');
  assert.equal(RECIPE_IMAGE_TO_IMAGE_SETTINGS.quality, 'high');
  assert.throws(() => settings.validateImageSettings('gpt-image-1.5', { size: '1536x864' }), /Unsupported image size/);
});

test('WordPress recipe composition and export use landscape without changing literal titles', () => {
  const { recipeDirectPrompt } = load(path.resolve(__dirname, '../lib/recipeDesignDirect.ts'));
  const { recipeDesignDimensions } = load(path.resolve(__dirname, '../lib/recipeDesignOutput.ts'));
  const prompt = recipeDirectPrompt('vintage_farmhouse_recipe', 'Portrait 4:5 Cake', '', undefined, undefined, '1536x864');
  assert.ok(prompt.includes('Portrait 4:5 Cake'));
  assert.match(prompt, /1536 × 864 landscape WordPress/);
  assert.doesNotMatch(prompt, /centered 4:5 safe area|4:5 vertical format/);
  assert.deepEqual(recipeDesignDimensions('1536x864'), { width: 1536, height: 864 });
  assert.deepEqual(recipeDesignDimensions('1024x1536'), { width: 1200, height: 1500 });
});
