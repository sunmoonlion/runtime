// 外沙箱（security.md「本地上限」第一层）。Linux：用 bundled bwrap 把 exec-server 进程本身关起来——
// 全盘只读，只有白名单根与 CODEX_HOME 可写，/tmp 私有；不分离网络（桥要从回环连进来）。
// Linux 探针：runtime/probe/REPORT-2026-09-24-outer-sandbox.md。
// Windows 0.155.1 外层文件边界通过，但嵌套 process/start 失败（2026-10-07）；
// 在完整组合复验前禁止启动，不以无外层保护的进程冒充可用代理。macOS 尚无外层。
import path from "node:path";

export interface OuterSandboxSpec {
  bwrap: string;
  roots: readonly string[];
  codexHome: string;
}

export function buildBwrapArgv(spec: OuterSandboxSpec, command: readonly string[]): string[] {
  const rw = new Set<string>();
  rw.add(path.posix.resolve(spec.codexHome));
  for (const r of spec.roots) rw.add(path.posix.resolve(r));
  const argv = [spec.bwrap, "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
  for (const d of [...rw].sort()) argv.push("--bind", d, d);
  argv.push("--unshare-pid", "--die-with-parent", "--", ...command);
  return argv;
}

/** Linux 使用已有 bwrap 路径；Windows 在双层组合准入通过前拒绝启动。 */
export function wrapCommand(command: readonly string[], opts: { enabled: boolean; bwrap: string | null; roots: readonly string[]; codexHome: string }, platform: NodeJS.Platform = process.platform): { argv: string[]; sandboxed: boolean } {
  if (platform === "win32") {
    throw new Error("Windows 代理尚未启用：固定版 Codex 0.155.1 双层沙箱验收未通过（本机嵌套执行返回 CreateRestrictedToken failed: 87）。停止启动，不连接会合点；不能用 --no-outer-sandbox 绕过。见 scripts/results/windows-agent-1.*.md。");
  }
  if (opts.enabled && platform === "linux" && opts.bwrap) {
    return { argv: buildBwrapArgv({ bwrap: opts.bwrap, roots: opts.roots, codexHome: opts.codexHome }, command), sandboxed: true };
  }
  return { argv: [...command], sandboxed: false };
}
