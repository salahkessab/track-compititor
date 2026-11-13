const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
module.exports = function loadComponent(name) {
  const filename = path.join(__dirname, '../../app/components', name + '.tsx');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id.startsWith('./')) return loadComponent(id.slice(2));
    if (id.startsWith('@/lib/')) return require('./load-client.cjs')(id.slice('@/lib/'.length));
    if (id.startsWith('../../lib/recipe-intelligence/')) return require(path.join(__dirname, '../../.intelligence-build/lib/recipe-intelligence', id.split('/').at(-1) + '.js'));
    if (id.startsWith('../../lib/')) return require('./load-client.cjs')(id.slice('../../lib/'.length));
    return require(id);
  }, module, module.exports);
  return module.exports;
};
