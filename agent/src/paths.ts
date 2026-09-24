// 找到随包带的 Codex 原生二进制与 bundled bwrap。不用 PATH 上的 codex（npm 垫片在 Windows 上起不了，版本也不受控），不用系统 /usr/bin/bwrap（Ubuntu 的 AppArmor 配置禁止其子进程再建命名空间）。
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const TRIPLES: Record<string, string> = {
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
};

export interface CodexPaths {
  /** 原生 codex 可执行文件 */
  codexBin: string;
  /** bundled bubblewrap（仅 Linux） */
  bwrap: string | null;
  /** @openai/codex 包声明的版本 */
  version: string;
  triple: string;
}

export function locateCodex(): CodexPaths {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("@openai/codex/package.json");
  const version: string = JSON.parse(fs.readFileSync(pkgJson, "utf8")).version;
  const key = `${process.platform}-${process.arch}`;
  const triple = TRIPLES[key];
  if (!triple) throw new Error(`不支持的平台：${key}`);
  const platformPkg = `@openai/codex-${process.platform}-${process.arch}`;
  // 平台包是 @openai/codex 的可选依赖：从 codex 包目录出发解析，pnpm 与 npm 布局都能找到
  const fromCodex = createRequire(pkgJson);
  const platformPkgJson = fromCodex.resolve(`${platformPkg}/package.json`);
  const vendor = path.join(path.dirname(platformPkgJson), "vendor", triple);
  const codexBin = path.join(vendor, "bin", process.platform === "win32" ? "codex.exe" : "codex");
  if (!fs.existsSync(codexBin)) throw new Error(`找不到 Codex 原生二进制：${codexBin}`);
  const bwrapPath = path.join(vendor, "codex-resources", "bwrap");
  const bwrap = process.platform === "linux" && fs.existsSync(bwrapPath) ? bwrapPath : null;
  return { codexBin, bwrap, version, triple };
}
