import { readFile } from "node:fs/promises";
import path from "node:path";
import { createZip } from "./zip";

// Only distributable files. Never package a workspace, environment file, or saved capture.
const files = [
  "background.js", "capture.html", "capture.css", "capture.js", "connection.js", "content.js", "shared.js",
  "README.md", "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
] as const;

export async function buildCaptureExtensionPackage() {
  const directory = path.join(process.cwd(), "extensions", "recipe-intelligence-capture");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) throw new Error("Invalid extension version.");
  // Our ZIP writer uses flat entry names. Adjust only the icon paths in this copy.
  const icons = { "16": "icon16.png", "48": "icon48.png", "128": "icon128.png" };
  manifest.icons = icons; manifest.action.default_icon = icons;
  const entries = await Promise.all(files.map(async file => ({
    name: path.basename(file).toLowerCase(), data: await readFile(path.join(directory, file)),
  })));
  entries.unshift({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") });
  return { version: manifest.version as string, filename: "recipe-intelligence-capture.zip", bytes: createZip(entries) };
}
