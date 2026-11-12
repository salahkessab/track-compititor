import fs from "node:fs";
import path from "node:path";

// The deployment runner owns this short-lived marker. It pauses new work while
// current stages finish, without aborting or repeating a provider request.
export function deploymentPause(root: string): { revision: string; expiresAt: number } | null {
  if (process.env.RECIPE_INTELLIGENCE_MODE !== "server") return null;
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, "deployment-maintenance.json"), "utf8"));
    return /^[a-f0-9]{40}$/.test(value.revision) && Number.isSafeInteger(value.expiresAt)
      && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + 60 * 60_000 ? value : null;
  } catch { return null; }
}

export function acknowledgeDeployment(root: string, revision: string) {
  const target = path.join(root, "deployment-drained.json");
  const temporary = target + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify({ revision, at: Date.now() }), { mode: 0o600 });
  fs.renameSync(temporary, target);
}
