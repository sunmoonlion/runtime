# @sunmoon/agent — 本地代理

用户机器上唯一要装的东西：包 `codex exec-server`（钉版 0.155.1，随包带），出站连会合点，守本地上限。不跑模型循环，不接触 key。

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

## 本地上限怎么挡

| 层 | 做什么 |
| --- | --- |
| 外沙箱 | exec-server 进程在 bwrap 里：白名单外写不出去，`danger-full-access` 也写不出去（`Read-only file system`）；白名单外的 cwd 直接不存在 |
| 协议过滤 | `process/start`：沙箱模式高于上限、网络越界、cwd/workspaceRoots 在白名单外 → 拒；`fs/writeFile|createDirectory|remove|copy` 目标在白名单外 → 拒；`http/request` 在网络关闭时 → 拒；读一律放行 |

拒绝在沙箱侧表现为 `exec-server rejected request (-32001): sunmoon-agent local ceiling: …`。

## 开发

```bash
pnpm install && pnpm typecheck && pnpm test && pnpm build
```

测试：`test/filter.test.ts`（过滤规则，用真实抓到的帧）、`test/outerSandbox.test.ts`、`test/relayClient.test.ts`（假会合点 + 假 exec-server 的进程内端到端）。
一机联调见 `../scripts/integration-minimal-pair.sh`。
