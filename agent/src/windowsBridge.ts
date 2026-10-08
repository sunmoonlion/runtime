import { uriToPath } from "./pathuri.js";
import fs from "node:fs";
import { windowsDecision, isClientWindowsEnvAnnotation, isInapplicableWindowsReadGuard } from "./windowsPolicy.js";
import { pinWindowsDirectories, WindowsFiles, windowsEnvironment, type WindowsHelper, type WindowsMode, type WindowsTemporary } from "./windowsRuntime.js";
import type { Ceiling } from "./filter.js";

export interface WindowsBridgeOptions {
  roots: readonly string[]; ceiling: Ceiling; home: string; helper: WindowsHelper; mode: WindowsMode; url: () => string;
  temporary?: WindowsTemporary; executorEnvironment?: () => NodeJS.ProcessEnv;
}
export class WindowsBridge {
  private files: WindowsFiles;
  private closed = false;
  private guards = new Map<string, () => void>();
  private starts = new Map<string | number, string>();
  private finished = new Map<string, number>();
  constructor(private opts: WindowsBridgeOptions) {
    this.files = new WindowsFiles({ url: opts.url, home: opts.home, roots: opts.roots, mode: opts.mode, writable: opts.ceiling.sandbox !== "read-only", helper: opts.helper, temporary: opts.temporary?.directory });
  }
  async receive(raw: string, binary: boolean): Promise<{ forward?: string; response?: string; reason?: string; method: string }> {
    let frame: any;
    try { if (binary) throw new Error(); frame = JSON.parse(raw); } catch { return { method: "invalid-frame", reason: "binary or malformed JSON refused", response: JSON.stringify({ id: null, error: { code: -32001, message: "sunmoon-agent local ceiling: binary or malformed JSON refused" } }) }; }
    const method = typeof frame?.method === "string" ? frame.method.slice(0, 80) : "invalid-frame";
    const reject = (reason: string) => ({ method, reason, response: JSON.stringify({ id: (typeof frame?.id === "string" || Number.isSafeInteger(frame?.id)) ? frame.id : null, error: { code: -32001, message: `sunmoon-agent local ceiling: ${reason}` } }) });
    if (this.closed) return reject("stream closed");
    const decision = windowsDecision(frame, this.opts.ceiling, this.opts.roots, this.opts.home, this.opts.temporary?.directory);
    if (!decision.allow) return reject(decision.reason ?? "request refused");
    const p = frame.params;
    try {
      if (method.startsWith("fs/") || method === "environmentConfig/read") {
        const result = await this.files.call(method, p);
        return { method, response: JSON.stringify({ ...result, id: frame.id }), ...(result.error?.code === -32001 ? { reason: "filesystem worker refused request" } : {}) };
      }
      for (const [id, deadline] of this.finished) if (deadline < Date.now()) this.finished.delete(id);
      if (method === "process/start") {
        if (this.guards.has(p.processId) || this.finished.has(p.processId) || this.starts.has(frame.id)) return reject("duplicate processId or pending request id");
        if (this.guards.size >= 64) return reject("too many active processes in this stream");
        if (this.opts.temporary) {
          if (!this.opts.executorEnvironment) return reject("executor temporary environment unavailable");
          this.opts.temporary.assert(this.opts.executorEnvironment());
        }
        for (const cwd of [p.cwd, p.sandbox.cwd]) {
          try { if (!fs.statSync(uriToPath(cwd, "win32")!).isDirectory()) return reject("Windows working directory is not a directory"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return reject("Windows working directory does not exist; select an existing project directory"); throw error; }
        }
        const dirs = [p.cwd, p.sandbox.cwd, ...p.sandbox.workspaceRoots];
        p.sandbox.permissions.file_system.entries = p.sandbox.permissions.file_system.entries.filter((entry: any) => !isInapplicableWindowsReadGuard(entry));
        for (const entry of p.sandbox.permissions.file_system.entries) if (entry.path.type === "path") {
          // The client emits optional read-only guards for .codex even when
          // absent. Keep that restriction on the wire; do not create its path.
          if (entry.access === "read" && entry.missing_path_behavior === "skip") {
            try { fs.lstatSync(uriToPath(entry.path.path, "win32")!); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
          }
          dirs.push(entry.path.path);
        }
        const release = await pinWindowsDirectories(this.opts.helper, dirs.map(d => uriToPath(d, "win32")!), this.opts.home);
        if (this.closed) { release(); return reject("stream closed"); }
        this.guards.set(p.processId, release); this.starts.set(frame.id, p.processId);
        // Selection is local. Remote clients cannot downgrade elevated to unelevated.
        p.sandbox.windowsSandboxLevel = this.opts.mode === "elevated" ? "elevated" : "restricted-token";
        p.env = windowsEnvironment(this.opts.home, Object.fromEntries(Object.entries(p.env).filter(([key]) => !isClientWindowsEnvAnnotation(p, key))) as Record<string, string>, process.env, this.opts.temporary?.directory);
        // The complete, filtered local environment is now explicit. Do not
        // inherit executor internals or apply a second remote merge afterward.
        p.envPolicy = { inherit: "none", ignoreDefaultExcludes: true, exclude: [], set: {}, includeOnly: [] };
      } else if (method.startsWith("process/") && !this.guards.has(p.processId)) {
        if (method === "process/terminate" && this.finished.has(p.processId)) return { method, response: JSON.stringify({ id: frame.id, result: { running: false } }) };
        return reject("unknown processId in this stream");
      }
      return { method, forward: JSON.stringify(frame) };
    } catch { return reject("Windows path guard or sandboxed worker unavailable"); }
  }
  observe(raw: string): void {
    try {
      const f = JSON.parse(raw);
      let processId: string | undefined;
      if (this.starts.has(f.id)) { if (f.error) processId = this.starts.get(f.id); this.starts.delete(f.id); }
      if (f.method === "process/closed") processId = f.params?.processId;
      if (processId && this.guards.has(processId)) {
        this.guards.get(processId)?.(); this.guards.delete(processId);
        this.finished.set(processId, Date.now() + 60000);
        while (this.finished.size > 256) this.finished.delete(this.finished.keys().next().value!);
      }
    } catch { /* executor validation owns down-stream frames */ }
  }
  async close(): Promise<void> { this.closed = true; for (const release of this.guards.values()) release(); this.guards.clear(); this.starts.clear(); this.finished.clear(); await this.files.close(); }
}
