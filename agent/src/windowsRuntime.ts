import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { locateCodex } from "./paths.js";
import { isUnder, canonicalPath } from "./pathuri.js";
import { isReservedWindowsEnv } from "./windowsPolicy.js";

export type WindowsMode = "elevated" | "unelevated";
export function windowsEnvironment(home: string, overrides: Record<string, string> = {}, inherited: NodeJS.ProcessEnv = process.env, temporary?: string): Record<string, string> {
  // Windows keys are case-insensitive. Canonicalize before merging so PATH
  // really overrides Path; Node otherwise chooses one of the duplicate keys.
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) if (value !== undefined && !isReservedWindowsEnv(key)) result[key.toUpperCase()] = value;
  for (const [key, value] of Object.entries(overrides)) {
    if (isReservedWindowsEnv(key)) {
      if (key === "CODEX_HOME" && value === home) continue;
      throw new Error("reserved executor environment override");
    }
    result[key.toUpperCase()] = value;
  }
  return { ...result, CODEX_HOME: home, ...(temporary ? { TEMP: temporary, TMP: temporary, TMPDIR: temporary } : {}) };
}
export function assertWindowsHome(home: string, roots: readonly string[]): void {
  if (canonicalPath(home, "win32") === null) throw new Error("Windows executor home must be on a local drive");
  if (fs.existsSync(path.join(home, "auth.json"))) throw new Error("Executor home contains auth.json; use a credential-free agent home");
  const protectedPaths = [home, path.dirname(home), path.dirname(path.dirname(fileURLToPath(import.meta.url))), process.execPath];
  if (roots.some(root => protectedPaths.some(p => isUnder(p, root, "win32")))) throw new Error("Writable root overlaps agent configuration, executor home or installed code");
  for (const root of [...roots, home]) {
    if (canonicalPath(root, "win32") === null || !fs.statSync(root).isDirectory()) throw new Error("Windows root must be an existing local directory");
    let p = root;
    while (true) {
      if (fs.lstatSync(p).isSymbolicLink()) throw new Error("Reparse point in configured root");
      if (canonicalPath(fs.realpathSync.native(p), "win32") !== canonicalPath(p, "win32")) throw new Error("Root alias refused");
      const parent = path.dirname(p); if (parent === p) break; p = parent;
    }
  }
}
export function windowsProfile(cwd: string, roots: readonly string[], mode: WindowsMode, writable = true): any {
  return {
    permissions: { type: "managed", file_system: { type: "restricted", entries: [
      { path: { type: "special", value: { kind: "root" } }, access: "read" },
      ...(writable ? [{ path: { type: "special", value: { kind: "project_roots" } }, access: "write" }] : []),
    ] }, network: "restricted" },
    cwd: pathToFileURL(cwd).href, workspaceRoots: roots.map(r => pathToFileURL(r).href),
    windowsSandboxLevel: mode === "elevated" ? "elevated" : "restricted-token", useLegacyLandlock: false,
  };
}
export async function killWindowsTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const result = spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, encoding: "utf8", timeout: 10000 });
  if (result.error) throw new Error("Windows process tree termination failed");
  await new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); const t = setTimeout(resolve, 2000); child.once("exit", () => { clearTimeout(t); resolve(); }); });
  if (child.exitCode === null && child.signalCode === null) throw new Error("Windows executor still alive after taskkill /T");
}

export class LocalRpc {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  readonly listeners = new Set<(frame: any) => void>();
  private constructor(readonly ws: WebSocket) {
    ws.on("message", raw => { const f = JSON.parse(String(raw)); const p = this.pending.get(f.id); if (p) { clearTimeout(p.timer); this.pending.delete(f.id); p.resolve(f); } else for (const listener of this.listeners) listener(f); });
    ws.on("close", () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("local executor disconnected")); } this.pending.clear(); });
    ws.on("error", () => {});
  }
  static async connect(url: string): Promise<LocalRpc> {
    const ws = new WebSocket(url, { maxPayload: 16 * 1024 * 1024 });
    const rpc = new LocalRpc(ws);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("executor connect timeout")); }, 5000);
      ws.once("open", () => { clearTimeout(timer); resolve(); }); ws.once("error", () => { clearTimeout(timer); reject(new Error("executor connection failed")); });
    });
    const init = await rpc.call("initialize", { clientName: "sunmoon-agent-local-helper" });
    if (init.error || init.result?.environmentInfo?.executorVersion !== "0.155.1") { rpc.close(); throw new Error("helper requires exec-server 0.155.1"); }
    ws.send(JSON.stringify({ method: "initialized", params: {} }));
    return rpc;
  }
  call(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => { const id = ++this.seq; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`local RPC timeout: ${method}`)); }, 15000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  close(): void { this.ws.terminate(); }
}

