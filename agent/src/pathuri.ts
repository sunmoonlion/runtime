// exec-server 协议里的路径都是 file:// URI（codex-rs/utils/path-uri）。这里只做两件事：URI ↔ 本地路径，以及「在不在某个根下面」。
import path from "node:path";
import { fileURLToPath } from "node:url";

export function uriToPath(uri: string, platform: NodeJS.Platform = process.platform): string | null {
  if (typeof uri !== "string" || !uri.startsWith("file://")) return null;
  try {
    const url = new URL(uri);
    if (url.search || url.hash) return null;
    const local = fileURLToPath(url, { windows: platform === "win32" });
    return canonicalPath(local, platform) === null ? null : local;
  } catch {
    return null;
  }
}

/** 规范化后判断 target 是否等于 root 或位于 root 之下（纯字符串判断，不解析符号链接；符号链接由外沙箱兜底）。 */
export function canonicalPath(value: string, platform: NodeJS.Platform = process.platform): string | null {
  if (typeof value !== "string" || /[\x00-\x1f]/.test(value)) return null;
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (!paths.isAbsolute(value)) return null;
  if (platform === "win32") {
    const normal = value.replaceAll("/", "\\");
    // Stage 1 supports local drive paths. Device/UNC paths, ADS, and Win32
    // aliases are refused rather than guessed; OS sandbox covers symlinks.
    if (!/^[a-z]:\\/i.test(normal) || normal.slice(2).includes(":")) return null;
    if (normal.slice(3).split("\\").some(p => p !== "." && p !== ".." &&
        (/[. ]$/.test(p) || /[<>"|?*]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))) return null;
    return paths.normalize(normal).toLowerCase();
  }
  return paths.normalize(value);
}

export function isUnder(target: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
  const t = canonicalPath(target, platform);
  const r = canonicalPath(root, platform);
  if (t === null || r === null) return false;
  if (t === r) return true;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const rel = paths.relative(r, t);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel);
}

export function isUnderAny(target: string, roots: readonly string[], platform: NodeJS.Platform = process.platform): boolean {
  return roots.some((r) => isUnder(target, r, platform));
}
