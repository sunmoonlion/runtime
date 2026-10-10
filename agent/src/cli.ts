#!/usr/bin/env node
// sunmoon-agent：本地代理的命令行。
//   init --relay URL --user ID --token-prompt [--root DIR ...] [--name 机器名]   隐藏输入令牌并写配置
//   roots add|remove|list DIR                                白名单（改完要重启 start，外沙箱的 bind 在启动时定）
//   ceiling show|set --sandbox MODE --network on|off         本地上限（本机改，仅本机生效）
//   start                                                    前台运行：起 exec-server + 出站桥；状态写 status.json
//   status                                                   读 status.json
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { CONFIG_DIR, CONFIG_PATH, defaultConfig, loadConfig, saveConfig, type AgentConfig } from "./config.js";
import { ExecServer } from "./execServer.js";
import { log, registerSecret, configureWindowsLogs, safeData } from "./log.js";
import { locateCodex } from "./paths.js";
import { RelayClient } from "./relayClient.js";
import { detectWindowsSandbox } from "./windowsBootstrap.js";
import { type WindowsHelper, WindowsTemporary, assertWindowsHome, locateWindowsHelper, pinWindowsDirectories, runSandboxProbe } from "./windowsRuntime.js";
import { canonicalPath } from "./pathuri.js";
import { importCandidates, loadMcp, saveMcp, confirmedMcpUrls } from "./mcp.js";
import { localConfirm } from "./localConfirm.js";
import { readHiddenToken } from "./hiddenToken.js";
import { windowsConfirm } from "./windowsDesktop.js";
import { acquireResident, autostart, preferences, readResidentStatus, residentAlive, runTray, closeTray, startResident, stopResident, setupElevated } from "./resident.js";
import { installedLaunchError } from "./siteTrust.js";

const VERSION = "0.2.2";
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

/** 被会合点拒绝（令牌无效、被吊销、被同用户的新代理顶掉）后退出用的码；换令牌后重新 init 再 start。 */
const EXIT_REJECTED = 3;

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  // 任何子命令带 --help / -h 都只打印用法：以前 `start --help` 会忽略参数、真的起一个代理（KIND 09 实测）
  if (!cmd || cmd === "help" || argv.includes("--help") || argv.includes("-h")) { usage(); return 0; }
  if (cmd === "--version") { console.log(VERSION); return 0; }
  const launchError = installedLaunchError(import.meta.url);
  if (launchError) { console.error(launchError); return 1; }

  if (cmd === "init") {
    if (process.platform === "win32" && await residentAlive()) throw new Error("Stop the running agent before replacing its configuration");
    const cfg: AgentConfig = { ...defaultConfig() };
    cfg.relayUrl = arg("--relay", argv) ?? cfg.relayUrl;
    cfg.userId = arg("--user", argv) ?? cfg.userId;
    if (argv.includes("--token-prompt") && argv.includes("--token")) throw new Error("--token-prompt 不能与 --token 同用");
    cfg.token = argv.includes("--token-prompt") ? await readHiddenToken() : arg("--token", argv) ?? cfg.token;
    registerSecret(cfg.token);
    cfg.roots = args("--root", argv).map((r) => path.resolve(r));
    const name = arg("--name", argv); if (name) cfg.machineName = name;
    const port = arg("--port", argv); if (port) cfg.execPort = Number(port);
    if (argv.includes("--no-outer-sandbox") && process.platform !== "win32") cfg.outerSandbox = false;
    if (process.platform === "win32") { cfg.windowsSandbox = await detectWindowsSandbox(cfg.codexHome, cfg.roots); console.log(`Windows sandbox: ${cfg.windowsSandbox.mode} (real process/start verified)`); }
    saveConfig(cfg);
    console.log(`已写 ${CONFIG_PATH}`);
    return 0;
  }

  const cfg = loadConfig();
  registerSecret(cfg.token);
  if (["stop", "tray", "autostart", "settings", "sandbox-setup"].includes(cmd)) {
    if (process.platform !== "win32") throw new Error("Windows lifecycle command");
    if (cmd === "stop") console.log(JSON.stringify({ stopped: await stopResident() }));
    if (cmd === "tray") { if (argv[1] === "stop") console.log(JSON.stringify({ closed: await closeTray() })); else if (!argv[1]) await runTray(); else throw new Error("tray [stop]"); }
    if (cmd === "autostart") console.log(JSON.stringify(await autostart(argv[1] ?? "status")));
    if (cmd === "settings") console.log(JSON.stringify(preferences(argv.slice(1))));
    if (cmd === "sandbox-setup") { if(argv.length!==2||argv[1]!=="--elevated")throw new Error("Optional UAC: sandbox-setup --elevated"); console.log(JSON.stringify(await setupElevated())); }
    return 0;
  }
  if (cmd === "mcp") {
    const file = path.join(CONFIG_DIR, "mcp.json");
    if (argv[1] === "list") { console.log(JSON.stringify(loadMcp(file), null, 2)); return 0; }
    if (argv[1] !== "import" || argv.length !== 2) { usage(); return 2; }
    if (process.platform !== "win32") { console.error("本轮 MCP 导入入口仅用于 Windows 代理。"); return 2; }
    const source = path.join(os.homedir(), ".codex", "config.toml");
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error("Unsupported user Codex config file");
    const { servers, skipped } = importCandidates(fs.readFileSync(source, "utf8"));
    const selected = { ...loadMcp(file) };
    let imported = 0;
    console.log(`可导入 ${Object.keys(servers).length} 个 HTTP MCP；跳过 ${skipped} 个不支持/含认证字段的条目。`);
    for (const [name, server] of Object.entries(servers)) {
      const approved = await localConfirm(`导入 MCP ${JSON.stringify(name)}：${JSON.stringify(server)}\n它的 URL/公开配置会供云端读取；请确认 URL 路径本身也不含口令。固定版 Codex 将 HTTP 请求交给本机执行；localhost 指本机。还须本机网络上限开启，导入不会自动开启网络。`);
      if (approved) { selected[name] = server; imported++; }
    }
    if (!imported) { console.log("没有条目获得本机确认，配置未变更。"); return 1; }
    saveMcp(file, selected);
    console.log("已保存确认过的条目；重启代理后生效。未复制用户其它配置或认证状态。"); return 0;
  }
  if (cmd === "roots") {
    const sub = argv[1]; const dir = argv[2] ? path.resolve(argv[2]) : "";
    if (sub === "list") { cfg.roots.forEach((r) => console.log(r)); return 0; }
    if (sub === "add") { if (!argv[2] || canonicalPath(dir) === null || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error(`不是支持的本地目录：${dir}`); return 2; } if (!cfg.roots.some(r => canonicalPath(r) === canonicalPath(dir))) cfg.roots.push(dir); if (cfg.rootChoices && !cfg.rootChoices.some(r => canonicalPath(r) === canonicalPath(dir))) cfg.rootChoices.push(dir); saveConfig(cfg); console.log(`已加入白名单：${dir}（重启 start 生效）`); return 0; }
    if (sub === "remove") { if (!argv[2]) { usage(); return 2; } cfg.roots = cfg.roots.filter((r) => canonicalPath(r) !== canonicalPath(dir)); saveConfig(cfg); console.log(`已移出白名单：${dir}（重启 start 生效）`); return 0; }
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
    if (process.platform === "win32") { console.log(JSON.stringify({ ...(readResidentStatus() ?? {}), running: await residentAlive() })); return 0; }
    if (!fs.existsSync(STATUS_PATH)) { console.log("没在跑（没有 status.json）"); return 1; }
    console.log(fs.readFileSync(STATUS_PATH, "utf8")); return 0;
  }
  if (cmd === "start") {
    if (argv.slice(1).some(v => !["--background", "--background-worker"].includes(v)) || argv.length > 2) throw new Error("start [--background]");
    if (argv[1] === "--background") { await startResident(); console.log(JSON.stringify({ started: true })); return 0; }
    return start(cfg, argv[1] === "--background-worker");
  }
  usage(); return 2;
}

