// exec-server 协议里的路径都是 file:// URI（codex-rs/utils/path-uri）。这里只做两件事：URI ↔ 本地路径，以及「在不在某个根下面」。
import path from "node:path";
import { fileURLToPath } from "node:url";

export function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** 规范化后判断 target 是否等于 root 或位于 root 之下（纯字符串判断，不解析符号链接；符号链接由外沙箱兜底）。 */
export function isUnder(target: string, root: string): boolean {
  const t = path.resolve(target);
  const r = path.resolve(root);
  if (t === r) return true;
  const rel = path.relative(r, t);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function isUnderAny(target: string, roots: readonly string[]): boolean {
  return roots.some((r) => isUnder(target, r));
}
