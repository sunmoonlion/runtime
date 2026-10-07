// Capability discovery is a real process/start, not a config-file guess.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { locateCodex } from "./paths.js";
import { freeLoopbackPort, waitForPort } from "./execServer.js";
import { assertWindowsHome, locateWindowsHelper, killWindowsTree, runSandboxProbe, windowsEnvironment, WindowsTemporary, type WindowsMode } from "./windowsRuntime.js";

export interface WindowsCapability {
  mode: WindowsMode;
  testedAt: string;
  probe: "process/start";
  elevatedSetupForHome: boolean;
  elevatedUsable: boolean;
}
export async function detectWindowsSandbox(home: string, roots: readonly string[]): Promise<WindowsCapability> {
  if (process.platform !== "win32") throw new Error("Windows capability probe must run natively");
  fs.mkdirSync(home, { recursive: true }); assertWindowsHome(home, roots);
  const helper = locateWindowsHelper();
  const codex = locateCodex();
  const version = spawnSync(codex.codexBin, ["--version"], { env: windowsEnvironment(home), encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (version.status !== 0 || version.stdout.trim() !== "codex-cli 0.155.1" || codex.version !== "0.155.1") throw new Error("Agent requires bundled Codex 0.155.1");
  const elevatedSetupForHome = fs.existsSync(path.join(home, ".sandbox-secrets"));
  const config = path.join(home, "config.toml");
  if (!fs.existsSync(config)) fs.writeFileSync(config, 'sandbox_mode="read-only"\napproval_policy="never"\n[windows]\nsandbox="unelevated"\n');
  const port = await freeLoopbackPort(); const url = `ws://127.0.0.1:${port}`;
  const temporary = await WindowsTemporary.create(home, roots, helper);
  const child = spawn(codex.codexBin, ["exec-server", "--listen", url], { cwd: home, env: windowsEnvironment(home, {}, process.env, temporary.directory), stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  let spawnFailed = false; child.once("error", () => { spawnFailed = true; });
  try {
    if (!await waitForPort(port, 10000, () => !spawnFailed && child.exitCode === null)) throw new Error("Sandbox capability executor failed to start");
    const cwd = roots[0] ?? home;
    // No automatic setup or elevation. An existing setup is usable only if an
    // actual process can be launched under it from THIS isolated CODEX_HOME.
    const elevatedUsable = elevatedSetupForHome && await runSandboxProbe(url, home, cwd, "elevated", temporary.directory).catch(() => false);
    const mode: WindowsMode = elevatedUsable ? "elevated" : "unelevated";
    if (!elevatedUsable && !await runSandboxProbe(url, home, cwd, "unelevated", temporary.directory)) throw new Error("No usable Windows sandbox; init refused");
    fs.writeFileSync(config, `sandbox_mode="read-only"\napproval_policy="never"\n[windows]\nsandbox="${mode}"\n`, { mode: 0o600 });
    return { mode, testedAt: new Date().toISOString(), probe: "process/start", elevatedSetupForHome, elevatedUsable };
  } finally { await killWindowsTree(child); await temporary.close(); }
}