async function start(cfg: AgentConfig, windowed = false): Promise<number> {
  if (windowed && process.platform !== "win32") throw new Error("Background worker is Windows-only");
  let requestedStop = false;
  const resident = process.platform === "win32" ? await acquireResident(() => { requestedStop = true; process.emit("SIGINT"); }) : undefined;
  if (process.platform === "win32") {
    if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is required for agent logs");
    configureWindowsLogs(path.join(process.env.LOCALAPPDATA, "sunmoon-agent", "logs"), cfg.token);
  }
  if (cfg.roots.length === 0) log("warn", "白名单为空：任何 process/start 都会被拒；用 sunmoon-agent roots add <目录>");
  const codex = locateCodex();
  log("info", "sunmoon-agent starting", { version: VERSION, machine: cfg.machineName, codex: codex.version, codexBin: codex.codexBin, bwrap: codex.bwrap, platform: process.platform });
  let releaseRoots: (() => void) | undefined;
  let windows: { home: string; helper: WindowsHelper; mode: "elevated" | "unelevated"; temporary: WindowsTemporary } | undefined;
  const mcpServers = process.platform === "win32" ? loadMcp(path.join(CONFIG_DIR, "mcp.json")) : undefined;
  if (process.platform === "win32") {
    if (!cfg.windowsSandbox) throw new Error("Run init to detect Windows sandbox capability");
    assertWindowsHome(cfg.codexHome, cfg.roots);
    const helper = locateWindowsHelper();
    windows = { home: cfg.codexHome, helper, mode: cfg.windowsSandbox.mode, temporary: await WindowsTemporary.create(cfg.codexHome, cfg.roots, helper) };
    try { releaseRoots = await pinWindowsDirectories(windows.helper, [...cfg.roots, cfg.codexHome], cfg.codexHome); }
    catch (error) { await windows.temporary.close(); throw error; }
    log("info", "Windows inner sandbox and strict protocol filter; no OS outer sandbox", { mode: windows.mode });
  }
  const es = new ExecServer({ codexBin: codex.codexBin, bwrap: codex.bwrap, outerSandbox: cfg.outerSandbox, roots: cfg.roots, codexHome: cfg.codexHome, port: cfg.execPort, windowsMode: cfg.windowsSandbox?.mode, windowsTemporary: windows?.temporary, mcpServers });
  try {
    await es.start();
    if (windows && !await runSandboxProbe(es.url, cfg.codexHome, cfg.roots[0] ?? cfg.codexHome, windows.mode, windows.temporary.directory)) throw new Error("Configured Windows sandbox is no longer usable; run init");
  } catch (error) { await es.stop(); releaseRoots?.(); await windows?.temporary.close(); throw error; }
  // 被会合点拒绝就退出（退出码 3），不挂着一个连不上的进程：开机自启、托盘、systemd 都能据此看出出错（KIND 12 实测）
  let onRejected: (reason: string) => void = () => {};
  const relay = new RelayClient({
    windows: windows ? { ...windows, executorEnvironment: () => es.windowsEnv, confirmedHttpUrls: confirmedMcpUrls(mcpServers!) } : undefined, relayUrl: cfg.relayUrl, userId: cfg.userId, token: cfg.token, codexVersion: codex.version, softwareVersion: VERSION,
    localUrl: () => es.url, ceiling: () => cfg.ceiling, roots: () => cfg.roots, machineName: () => cfg.machineName,
    onRejected: (reason) => onRejected(reason),
    confirmPermission: windows ? (windowed ? windowsConfirm : localConfirm) : undefined,
  });
  relay.start();

  const writeStatus = () => {
    const st = { version: VERSION, pid: process.pid, ...(resident ? { runId: resident.runId, background: windowed } : {}), codex: codex.version, execServer: { url: es.url, alive: es.alive, sandboxed: es.sandboxed, generation: es.generation, ...(windows ? { protection: "inner-sandbox+strict-protocol", windowsSandbox: cfg.windowsSandbox } : {}) }, relay: { url: cfg.relayUrl, status: relay.status, lastError: relay.lastError, lastNotice: relay.lastNotice }, ceiling: cfg.ceiling, roots: cfg.roots, bridge: relay.stats, at: new Date().toISOString() };
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const safe = safeData(st);
    fs.writeFileSync(STATUS_PATH, JSON.stringify(safe, null, 2), { mode: 0o600 });
    return safe;
  };
  const timer = setInterval(writeStatus, 5000);
  writeStatus();

  // 本机状态口（只绑回环）：给将来的弹窗/托盘与本地测试用
  const statusPort = Number(process.env.SUNMOON_AGENT_STATUS_PORT ?? 0);
  const srv = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(writeStatus())); });
  await new Promise<void>((r) => srv.listen(statusPort, "127.0.0.1", () => r()));
  const sp = srv.address(); log("info", "status endpoint", { url: `http://127.0.0.1:${typeof sp === "object" && sp ? sp.port : statusPort}/` });

  return new Promise<number>((resolve) => {
    let done = false;
    const shutdown = async (why: string, code: number) => {
      if (done) return;
      done = true;
      log(code === 0 ? "info" : "error", "shutting down", { why, exitCode: code });
      clearInterval(timer);
      if (code !== 0) writeStatus(); // 保留最后状态（含被拒原因），便于用户与托盘查看
      relay.stop(); srv.close(); await es.stop(); releaseRoots?.(); await windows?.temporary.close();
      if (code === 0) { try { fs.unlinkSync(STATUS_PATH); } catch {} }
      await resident?.close();
      resolve(code);
    };
    onRejected = (reason) => void shutdown(`relay rejected: ${reason}`, EXIT_REJECTED);
    process.once("SIGINT", () => void shutdown("SIGINT", 0));
    process.once("SIGTERM", () => void shutdown("SIGTERM", 0));
    if (requestedStop) void shutdown("stop requested during startup", 0);
  });
}

function usage(): void {
  console.log(`sunmoon-agent ${VERSION}
  init --relay ws://HOST:PORT --user ID --token T [--root DIR]... [--name 机器名] [--port N] [--no-outer-sandbox]
  init --relay wss://HOST --user ID --token-prompt [--root DIR]...  本机隐藏输入，不把令牌放进命令历史
  roots list | add DIR | remove DIR
  mcp import | list   本机逐项确认导入无凭据 HTTP MCP；拒绝管道输入确认
  ceiling show | set [--sandbox read-only|workspace-write|danger-full-access] [--network on|off]
  start      前台运行；被会合点拒绝（令牌无效、被吊销、被同用户的新代理顶掉）时退出，退出码 3
  status
  start --background   Windows 后台运行，本机确认用独立窗口
  stop                 Windows 正常停止；不强杀未知进程
  tray [stop]          Windows 托盘；关闭托盘不停止代理
  settings show|set    本机设置；set 从 stdin 读非秘密 JSON，重启后生效
  autostart status|enable|disable   当前用户登录任务，默认关闭
  sandbox-setup --elevated         可选 UAC；先停止代理，仅同一 Windows 用户`);
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { log("error", "fatal", { error: String(e?.stack ?? e) }); process.exit(1); });
