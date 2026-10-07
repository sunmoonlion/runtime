# @sunmoon/agent — 本地代理

用户机器上唯一要装的东西：包 `codex exec-server`（钉版 0.155.1，随包带），出站连会合点，守本地上限。不跑模型循环，不接触 key。

**Windows 尚未启用。**2026-10-07 原生实测：内层目录隔离通过；外层包住
exec-server 后，嵌套 `process/start` 返回 `CreateRestrictedToken failed: 87`。
在完整组合复验通过前，Windows `start` 会报错并退出，不启动执行器、不连接会合点；
`--no-outer-sandbox` 也不能绕过此门禁。`init/roots/ceiling/status` 的配置操作已有测试，
不代表 Windows 代理第 1 段完成。详见 `../scripts/results/windows-agent-1.*.md`。

```text
sunmoon-agent start
├── 外沙箱（Linux：随包 bwrap；全盘只读，白名单根 + CODEX_HOME 可写，/tmp 私有）
│   └── codex exec-server --listen ws://127.0.0.1:<空闲端口>
├── 出站桥 ──WSS──▶ 会合点 /agent（控制）+ /agent-data（每条沙箱连接一条流）
│     沙箱→执行端的每个 JSON-RPC 请求过协议过滤：越出上限回 -32001 错误，不转发
└── 状态：~/.sunmoon-agent/status.json；http://127.0.0.1:<随机>/（只绑回环）
```

## 命令

```bash
sunmoon-agent init --relay wss://edge.example.com/relay --user <id> --token <t> --root ~/research
sunmoon-agent roots add|remove|list <dir>          # 改完要重启 start（外沙箱的 bind 在启动时定）
sunmoon-agent ceiling show | set --sandbox read-only|workspace-write|danger-full-access --network on|off
sunmoon-agent start                                # 前台；systemd/launchd 由安装器管
sunmoon-agent status
```

配置：`~/.sunmoon-agent/config.json`（`SUNMOON_AGENT_HOME` 可改目录），600 权限。
Windows 路径按本地盘符绝对路径处理，大小写和斜杠形式不影响白名单匹配；
UNC/设备路径、ADS 和存在 Win32 歧义的路径目前明确拒绝。这里只做路径规范化，
不以字符串过滤替代 OS 沙箱对符号链接的约束。

## 本地上限怎么挡

| 层 | 做什么 |
| --- | --- |
| 外沙箱 | exec-server 进程在 bwrap 里：白名单外写不出去，`danger-full-access` 也写不出去（`Read-only file system`）；白名单外的 cwd 直接不存在 |
| 协议过滤 | `process/start`：沙箱模式高于上限、网络越界、cwd/workspaceRoots 在白名单外 → 拒；`fs/writeFile|createDirectory|remove|copy` 目标在白名单外 → 拒；`http/request` 在网络关闭时 → 拒；读一律放行 |

拒绝在沙箱侧表现为 `exec-server rejected request (-32001): sunmoon-agent local ceiling: …`。

## 开发

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test
```

测试：`test/filter.test.ts`（过滤规则，用真实抓到的帧）、`test/outerSandbox.test.ts`、`test/relayClient.test.ts`（假会合点 + 假 exec-server 的进程内端到端）。
一机联调见 `../scripts/integration-minimal-pair.sh`。
Node 最低 20.13（跨平台 `fileURLToPath(..., { windows })`）；本次在 Node 24 验证。
Windows 开发测试使用 pnpm 10.24.0 的 JavaScript 入口；本机 pnpm 12.0.0 原生入口
曾报 `spawnSync ... pnpm-native.exe UNKNOWN`，没有因此改动项目依赖或锁文件。