export async function runSandboxProbe(url: string, home: string, cwd: string, mode: WindowsMode, temporary?: string): Promise<boolean> {
  const rpc = await LocalRpc.connect(url); const processId = `probe-${randomUUID()}`;
  let result: any;
  let timer: NodeJS.Timeout | undefined;
  try {
    const closed = new Promise<any>((resolve, reject) => { timer = setTimeout(() => reject(new Error("sandbox probe timeout")), 12000); rpc.listeners.add(f => { if (f.method === "process/exited" && f.params.processId === processId) { clearTimeout(timer); resolve(f.params); } }); });
    void closed.catch(() => {});
    // Probe real launch with the isolated home; no setup/UAC or model request.
    const response = await rpc.call("process/start", { processId, tty: false, env: windowsEnvironment(home, {}, process.env, temporary), argv: [process.execPath, "-e", "process.stdout.write('sunmoon-sandbox-probe')"], cwd: pathToFileURL(cwd).href, sandbox: windowsProfile(cwd, [cwd], mode, false), enforceManagedNetwork: false, managedNetwork: null });
    if (response.error) { closed.catch(() => {}); return false; }
    result = await closed;
    return response.result?.sandboxType === "windowsRestrictedToken" && result.exitCode === 0;
  } finally { clearTimeout(timer); if (!result) await rpc.call("process/terminate", { processId }).catch(() => {}); rpc.close(); }
}

export interface WindowsHelper { node: string; script: string }
export function locateWindowsHelper(): WindowsHelper {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../native/helper.mjs");
  if (!fs.existsSync(script)) throw new Error("Windows Node helper missing from agent package");
  return { node: process.execPath, script };
}

/** CLI configuration is generated locally; no shell, remote profile or executable. */
export function windowsHelperArgs(home: string, roots: readonly string[], mode: WindowsMode, writable: boolean, helper: WindowsHelper, notFound?: { file: any; directory: any }): string[] {
  const entries = ['":root"="read"', ...(writable ? roots.map(r => `${JSON.stringify(r)}="write"`) : [])];
  const profile = `permissions.sunmoon_files={filesystem={${entries.join(",")}},network={enabled=false}}`;
  const config = Buffer.from(JSON.stringify({ home, notFound, roots: writable ? roots : [], reads: [...roots, home], deniedReads: [path.join(home, ".sandbox-secrets"), path.join(home, "auth.json")] })).toString("base64");
  return ["-c", profile, "-c", `windows.sandbox="${mode}"`, "sandbox", "--permission-profile", "sunmoon_files", "-C", roots[0] ?? home, "--", helper.node, helper.script, config];
}

export class WindowsFiles {
  private child?: ChildProcess;
  private seq = 0;
  private buffer = "";
  private stopped = false;
  private starting?: Promise<void>;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private opts: { url: () => string; home: string; roots: readonly string[]; mode: WindowsMode; writable: boolean; helper: WindowsHelper; temporary?: string }) {}
  private async start(): Promise<void> {
    const o = this.opts;
    // Capture localized Windows messages from the pinned executor, rather than
    // baking this development machine's language into distributed code.
    const rpc = await LocalRpc.connect(o.url());
    let notFound: { file: any; directory: any };
    try {
      const absent = path.join(o.home, `.sunmoon-not-found-${randomUUID()}`);
      const file = (await rpc.call("fs/getMetadata", { path: pathToFileURL(absent).href, sandbox: null })).error;
      const directory = (await rpc.call("fs/readFile", { path: pathToFileURL(path.join(absent, "child")).href, sandbox: null })).error;
      if ([file, directory].some(e => e?.code !== -32004 || typeof e.message !== "string")) throw new Error("Unexpected executor not-found contract");
      notFound = { file: { code: file.code, message: file.message }, directory: { code: directory.code, message: directory.message } };
    } finally { rpc.close(); }
    if (this.stopped) throw new Error("filesystem worker closed");
    this.child = spawn(locateCodex().codexBin, windowsHelperArgs(o.home, o.roots, o.mode, o.writable, o.helper, notFound), { cwd: o.roots[0] ?? o.home, env: windowsEnvironment(o.home, {}, process.env, o.temporary), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child.stdout!.on("data", d => {
      this.buffer += String(d);
      if (this.buffer.length > 16 * 1024 * 1024) { void this.close(); return; }
      let n; while ((n = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, n); this.buffer = this.buffer.slice(n + 1);
        try { const v = JSON.parse(line); const p = this.pending.get(v.id); if (p) { clearTimeout(p.timer); this.pending.delete(v.id); p.resolve(v); } } catch { void this.close(); }
      }
    });
    // Drain without forwarding paths, command output or credentials into logs.
    this.child.stderr!.resume();
    this.child.once("error", () => { void this.close(); });
    this.child.once("exit", () => { void this.close(); });
    this.child.stdin!.on("error", () => { void this.close(); });
  }
  async call(method: string, params: any): Promise<any> {
    if (this.stopped) throw new Error("filesystem worker closed");
    if (!this.starting) this.starting = this.start();
    await this.starting;
    if (this.stopped) throw new Error("filesystem worker closed");
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("filesystem worker timeout")); void this.close(); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async close(): Promise<void> {
    if (this.stopped) return; this.stopped = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("sandboxed filesystem worker unavailable")); } this.pending.clear();
    if (this.child) await killWindowsTree(this.child);
  }
}

