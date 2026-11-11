import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function prepareRoot(input: string): string {
  if (!input || !path.isAbsolute(input) || /^\\\\|^\/\//.test(input) || /[\x00-\x1f]/.test(input)) throw new Error("Choose an absolute folder on a local drive.");
  const root = path.resolve(input);
  if (root === path.parse(root).root) throw new Error("Choose a folder, not a drive root.");
  fs.mkdirSync(root, { recursive: true });
  const real = fs.realpathSync(root);
  if (/^\\\\|^\/\//.test(real)) throw new Error("Network storage is not supported for the live database.");
  for (const name of ["database", "reports", "research", "articles", "images", "exports", "backups", "logs"]) {
    const dir = path.join(real, name);
    fs.mkdirSync(dir, { recursive: true });
    assertInside(real, fs.realpathSync(dir));
  }
  const probe = path.join(real, `.write-test-${randomUUID()}`);
  fs.writeFileSync(probe, "", { flag: "wx" }); fs.unlinkSync(probe);
  return real;
}

export function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Path is outside the selected storage folder.");
}

export function storagePath(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts);
  assertInside(root, target);
  let ancestor = target;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  assertInside(root, fs.realpathSync(ancestor));
  return target;
}

export function localRoot(): string {
  if (process.env.RECIPE_INTELLIGENCE_LOCAL !== "1" || process.env.VERCEL) throw new Error("Recipe Intelligence storage is available only through the local launcher.");
  if (!process.env.RECIPE_INTELLIGENCE_ROOT) throw new Error("Choose a storage folder with the local launcher.");
  return prepareRoot(process.env.RECIPE_INTELLIGENCE_ROOT);
}
