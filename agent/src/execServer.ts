// exec-server 守护：经外沙箱拉起 `codex exec-server --listen ws://127.0.0.1:PORT`，stdin 保持打开（它在 stdin 关闭时退出），
// 进程死了才重启；桥断线不重启（会话 id 在它内存里，25 秒窗内要接回同一个进程，见 REPORT-2026-09-23-reconnect.md）。
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { log } from "./log.js";
import { wrapCommand } from "./outerSandbox.js";

export interface ExecServerOptions {
  codexBin: string;
  bwrap: string | null;
  outerSandbox: boolean;
  roots: readonly string[];
  codexHome: string;
  port: number; // 0 = 自动
  env?: Record<string, string>;
}

export async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export async function waitForPort(port: number, timeoutMs: number, alive: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive()) return false;
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect({ port, host: "127.0.0.1" });
      s.once("connect", () => { s.destroy(); resolve(true); });
      s.once("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export class ExecServer {
  private child: ChildProcess | null = null;
  private stopping = false;
  private restarts = 0;
  port = 0;
  sandboxed = false;
  generation = 0;
  private starting: Promise<void> | null = null;
  constructor(private readonly opts: ExecServerOptions) {}

  get url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  get alive(): boolean {
    return this.child != null && this.child.exitCode == null && this.child.signalCode == null;
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.startOnce().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async startOnce(): Promise<void> {
    this.stopping = false;
    fs.mkdirSync(this.opts.codexHome, { recursive: true, mode: 0o700 });
    const cfg = `${this.opts.codexHome}/config.toml`;
    if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, 'sandbox_mode = "read-only"\napproval_policy = "never"\n', { mode: 0o600 });
    this.port = this.opts.port || (await freeLoopbackPort());
    const command = [this.opts.codexBin, "exec-server", "--listen", this.url];
    const { argv, sandboxed } = wrapCommand(command, { enabled: this.opts.outerSandbox, bwrap: this.opts.bwrap, roots: this.opts.roots, codexHome: this.opts.codexHome });
    this.sandboxed = sandboxed;
    this.generation += 1;
    const gen = this.generation;
    log("info", "exec-server starting", { port: this.port, sandboxed, roots: this.opts.roots, generation: gen });
    const child = spawn(argv[0], argv.slice(1), {
      stdio: ["pipe", "pipe", "pipe"], // stdin 保持 pipe 且不关：exec-server 见到 stdin 关闭就退出
      env: { ...process.env, ...(this.opts.env ?? {}), CODEX_HOME: this.opts.codexHome },
    });
    this.child = child;
    child.stdout?.on("data", (d) => log("debug", "exec-server stdout", { line: String(d).trimEnd() }));
    child.stderr?.on("data", (d) => log("debug", "exec-server stderr", { line: String(d).trimEnd() }));
    child.on("exit", (code, signal) => {
      log(this.stopping ? "info" : "warn", "exec-server exited", { code, signal, generation: gen });
      if (this.child === child) this.child = null;
      if (!this.stopping) this.scheduleRestart();
    });
    const up = await waitForPort(this.port, 15000, () => this.alive);
    if (!up) throw new Error(`exec-server 没有在 ${this.url} 监听（进程${this.alive ? "还在" : "已退出"}）`);
    this.restarts = 0;
    log("info", "exec-server ready", { url: this.url, generation: gen });
  }

  private scheduleRestart(): void {
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.restarts, 5));
    this.restarts += 1;
    log("warn", "exec-server restart scheduled — 注意：原会话全部丢失，沙箱侧会看到 unknown session id", { delayMs: delay });
    setTimeout(() => { if (!this.stopping) this.start().catch((e) => log("error", "exec-server restart failed", { error: String(e) })); }, delay);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
      child.once("exit", () => { clearTimeout(t); resolve(); });
    });
    this.child = null;
  }
}
