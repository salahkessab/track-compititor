import { readFile } from "node:fs/promises";
import path from "node:path";
import { createZip } from "./zip";

export async function buildWordPressPackage() {
  const data = await readFile(path.join(process.cwd(), "wordpress", "recipe-intelligence-bridge", "recipe-intelligence-bridge.php"));
  const version = /\* Version: ([0-9.]+)/.exec(data.toString())?.[1];
  if (!version) throw new Error("Invalid bridge version.");
  // A single root PHP file is installable by WordPress's plugin ZIP installer.
  return { version, filename: "recipe-intelligence-bridge.zip", bytes: createZip([{ name: "recipe-intelligence-bridge.php", data }]) };
}
