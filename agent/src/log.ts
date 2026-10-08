import fs from "node:fs";
import path from "node:path";

export type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let current: Level = Object.hasOwn(RANK, process.env.SUNMOON_AGENT_LOG ?? "") ? process.env.SUNMOON_AGENT_LOG as Level : "info";
const secrets = new Set<string>();
let file: RotatingLog | undefined;
let writeFailed = false;

export function setLevel(l: Level): void { current = l; }
export function registerSecret(value: string | undefined): void { if (value) secrets.add(value); }

export function safeText(text: string): string {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join("[REDACTED]");
  result = result.replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, url => {
      try { const u = new URL(url); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; return u.href; } catch { return "[URL REDACTED]"; }
    });
  return result.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 2048);
}

export function safeData(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) return value.slice(0, 64).map(v => safeData(v, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 64).map(([k, v]) =>
    [safeText(k), /token|password|secret|authorization|api.?key|credential|^env$|^argv$|^line$/i.test(k) ? "[REDACTED]" : safeData(v, depth + 1)]));
  return value;
}

/** Only these five owned filenames rotate. Never scan/delete other logs. */
export class RotatingLog {
  constructor(readonly directory: string, readonly maxBytes = 2 * 1024 * 1024, readonly copies = 5) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 128 || !Number.isSafeInteger(copies) || copies < 2 || copies > 10) throw new Error("invalid log rotation limits");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error("log directory alias refused");
    this.assertFiles();
  }
  private filename(i = 0): string { return path.join(this.directory, i ? `agent.log.${i}` : "agent.log"); }
  private assertFiles(): void {
    for (let i = 0; i < this.copies; i++) {
      try { const s = fs.lstatSync(this.filename(i)); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new Error("log file alias refused"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
  }
  write(line: string): void {
    if (Buffer.byteLength(line) > this.maxBytes) line = JSON.stringify({ level: "warn", msg: "oversized log record omitted" }) + "\n";
    this.assertFiles();
    if (fs.existsSync(this.filename()) && fs.statSync(this.filename()).size + Buffer.byteLength(line) > this.maxBytes) {
      for (let i = this.copies - 1; i >= 1; i--) {
        const previous = this.filename(i - 1), next = this.filename(i);
        if (fs.existsSync(next)) fs.unlinkSync(next);
        if (fs.existsSync(previous)) fs.renameSync(previous, next);
      }
    }
    fs.appendFileSync(this.filename(), line, { mode: 0o600 });
  }
}

export function configureWindowsLogs(directory: string, token: string): void {
  registerSecret(token);
  for (const [name, value] of Object.entries(process.env)) if (/token|password|secret|api.?key|credential/i.test(name)) registerSecret(value);
  file = new RotatingLog(directory);
}

export function log(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (RANK[level] < RANK[current]) return;
  const line = JSON.stringify(safeData({ t: new Date().toISOString(), level, msg, ...(extra ?? {}) })) + "\n";
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line);
  try { file?.write(line); }
  catch { if (!writeFailed) { writeFailed = true; process.stderr.write('{"level":"error","msg":"本地日志写入失败，请检查日志目录与可用空间"}\n'); } }
}
