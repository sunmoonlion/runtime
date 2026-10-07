# CHECKPOINT（runtime 仓，分支 luna）

> 接手的人先读这里。规则：`k8s/sunmoonai/docs/dev-investment-agent/turn/imp/`。更新于 2026-10-07。

## 当前停点：Windows 代理阶段 0，待所有者同步及远程审读

任务：k8s `sunmoonai/docs/dev-investment-agent/switch-test/luna-task-windows-agent.md`，任务版本 `c77e2536`；runtime 开工基线 `bdcddddb2ff10e4f678c5f7c83a6cf2cf8878afe`。
只改本仓探针和文档，没有改代理产品代码、其他仓、会合点或已运行服务。未 fetch/pull/rebase/push。

- **问题 1 undecidable**：普通 Windows + unelevated + 新执行端家、不跑 setup；模型认证 HTTP 403 阻止实际 L2/L3 命令，不能记通过。
- **问题 2 pass（文件写边界）**：整个 exec-server 包进原生 Codex 外层沙箱后，cwd 内文件写成功，两个外部目标权限拒绝；无外层时三个目标都写成功。完整真实帧已入仓。
- 复现入口仍是 `scripts/probe-windows-exec-server.ps1`，加 `SANDBOX_MODE` 和可选本机探针；报告及限制见 [REPORT-2026-10-07-windows-unelevated.md](probe/REPORT-2026-10-07-windows-unelevated.md)，操作见 [README-windows-probe.md](scripts/README-windows-probe.md)。
- **先停在这里**：任务要求每阶段本地提交后交远程审读。阶段 1 尚未开始。需要补内层 process/start / 外层嵌套执行、干净 Windows 主机覆盖，不能把本次本机文件探针称为完整代理验收。
- 后续任务以 2026-10-07 交接为准：只做 Windows 10/11，Linux 保持开发联调，macOS 不做；不进行 runtime 仓改名。下面是保留的 2026-09-24 实现背景。

## 这个仓是什么

`0005-agent` 本地代理：装在用户机器上的唯一东西。包 `codex exec-server`（钉版，随包带），出站连会合点，守本地上限。
设计：`k8s/sunmoonai/docs/dev-investment-agent/tree-build/SDD/modules/0005-agent.md`；安全模型：`.../SDD/architecture/security.md`「本地上限」。

## 现在做到哪（第二段：代理与沙箱最小对）

| 部分 | 状态 | 在哪 |
| --- | --- | --- |
| 探针（第一段五个 + 外沙箱） | 全部完成，报告在 `probe/REPORT-*.md` | `probe/` |
| 代理 `@sunmoon/agent` 0.1.0 | 骨架可用：exec-server 守护（Linux 外沙箱 = 随包 bwrap）、出站桥（会合点协议 v1）、协议过滤（process/start、fs 写、http）、CLI（init/roots/ceiling/start/status）；27 个单元测试 | `agent/` |
| 会合点 v1、沙箱侧桥、沙箱镜像 | 在 k8s 仓 `sunmoonai/relay-platform/`、`sunmoonai/sandbox-platform/` | k8s `fable` |
| 一机联调 | `scripts/integration-minimal-pair.sh` **pass**（会合点 + 代理 + 桥 + 真 app-server；danger 被拒、workspace-write 写成） | `scripts/results/` |

## 还没做（第二段剩余）

1. 本地上限弹窗（`F-AGENT-04`）：现在抬高上限只能 `sunmoon-agent ceiling set` 改配置再重启；要做成本机确认的交互（先做 CLI 确认，再做托盘）；
2. 令牌：现在是配置里的静态字符串；工作台签发、公钥就地验是 `D10`；
3. 版本成对：会合点已核对两端 Codex 版本；代理侧收到 reject 后只停不提示更新（`F-AGENT-05` 半成）；
4. macOS：不套外沙箱（只有协议过滤）；`sandbox-exec` 外层待验；
5. Windows：2026-09-24 elevated 探针 pass；2026-10-07 unelevated 结论见当前停点。代理原生 exe、动态端口、可选提权初始化仍未实现；
6. 勾选上送知识服务（`F-AGENT-08`）未做；开机自启（`F-AGENT-09`）未做；
7. 网络硬禁（`--unshare-net` + unix socket）未做，网络上限只有协议过滤 + Codex 自身策略；
8. 两机公网延迟实测等所有者开 47100（switch-test inbox 02）；
9. `F-AGENT-10`：从用户 `~/.codex/config.toml` 合并 HTTP 型 `[mcp_servers]` 到 `codex-home/config.toml`（本机确认、列出条目）；其余不读。执行端家已与 `~/.codex` 隔离（`config.codexHome` 默认 `~/.sunmoon-agent/codex-home`），合并功能未做；
10. `sunmoon-data` skill 与知识服务 MCP 配置进沙箱镜像入口脚本（属 k8s `sandbox-platform`，随 `0006` 一起做）。

## 怎么跑

```bash
cd agent && pnpm install && pnpm build && pnpm test
# 一机联调（需 ~/.codex-probe 有登录态，k8s 仓在 ../k8s）
bash scripts/integration-minimal-pair.sh
# 手工
node agent/dist/cli.js init --relay ws://127.0.0.1:47100 --user local --token agent-secret --root ~/some/project
node agent/dist/cli.js start
```

## 坑

- 找进程按端口（`ss -ltnp`）或 `pgrep -f '[c]odex app-server'`；`pkill -f` 会杀到自己的 shell；
- exec-server 在 stdin 关闭时退出：代理用 pipe 保持 stdin；手工起要 `setsid … < /dev/null`；
- 外沙箱**不能**用系统 `/usr/bin/bwrap`（Ubuntu AppArmor），要用 `@openai/codex-linux-x64/vendor/*/codex-resources/bwrap`；不能用 Landlock（禁 mount）；
- 代理断线不重启 exec-server（会话在它内存里，25 秒窗内要接回同一个进程）。
