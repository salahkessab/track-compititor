import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverKey, serverMode } from "./runtime";

export type SecretProtection = { protect(value: string): Promise<string>; unprotect(value: string): Promise<string> };

// Windows DPAPI binds the encrypted secret to the current Windows account.
// The secret travels over stdin, never command-line arguments or a temp file.
async function dpapi(mode: "protect" | "unprotect", value: string): Promise<string> {
  if (process.platform !== "win32") throw new Error("Save the WordPress connection from the Windows local launcher.");
  if (!value || value.length > 8192) throw new Error("Invalid local credential.");
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser; $entropy=[Text.Encoding]::UTF8.GetBytes('RecipeIntelligence.WordPress.v1'); ${mode === "protect"
    ? "$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$entropy,$scope); [Console]::Out.Write([Convert]::ToBase64String($b))"
    : "$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$entropy,$scope); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))"}`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let failed = false;
    const fail = () => { failed = true; reject(new Error("Windows could not unlock the saved WordPress connection. Reconnect from Settings with this Windows account.")); };
    const timer = setTimeout(() => { child.kill(); fail(); }, 15_000);
    child.stdout.on("data", data => { output += data.toString(); if (output.length > 16384) { child.kill(); fail(); } });
    child.stderr.resume(); child.stdin.on("error", fail); child.on("error", fail);
    child.on("close", code => { clearTimeout(timer); if (failed) return; if (code !== 0 || !output) fail(); else resolve(output); });
    child.stdin.end(value);
  });
}
export const windowsSecrets: SecretProtection = { protect: value => dpapi("protect", value), unprotect: value => dpapi("unprotect", value) };

// Portable authenticated encryption. The key lives in the host's secret store,
// never in SQLite, R2 objects, the browser, or exported recipes.
export const serverSecrets: SecretProtection = {
  async protect(value) {
    if (!value || value.length > 8192) throw new Error("Invalid credential.");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", serverKey(), iv);
    cipher.setAAD(Buffer.from("RecipeIntelligence.WordPress.server.v1"));
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["ri1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
  },
  async unprotect(value) {
    try {
      const [version, iv, tag, data, extra] = value.split(":");
      if (version !== "ri1" || extra || !iv || !tag || !data || value.length > 16384) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", serverKey(), Buffer.from(iv, "base64"));
      decipher.setAAD(Buffer.from("RecipeIntelligence.WordPress.server.v1"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
    } catch { throw new Error("The server could not unlock this WordPress connection. Check its encryption key or reconnect in Settings."); }
  },
};
export function credentialProtection(): SecretProtection { return serverMode() ? serverSecrets : windowsSecrets; }
