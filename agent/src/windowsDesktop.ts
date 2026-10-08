// Microsoft-supplied PowerShell/WinForms only. No custom executable or network
// approval endpoint. A prompt's answer travels on its private child stdout pipe.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

export const nativeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../native");
export function powershell(): string {
  if (process.platform !== "win32" || !process.env.SystemRoot) throw new Error("Windows is required");
  return path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
}

export function desktopRequest(action: string, data: object, signal?: AbortSignal, timeoutMs = 65000): Promise<any> {
  if (process.platform !== "win32" || signal?.aborted) return Promise.reject(new Error("Windows request unavailable"));
  const script = path.join(nativeDirectory, "desktop.ps1");
  if (!fs.statSync(script).isFile()) return Promise.reject(new Error("Desktop script unavailable"));
  return new Promise((resolve, reject) => {
    const child = spawn(powershell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script, "-Action", action],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", done = false;
    const finish = (error?: Error, result?: unknown) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (child.exitCode === null) child.kill();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new Error("Local dialog cancelled"));
    const timer = setTimeout(() => finish(new Error("Local dialog timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", data => { output += String(data); if (output.length > 65536) finish(new Error("Invalid desktop response")); });
    // Never copy PowerShell raw output to logs: input can include private paths.
    child.stderr.resume(); child.stdin.on("error", () => finish(new Error("Desktop input unavailable")));
    child.once("error", () => finish(new Error("Cannot start Windows desktop interface")));
    child.once("close", code => {
      if (code !== 0) { finish(new Error("Windows desktop operation failed; check script policy locally")); return; }
      try { finish(undefined, JSON.parse(output.trim())); } catch { finish(new Error("Invalid desktop response")); }
    });
    child.stdin.end(JSON.stringify(data));
  });
}

let prompting = false;
export async function windowsConfirm(description: string, signal?: AbortSignal): Promise<boolean> {
  if (prompting || signal?.aborted) return false;
  prompting = true;
  try {
    const challenge = randomBytes(16).toString("hex");
    const response = await desktopRequest("confirm", { description, challenge }, signal);
    return !signal?.aborted && response?.approved === true && response?.challenge === challenge;
  } catch { return false; }
  finally { prompting = false; }
}