/** A Windows current-directory handle prevents renaming it or its ancestors.
 * This local guard only pins a directory; all remote FS operations run sandboxed. */
export type WindowsDirectoryGuard = (() => void) & { assert: () => void; close: () => Promise<void> };
export async function pinWindowsDirectories(helper: WindowsHelper, dirs: readonly string[], home: string): Promise<WindowsDirectoryGuard> {
  const children: ChildProcess[] = [];
  const release = () => { for (const c of children) c.stdin?.end(); };
  try {
    for (const dir of new Set(dirs)) {
      const child = spawn(helper.node, [helper.script, "--pin-directory"], { cwd: dir, env: windowsEnvironment(home), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      children.push(child); child.stderr!.resume(); child.stdin!.on("error", () => {});
      await new Promise<void>((resolve, reject) => {
        let output = ""; const t = setTimeout(() => reject(new Error("Windows directory guard timeout")), 5000);
        child.once("error", () => { clearTimeout(t); reject(new Error("directory guard unavailable")); });
        child.once("exit", () => { clearTimeout(t); reject(new Error("directory guard refused path")); });
        child.stdout!.on("data", d => { output += String(d); if (output.includes('{"ready":true}')) { clearTimeout(t); resolve(); } });
      });
      if (canonicalPath(fs.realpathSync.native(dir), "win32") !== canonicalPath(dir, "win32")) throw new Error("directory guard path alias");
    }
  } catch (error) { release(); for (const c of children) await killWindowsTree(c); throw error; }
  return Object.assign(release, {
    assert: () => { if (children.some(c => c.exitCode !== null || c.signalCode !== null)) throw new Error("Windows directory guard stopped"); },
    close: async () => { release(); for (const c of children) await killWindowsTree(c); },
  });
}

/** One agent-owned temp directory for one executor lifetime. Never sweep the
 * parent: other running agents may own siblings. Stop executor before close. */
export class WindowsTemporary {
  private constructor(readonly directory: string, private guard: WindowsDirectoryGuard, private identity: { dev: bigint; ino: bigint }) {}
  static async create(home: string, roots: readonly string[], helper: WindowsHelper): Promise<WindowsTemporary> {
    const local = process.env.LOCALAPPDATA;
    if (process.platform !== "win32" || !local || canonicalPath(local, "win32") === null) throw new Error("Windows LOCALAPPDATA required");
    const parent = path.join(local, "sunmoon-agent", "tmp");
    if (roots.some(root => isUnder(parent, root, "win32") || isUnder(root, parent, "win32"))) throw new Error("Temporary storage overlaps project roots");
    // Pin the existing ancestor before creating descendants. Reparse aliases
    // in the parent are checked again by the directory guard before use.
    const ancestor = await pinWindowsDirectories(helper, [local], home);
    let directory: string | undefined;
    try {
      for (const candidate of [path.dirname(parent), parent]) {
        try { const s = fs.lstatSync(candidate); if (!s.isDirectory() || s.isSymbolicLink()) throw new Error("Temporary storage parent alias refused"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      fs.mkdirSync(parent, { recursive: true });
      const parentGuard = await pinWindowsDirectories(helper, [parent], home);
      try {
        directory = fs.mkdtempSync(path.join(parent, "executor-"));
        const guard = await pinWindowsDirectories(helper, [directory], home);
        return new WindowsTemporary(directory, guard, fs.statSync(directory, { bigint: true }));
      } finally { await parentGuard.close(); }
    } catch (error) { if (directory) fs.rmSync(directory, { recursive: true, force: true }); throw error; }
    finally { await ancestor.close(); }
  }
  assert(environment?: NodeJS.ProcessEnv): void {
    this.guard.assert();
    const s = fs.lstatSync(this.directory, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || s.dev !== this.identity.dev || s.ino !== this.identity.ino || canonicalPath(fs.realpathSync.native(this.directory), "win32") !== canonicalPath(this.directory, "win32")) throw new Error("Owned temporary directory changed");
    if (environment && ["TEMP", "TMP", "TMPDIR"].some(k => environment[k] !== this.directory || Object.keys(environment).some(other => other !== k && other.toUpperCase() === k))) throw new Error("Executor temporary environment changed");
  }
  async close(): Promise<void> {
    this.assert(); await this.guard.close();
    fs.rmSync(this.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
