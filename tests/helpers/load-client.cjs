const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const modules = new Map();
module.exports = function loadClient(name) {
  const filename = path.resolve(__dirname, '../../lib', name + '.ts');
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(id => id.startsWith('./') ? loadClient(path.join(path.dirname(name), id.slice(2))) : require(id), module, module.exports);
  return module.exports;
};
