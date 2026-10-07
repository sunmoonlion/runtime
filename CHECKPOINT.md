# CHECKPOINT（runtime 仓，分支 luna）

## 当前工作：Windows 代理第 1 段——未完成，沙箱组合阻塞（2026-10-07）

任务：k8s `switch-test/luna-task-windows-agent.md`；反馈 `luna-feedback.md`（k8s `6ded692ea7a8d5175f5253e4b28a938bb342e3ea`）。本单元基线 `e9f194b3d4178021f035cc81aeb1ed265299970c`；本提交只含 runtime、分支 luna，未 fetch/pull/rebase/push。第 0 段报告和证据保留。

**停在第 1 段安全准入，不能标通过，也不能进入第 2 段。**
结果与复现：[windows-agent-1.20261007-2025.md](scripts/results/windows-agent-1.20261007-2025.md)。

| 顺序 | 已做与剩余 |
| --- | --- |
| 1 内层 + 嵌套探针 | 内层 unelevated 新家无 setup 三项通过；已有 elevated 家三项通过，whoami 确认 `codexsandboxoffline`。外层中的 unelevated 嵌套两次返回 `CreateRestrictedToken failed: 87`；elevated 嵌套超时。只保留外层的诊断对照通过，不能当产品替代方案 |
| 2 代理适配 | 已补 Windows 路径规范化、真实帧 fixture、大小写去重、失败时阻止 Windows start；**自动模式探测、完整启动/进程树生命周期尚未完成**，不可绕过门禁连接现网 |
| 3 回归 | Windows Node 24.19.0 / pnpm 10.24.0：build/typecheck，65 测试通过。Linux Node 24.18.0：build/typecheck，64 通过、1 Windows 专用用例跳过。旧 Linux 模型联调未重跑，不以单元测试替代 |
| 4 现网与网页 | 所有者已授权临时替换并恢复；本次因准入阻塞**未执行替换**。原 Linux agent 仍在线；未轮换令牌、未改现网。任务端口 30471 与私有配置 30443 不一致，后续联调前核实 |
| 5 交回 | 证据、源码、限制与清理记录一起本地提交，由所有者同步给远程审读。需要先解决/审定沙箱承载方案，不能顺手改设计或降级保护 |

关键事实：直接 exec-server 使用 `initialize {clientName}` + `initialized`，`environment/add` 属于 app-server；`unelevated` 配置对应协议 `restricted-token`；真实字段是 `dataBase64`。受限 PowerShell 不能用任意 .NET 方法写文件，探针改 `Set-Content` 后才形成有效证据。

`arg0/PATH os error 5` 在成功和失败组均出现；仅说明不是足以解释全部失败的条件，尚未证明所有 PATH 命令不受影响。没有请求模型服务，也没有绕过阶段 0 的认证地区限制。

遵守 C-C7/C-C8（公开协议、固定 0.155.1）、C-A7（能力不足不启用）、C-A11（本地上限）、F-AGENT-10（执行端无凭据）；依 IMP 规范，设计组合问题交回审读，不在实现中擅自去掉任一层。安装器/托盘/MCP/自动更新仍不在本段。

后续顺序：先审本报告及最小复现 → 在固定协议/版本约束下确认可行的双层承载方式 → 完成 init 实际探测和生命周期 → Windows 本地组合全通过 → 使用已有授权临时替换现网 agent、验网页并恢复 → 第 1 段正式交审。Windows 10 / 干净机器在第 3 段验证。

以下保留原实现背景；旧“Windows 已 pass”仅指 2026-09-24 内层探针，不能扩大为本段完整代理可用。

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
