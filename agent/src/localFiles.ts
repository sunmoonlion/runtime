// Local HTTP file projection. Keeps the already-reviewed service RPC unchanged.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalPath, isUnderAny } from "./pathuri.js";
import type { ServiceFiles } from "./service.js";

export const LOCAL_MAX_READ = 1024 * 1024;
export class LocalError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export interface LocalFilesOptions {
  roots: () => readonly string[];
  configDir: string;
  codexHome: string;
  platform?: NodeJS.Platform;
  files?: ServiceFiles;
}
const meta = (s: fs.Stats) => ({ type: s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : s.isFile() ? "file" : "other", size: s.size, mtime: Math.trunc(s.mtimeMs) });

export class LocalFiles {
  private readonly platform: NodeJS.Platform;
  constructor(private readonly opts: LocalFilesOptions) { this.platform = opts.platform ?? process.platform; }
  async close(): Promise<void> { await this.opts.files?.close(); }
  async read(kind: "dir" | "meta" | "file", target: string, offset = 0, length = LOCAL_MAX_READ): Promise<any> {
    const normalized = canonicalPath(target, this.platform);
    if (!normalized || !isUnderAny(target, this.opts.roots(), this.platform)
      || isUnderAny(target, [this.opts.configDir, this.opts.codexHome], this.platform)
      || normalized.split(this.platform === "win32" ? "\\" : "/").some(bit => bit === "auth.json" || bit === ".sandbox-secrets")) throw new LocalError(403, "outside_whitelist");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > LOCAL_MAX_READ) throw new LocalError(400, "invalid_params");
    try {
      if (this.platform === "win32") {
        if (!this.opts.files) throw new LocalError(403, "outside_whitelist");
        const methods = { dir: "service/readDirectory", meta: "service/getMetadata", file: "local/readFile" };
        const response = await this.opts.files.call(methods[kind], { path: pathToFileURL(target).href, ...(kind === "file" ? { offset, length } : {}) });
        if (response.error) {
          if (response.error.code === -32004) throw new LocalError(404, "not_found");
          if (response.error.code === -32011) throw new LocalError(413, "too_large");
          if (response.error.code === -32602) throw new LocalError(400, "invalid_params");
          throw new LocalError(403, "outside_whitelist");
        }
        if (kind === "file") return { ...response.result, content: Buffer.from(response.result.content, "base64") };
        return kind === "dir" ? { path: target, ...response.result } : response.result;
      }
      this.inspect(normalized);
      const stat = fs.lstatSync(normalized);
      if (kind === "meta") return meta(stat);
      if (kind === "dir") {
        if (!stat.isDirectory()) throw new LocalError(400, "invalid_params");
        const entries: object[] = [], dir = fs.opendirSync(normalized); let truncated = false;
        try {
          let entry: fs.Dirent | null;
          while ((entry = dir.readSync())) {
            if (entries.length === 2000) { truncated = true; break; }
            entries.push({ name: entry.name, ...meta(fs.lstatSync(path.join(normalized, entry.name))) });
          }
        } finally { dir.closeSync(); }
        return { path: target, entries, truncated };
      }
      if (!stat.isFile()) throw new LocalError(400, "invalid_params");
      const fd = fs.openSync(normalized, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fs.fstatSync(fd); this.inspect(normalized); const named = fs.lstatSync(normalized);
        if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== named.dev || opened.ino !== named.ino) throw new LocalError(403, "outside_whitelist");
        if (opened.size > 64 * 1024 * 1024) throw new LocalError(413, "too_large");
        const bytes = Buffer.alloc(Math.min(length, Math.max(0, opened.size - offset))), n = fs.readSync(fd, bytes, 0, bytes.length, offset);
        return { content: bytes.subarray(0, n), size: opened.size, mtime: Math.trunc(opened.mtimeMs), eof: offset + n >= opened.size };
      } finally { fs.closeSync(fd); }
    } catch (error) {
      if (error instanceof LocalError) throw error;
      throw new LocalError(["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "") ? 404 : 403, ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "") ? "not_found" : "outside_whitelist");
    }
  }
  private inspect(target: string): void {
    let current = target;
    for (;;) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) || fs.realpathSync.native(current) !== current) throw new LocalError(403, "outside_whitelist");
      const parent = path.dirname(current); if (parent === current) return; current = parent;
    }
  }
}
