#!/usr/bin/env node
// sunmoon-agent：本地代理的命令行。
//   init --relay URL --user ID --token T [--root DIR ...]   写配置
//   roots add|remove|list DIR                                白名单（改完要重启 start，外沙箱的 bind 在启动时定）
//   ceiling show|set --sandbox MODE --network on|off         本地上限（本机改，仅本机生效）
//   start                                                    前台运行：起 exec-server + 出站桥；状态写 status.json
//   status                                                   读 status.json
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { CONFIG_DIR, CONFIG_PATH, defaultConfig, loadConfig, saveConfig, type AgentConfig } from "./config.js";
import { ExecServer } from "./execServer.js";
import { log } from "./log.js";
import { locateCodex } from "./paths.js";
import { RelayClient } from "./relayClient.js";

const VERSION = "0.1.0";
const STATUS_PATH = path.join(CONFIG_DIR, "status.json");

function arg(flag: string, argv: string[]): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
function args(flag: string, argv: string[]): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => { if (a === flag && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  // 任何子命令带 --help / -h 都只打印用法：以前 `start --help` 会忽略参数、真的起一个代理（KIND 09 实测）
  if (!cmd || cmd === "help" || argv.includes("--help") || argv.includes("-h")) { usage(); return 0; }
  if (cmd === "--version") { console.log(VERSION); return 0; }

  if (cmd === "init") {
    const cfg: AgentConfig = { ...defaultConfig() };
    cfg.relayUrl = arg("--relay", argv) ?? cfg.relayUrl;
    cfg.userId = arg("--user", argv) ?? cfg.userId;
    cfg.token = arg("--token", argv) ?? cfg.token;
    cfg.roots = args("--root", argv).map((r) => path.resolve(r));
    const port = arg("--port", argv); if (port) cfg.execPort = Number(port);
    if (argv.includes("--no-outer-sandbox")) cfg.outerSandbox = false;
    saveConfig(cfg);
    console.log(`已写 ${CONFIG_PATH}`);
    return 0;
  }

  const cfg = loadConfig();
  if (cmd === "roots") {
    const sub = argv[1]; const dir = argv[2] ? path.resolve(argv[2]) : "";
    if (sub === "list") { cfg.roots.forEach((r) => console.log(r)); return 0; }
    if (sub === "add") { if (!fs.existsSync(dir)) { console.error(`目录不存在：${dir}`); return 2; } if (!cfg.roots.includes(dir)) cfg.roots.push(dir); saveConfig(cfg); console.log(`已加入白名单：${dir}（重启 start 生效）`); return 0; }
    if (sub === "remove") { cfg.roots = cfg.roots.filter((r) => r !== dir); saveConfig(cfg); console.log(`已移出白名单：${dir}（重启 start 生效）`); return 0; }
    usage(); return 2;
  }
  if (cmd === "ceiling") {
    if (argv[1] === "show" || !argv[1]) { console.log(JSON.stringify(cfg.ceiling)); return 0; }
    if (argv[1] === "set") {
      const sb = arg("--sandbox", argv); if (sb) cfg.ceiling.sandbox = sb as AgentConfig["ceiling"]["sandbox"];
      const net = arg("--network", argv); if (net) cfg.ceiling.network = net === "on";
      saveConfig(cfg); console.log(JSON.stringify(cfg.ceiling)); return 0;
    }
    usage(); return 2;
  }
  if (cmd === "status") {
    if (!fs.existsSync(STATUS_PATH)) { console.log("没在跑（没有 status.json）"); return 1; }
    console.log(fs.readFileSync(STATUS_PATH, "utf8")); return 0;
  }
  if (cmd === "start") return start(cfg);
  usage(); return 2;
}

async function start(cfg: AgentConfig): Promise<number> {
  if (cfg.roots.length === 0) log("warn", "白名单为空：任何 process/start 都会被拒；用 sunmoon-agent roots add <目录>");
  const codex = locateCodex();
  log("info", "sunmoon-agent starting", { version: VERSION, codex: codex.version, codexBin: codex.codexBin, bwrap: codex.bwrap, platform: process.platform });
  const es = new ExecServer({ codexBin: codex.codexBin, bwrap: codex.bwrap, outerSandbox: cfg.outerSandbox, roots: cfg.roots, codexHome: cfg.codexHome, port: cfg.execPort });
  await es.start();
  const relay = new RelayClient({
    relayUrl: cfg.relayUrl, userId: cfg.userId, token: cfg.token, codexVersion: codex.version, softwareVersion: VERSION,
    localUrl: () => es.url, ceiling: () => cfg.ceiling, roots: () => cfg.roots,
  });
  relay.start();

  const writeStatus = () => {
    const st = { version: VERSION, pid: process.pid, codex: codex.version, execServer: { url: es.url, alive: es.alive, sandboxed: es.sandboxed, generation: es.generation }, relay: { url: cfg.relayUrl, status: relay.status, lastError: relay.lastError }, ceiling: cfg.ceiling, roots: cfg.roots, bridge: relay.stats, at: new Date().toISOString() };
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(STATUS_PATH, JSON.stringify(st, null, 2));
    return st;
  };
  const timer = setInterval(writeStatus, 5000);
  writeStatus();

  // 本机状态口（只绑回环）：给将来的弹窗/托盘与本地测试用
  const statusPort = Number(process.env.SUNMOON_AGENT_STATUS_PORT ?? 0);
  const srv = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(writeStatus())); });
  await new Promise<void>((r) => srv.listen(statusPort, "127.0.0.1", () => r()));
  const sp = srv.address(); log("info", "status endpoint", { url: `http://127.0.0.1:${typeof sp === "object" && sp ? sp.port : statusPort}/` });

  return new Promise<number>((resolve) => {
    const shutdown = async (sig: string) => {
      log("info", "shutting down", { sig });
      clearInterval(timer); relay.stop(); srv.close(); await es.stop();
      try { fs.unlinkSync(STATUS_PATH); } catch {}
      resolve(0);
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  });
}

function usage(): void {
  console.log(`sunmoon-agent ${VERSION}
  init --relay ws://HOST:PORT --user ID --token T [--root DIR]... [--port N] [--no-outer-sandbox]
  roots list | add DIR | remove DIR
  ceiling show | set [--sandbox read-only|workspace-write|danger-full-access] [--network on|off]
  start
  status`);
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { log("error", "fatal", { error: String(e?.stack ?? e) }); process.exit(1); });
