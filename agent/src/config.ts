import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WindowsCapability } from "./windowsBootstrap.js";
import type { Ceiling } from "./filter.js";
import { canonicalPath } from "./pathuri.js";

export interface AgentConfig {
  windowsSandbox?: WindowsCapability;
  /** 会合点地址，如 wss://edge.example.com/relay 或 ws://127.0.0.1:47100 */
  relayUrl: string;
  /** 用户标识（会合点按它配对） */
  userId: string;
  /** 会合点令牌（第一期：工作台签发的字符串；桥在 hello 里带上） */
  token: string;
  /** 根目录白名单（绝对路径） */
  roots: string[];
  /** Local settings choices, including unchecked directories; never grants access. */
  rootChoices?: string[];
  ceiling: Ceiling;
  /** exec-server 监听端口；0 = 自动选空闲回环端口 */
  execPort: number;
  /** 执行端 CODEX_HOME（会话与日志落这里；不放登录态） */
  codexHome: string;
  /** 是否启用 OS 外沙箱（Linux bwrap）；关掉只剩协议过滤，仅供调试 */
  outerSandbox: boolean;
  /** 这台机器在网页「我的机器」里显示的名字；默认用主机名。同一个用户的两台机器要不同名 */
  machineName: string;
}

export const CONFIG_DIR = process.env.SUNMOON_AGENT_HOME ?? path.join(os.homedir(), ".sunmoon-agent");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function defaultConfig(): AgentConfig {
  return {
    relayUrl: "ws://127.0.0.1:47100",
    userId: "local",
    token: "",
    roots: [],
    ceiling: { sandbox: "workspace-write", network: false },
    execPort: 0,
    codexHome: path.join(CONFIG_DIR, "codex-home"),
    outerSandbox: true,
    machineName: os.hostname().slice(0, 128) || "my-pc",
  };
}

export function loadConfig(file = CONFIG_PATH): AgentConfig {
  if (!fs.existsSync(file)) throw new Error(`没有配置：${file}（先跑 sunmoon-agent init）`);
  let raw: any;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("代理配置无法读取或 JSON 无效；请在本机检查 config.json"); }
  const cfg: AgentConfig = { ...defaultConfig(), ...raw, ceiling: { ...defaultConfig().ceiling, ...(raw.ceiling ?? {}) } };
  validate(cfg);
  return cfg;
}

export function saveConfig(cfg: AgentConfig, file = CONFIG_PATH): void {
  validate(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

export function validate(cfg: AgentConfig): void {
  try { const u = new URL(cfg.relayUrl); if (!["ws:", "wss:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error(); }
  catch { throw new Error("relayUrl 必须是 ws:// 或 wss://，且不能包含口令、查询参数或片段"); }
  if (!cfg.userId) throw new Error("userId 不能为空");
  if (typeof cfg.machineName !== "string" || !cfg.machineName.trim() || cfg.machineName.length > 128 || /[\x00-\x1f\x7f]/.test(cfg.machineName)) throw new Error("machineName 要有，且不超过 128 个字符、不含控制字符");
  for (const r of cfg.roots) {
    if (canonicalPath(r) === null) throw new Error(`白名单根必须是受支持的本地绝对路径：${r}`);
  }
  if (cfg.rootChoices !== undefined) {
    if (!Array.isArray(cfg.rootChoices) || cfg.rootChoices.length > 32 || cfg.rootChoices.some(r => typeof r !== "string" || canonicalPath(r) === null)) throw new Error("Invalid local directory choices");
    const choices = cfg.rootChoices.map(r => canonicalPath(r));
    if (new Set(choices).size !== choices.length || cfg.roots.some(r => !choices.includes(canonicalPath(r)))) throw new Error("Selected roots must be unique directory choices");
  }
  if (cfg.windowsSandbox && !["unelevated", "elevated"].includes(cfg.windowsSandbox.mode)) throw new Error("Invalid Windows sandbox mode");
  if (typeof cfg.ceiling.network !== "boolean") throw new Error("ceiling.network must be boolean");
  if (!["read-only", "workspace-write", "danger-full-access"].includes(cfg.ceiling.sandbox)) throw new Error("ceiling.sandbox 非法");
  if (!Number.isInteger(cfg.execPort) || cfg.execPort < 0 || cfg.execPort > 65535) throw new Error("execPort 非法");
}
