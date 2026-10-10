// Per-user Windows lifecycle behind the existing CLI. No approval RPC server.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, loadConfig, saveConfig } from "./config.js";
import { assertWindowsHome } from "./windowsRuntime.js";
import { desktopRequest, nativeDirectory, powershell } from "./windowsDesktop.js";
import { locateCodex } from "./paths.js";
import { detectWindowsSandbox } from "./windowsBootstrap.js";
import { canonicalPath } from "./pathuri.js";
import { applyLaunchEnv, installedSite, nodeLaunch } from "./siteTrust.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const statusFile = path.join(CONFIG_DIR, "status.json"), stopFile = path.join(CONFIG_DIR, "stop-request.json");
export const instanceKey = (directory: string): string => createHash("sha256").update(path.win32.resolve(directory).toLowerCase()).digest("hex").slice(0, 24);
const pipeName = () => `\\\\.\\pipe\\sunmoon-agent-${instanceKey(CONFIG_DIR)}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export function checkControlDirectory(): void {
  if (process.platform !== "win32") throw new Error("This lifecycle is Windows-only");
  const cfg = loadConfig();
  // Control files, prompts and credentials must not be writable workspace data.
  assertWindowsHome(CONFIG_DIR, cfg.roots);
}
export async function residentAlive(): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect(pipeName());
    let done = false;
    const finish = (yes: boolean) => { if (done) return; done = true; socket.destroy(); resolve(yes); };
    socket.once("connect", () => finish(true)); socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}
export async function acquireResident(onStop: () => void): Promise<{ runId: string; close: () => Promise<void> }> {
  checkControlDirectory();
  const server = net.createServer(socket => socket.destroy()); // mutex, never a command/approval endpoint
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(pipeName(), resolve); });
  const runId = randomUUID();
  const timer = setInterval(() => {
    try {
      const st = fs.lstatSync(stopFile);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 512) return;
      const request = JSON.parse(fs.readFileSync(stopFile, "utf8"));
      if (request.pid === process.pid && request.runId === runId) { fs.unlinkSync(stopFile); onStop(); }
    } catch { /* no current stop request */ }
  }, 500);
  timer.unref();
  return { runId, close: () => { clearInterval(timer); return new Promise<void>(resolve => server.close(() => resolve())); } };
}
export function readResidentStatus(): any {
  try {
    const st = fs.lstatSync(statusFile);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 65536) return null;
    return JSON.parse(fs.readFileSync(statusFile, "utf8"));
  } catch { return null; }
}
export async function stopResident(): Promise<boolean> {
  checkControlDirectory();
  if (!await residentAlive()) return false;
  const status = readResidentStatus();
  if (!Number.isSafeInteger(status?.pid) || typeof status?.runId !== "string") throw new Error("Agent is starting or is an older version; no process was killed");
  try {
    const st = fs.lstatSync(stopFile);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new Error("Unsafe stop request file");
    fs.unlinkSync(stopFile);
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  fs.writeFileSync(stopFile, JSON.stringify({ pid: status.pid, runId: status.runId }), { flag: "wx", mode: 0o600 });
  for (let i = 0; i < 100; i++) { if (!await residentAlive()) return true; await sleep(200); }
  throw new Error("Graceful stop timed out; no unrelated process was killed");
}
export async function startResident(): Promise<void> {
  checkControlDirectory();
  if (await residentAlive()) return;
  const launch = nodeLaunch(installedSite(import.meta.url));
  const child = spawn(process.execPath, [...launch.execArgv, cli, "start", "--background-worker"], { env: { ...applyLaunchEnv(process.env, launch), SUNMOON_AGENT_HOME: CONFIG_DIR }, detached: true, windowsHide: true, stdio: "ignore" });
  let failed = false; child.once("error", () => { failed = true; }); child.unref();
  for (let i = 0; i < 150; i++) {
    if (failed || child.exitCode !== null) throw new Error("Background agent could not start; inspect rotating agent log");
    const status = readResidentStatus();
    if (status?.pid === child.pid && status?.runId && await residentAlive()) return;
    await sleep(200);
  }
  throw new Error("Background agent startup timed out; inspect status before retrying");
}
function readTrayControl(file: string): { pid: number; runId: string } {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 1024) throw new Error("Unsafe tray status");
  const current = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (!Number.isInteger(current.pid) || current.pid <= 0 || !/^[a-f0-9-]{36}$/.test(current.runId)) throw new Error("Invalid tray status");
  return current;
}
function removePlainControl(file: string): void {
  if (!fs.existsSync(file)) return;
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new Error("Unsafe tray status");
  fs.unlinkSync(file);
}
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
/** A leftover stop file whose recorded tray process is gone is cleared and treated as stopped. */
export function discardDeadTrayStop(directory: string, alive: (pid: number) => boolean): "cleared" | "pending" | "continue" {
  const file = path.join(directory, "tray.json"), stop = path.join(directory, "tray-stop.json");
  if (fs.existsSync(stop)) {
    const current = readTrayControl(stop);
    if (!alive(current.pid)) { removePlainControl(stop); removePlainControl(file); return "cleared"; }
    return "pending";
  }
  if (fs.existsSync(file)) {
    const current = readTrayControl(file);
    if (!alive(current.pid)) { removePlainControl(file); return "cleared"; }
  }
  return "continue";
}
export async function closeTray(): Promise<boolean> {
  checkControlDirectory();
  const decision = discardDeadTrayStop(CONFIG_DIR, pidAlive);
  if (decision === "cleared") return true;
  if (decision === "pending") throw new Error("A tray stop request is already pending");
  const file = path.join(CONFIG_DIR, "tray.json"), stop = path.join(CONFIG_DIR, "tray-stop.json");
  if (!fs.existsSync(file)) return false;
  const current = readTrayControl(file);
  if (fs.existsSync(stop)) throw new Error("A tray stop request is already pending");
  fs.writeFileSync(stop, JSON.stringify(current), { flag: "wx" });
  for (let i = 0; i < 50; i++) { if (!fs.existsSync(file)) return true; await sleep(200); }
  throw new Error("Tray close timed out; no process was killed");
}
export async function runTray(): Promise<void> {
  checkControlDirectory();
  const child = spawn(powershell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(nativeDirectory, "desktop.ps1"), "-Action", "tray"], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(JSON.stringify({ node: process.execPath, cli, state: CONFIG_DIR, instance: instanceKey(CONFIG_DIR) }));
  await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("Tray failed; check Windows script policy"))); });
}
type DesktopChild = {
  stdin: { end(data: string, callback: () => void): void; on(event: "error", listener: () => void): void } | null;
  once(event: "error", listener: (error: Error) => void): void;
  unref(): void;
};
/** Resolve only after the PowerShell stdin payload is flushed. menu then process.exit must not drop it. */
export function deliverDesktop(
  launch: (command: string, args: string[], options: { detached: true; windowsHide: true; stdio: ["pipe", "ignore", "ignore"] }) => DesktopChild,
  command: string, args: string[], payload: string,
): Promise<void> {
  const child = launch(command, args, { detached: true, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; error ? reject(error) : resolve(); };
    child.once("error", finish);
    if (!child.stdin) { finish(new Error("Desktop input unavailable")); return; }
    child.stdin.on("error", () => finish(new Error("Desktop input unavailable")));
    child.stdin.end(payload, () => { child.unref(); finish(); });
  });
}
export function openDesktop(action: "tray" | "onboard"): Promise<void> {
  checkControlDirectory();
  return deliverDesktop(spawn, powershell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(nativeDirectory, "desktop.ps1"), "-Action", action], JSON.stringify({ node: process.execPath, cli, state: CONFIG_DIR, instance: instanceKey(CONFIG_DIR) }));
}
export async function autostart(action: string): Promise<any> {
  checkControlDirectory();
  if (!["enable", "disable", "status"].includes(action)) throw new Error("autostart enable|disable|status");
  return desktopRequest("autostart", { action, node: process.execPath, cli, state: CONFIG_DIR, instance: instanceKey(CONFIG_DIR), hiddenScript: path.join(nativeDirectory, "run-hidden.vbs") }, undefined, 30000);
}
export async function setupElevated(): Promise<object> {
  checkControlDirectory();
  if(await residentAlive()) throw new Error("Stop the agent before optional sandbox setup");
  const cfg=loadConfig(); assertWindowsHome(cfg.codexHome,cfg.roots);
  await desktopRequest("setup",{codex:locateCodex().codexBin,home:cfg.codexHome},undefined,300000);
  cfg.windowsSandbox=await detectWindowsSandbox(cfg.codexHome,cfg.roots);
  if(!cfg.windowsSandbox.elevatedUsable) throw new Error("Setup did not produce a usable elevated sandbox; previous configuration is retained");
  saveConfig(cfg);return {windowsSandbox:cfg.windowsSandbox};
}
export function preferences(argv: string[]): object {
  checkControlDirectory(); const cfg = loadConfig();
  if (argv[0] === "set") {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!input || !["ceiling,machineName,roots", "ceiling,machineName,rootChoices,roots"].includes(Object.keys(input).sort().join(","))) throw new Error("Invalid settings fields");
    const choices = input.rootChoices ?? input.roots;
    if (!Array.isArray(input.roots) || input.roots.length > 32
      || !input.roots.every((root: unknown) => typeof root === "string" && fs.statSync(root).isDirectory())
      || !Array.isArray(choices) || choices.length > 32
      || !choices.every((root: unknown) => typeof root === "string" && fs.statSync(root).isDirectory())
      || !["read-only", "workspace-write"].includes(input.ceiling?.sandbox)
      || Object.keys(input.ceiling).sort().join(",") !== "network,sandbox") throw new Error("Invalid local preferences");
    const keys = choices.map((root: string) => canonicalPath(root, "win32"));
    if (new Set(keys).size !== keys.length || new Set(input.roots.map((root: string) => canonicalPath(root, "win32"))).size !== input.roots.length
      || input.roots.some((root: string) => !keys.includes(canonicalPath(root, "win32")))) throw new Error("Invalid directory selection");
    fs.mkdirSync(cfg.codexHome, { recursive: true, mode: 0o700 });
    assertWindowsHome(CONFIG_DIR, choices); assertWindowsHome(cfg.codexHome, choices);
    cfg.roots = input.roots; cfg.rootChoices = choices; cfg.machineName = input.machineName; cfg.ceiling = input.ceiling; saveConfig(cfg);
  } else if (argv[0] && argv[0] !== "show") throw new Error("settings show|set");
  return { machineName: cfg.machineName, roots: cfg.roots, rootChoices: cfg.rootChoices ?? cfg.roots, ceiling: cfg.ceiling };
}
