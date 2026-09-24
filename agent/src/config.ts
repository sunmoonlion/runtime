import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Ceiling } from "./filter.js";

export interface AgentConfig {
  /** 会合点地址，如 wss://edge.example.com/relay 或 ws://127.0.0.1:47100 */
  relayUrl: string;
  /** 用户标识（会合点按它配对） */
  userId: string;
  /** 会合点令牌（第一期：工作台签发的字符串；桥在 hello 里带上） */
  token: string;
  /** 根目录白名单（绝对路径） */
  roots: string[];
  ceiling: Ceiling;
  /** exec-server 监听端口；0 = 自动选空闲回环端口 */
  execPort: number;
  /** 执行端 CODEX_HOME（会话与日志落这里；不放登录态） */
  codexHome: string;
  /** 是否启用 OS 外沙箱（Linux bwrap）；关掉只剩协议过滤，仅供调试 */
  outerSandbox: boolean;
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
  };
}

export function loadConfig(file = CONFIG_PATH): AgentConfig {
  if (!fs.existsSync(file)) throw new Error(`没有配置：${file}（先跑 sunmoon-agent init）`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
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
  if (!/^wss?:\/\//.test(cfg.relayUrl)) throw new Error(`relayUrl 必须是 ws:// 或 wss://：${cfg.relayUrl}`);
  if (!cfg.userId) throw new Error("userId 不能为空");
  for (const r of cfg.roots) {
    if (!path.isAbsolute(r)) throw new Error(`白名单根必须是绝对路径：${r}`);
  }
  if (!["read-only", "workspace-write", "danger-full-access"].includes(cfg.ceiling.sandbox)) throw new Error(`ceiling.sandbox 非法：${cfg.ceiling.sandbox}`);
  if (!Number.isInteger(cfg.execPort) || cfg.execPort < 0 || cfg.execPort > 65535) throw new Error(`execPort 非法：${cfg.execPort}`);
}
