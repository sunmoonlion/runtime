// 外沙箱（security.md「本地上限」第一层）。Linux：用 bundled bwrap 把 exec-server 进程本身关起来——
// 全盘只读，只有白名单根与 CODEX_HOME 可写，/tmp 私有；不分离网络（桥要从回环连进来）。
// 探针依据：runtime/probe/REPORT-2026-09-24-outer-sandbox.md。macOS / Windows 第一期不套外沙箱，只有协议过滤。
import path from "node:path";

export interface OuterSandboxSpec {
  bwrap: string;
  roots: readonly string[];
  codexHome: string;
}

export function buildBwrapArgv(spec: OuterSandboxSpec, command: readonly string[]): string[] {
  const rw = new Set<string>();
  rw.add(path.resolve(spec.codexHome));
  for (const r of spec.roots) rw.add(path.resolve(r));
  const argv = [spec.bwrap, "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
  for (const d of [...rw].sort()) argv.push("--bind", d, d);
  argv.push("--unshare-pid", "--die-with-parent", "--", ...command);
  return argv;
}

/** 返回最终要 spawn 的 argv：Linux 且有 bwrap 时包外沙箱，否则原样。 */
export function wrapCommand(command: readonly string[], opts: { enabled: boolean; bwrap: string | null; roots: readonly string[]; codexHome: string }): { argv: string[]; sandboxed: boolean } {
  if (opts.enabled && process.platform === "linux" && opts.bwrap) {
    return { argv: buildBwrapArgv({ bwrap: opts.bwrap, roots: opts.roots, codexHome: opts.codexHome }, command), sandboxed: true };
  }
  return { argv: [...command], sandboxed: false };
}
