# CHECKPOINT（runtime 仓，分支 luna）

## 当前停点：可忽略的 POSIX 只读项已处理；待待办 34 上线后补网页三项

基线 runtime `526401c`，反馈 k8s `f14dbc1e` 最后一节；本轮只改 runtime。
远程已接受 a–d，并在 investment-backend `7ac05d2a` 修正 Windows 顶层 cwd。

- 代理只丢弃纯 POSIX、read、skip 同时成立的命令权限项，转发前移除。
  Windows 保护项保留；混合路径、越界、写权限和无 skip 仍拒绝。
- Windows 130 passed / 1 skipped（仍是需预建符号链接夹具的旧用例）；
  Linux 107 passed / 24 Windows 专用 skipped；两端 build/typecheck 通过。
- 原生测试确认：带 POSIX 只读跳过项的项目/受管临时目录写入成功，
  项目外和用户全局 Temp 的写入仍被 OS 拒绝。
- 只读核查现网 runner 时，仍看到旧版顶层 cwd 写法，待办 34 尚未生效。
  因此本轮尚未重连 Windows；Linux 代理未替换，网页三项未验，不报 1b 通过。

结果：[windows-agent-1b.20261008-1710.md](scripts/results/windows-agent-1b.20261008-1710.md)。
下一步：确认待办 34 已上线 → 核对 Windows 项目目录存在 → 临时连接 Windows（限时恢复）
→ 所有者从项目页做新聊天列文件、新工作建文件、请专家 → 完整拒绝清单与恢复记录交审。

以下为历史停点，不代表当前工作要求。

## 当前停点：1b 代理补修完成；真实网页暴露跨系统目录问题，待远程处理

本轮基线 `0c5779d`，按 k8s `c8428efb` 反馈，只改 runtime。
结果：[windows-agent-1b.20261008-0015.md](scripts/results/windows-agent-1b.20261008-0015.md)。

- a–d：受管临时目录、缺失文件原生错误、终止宽限、固定配置读取已实现。
- Windows 原生 128 passed / 1 skipped；跳过的是需要预建 symlink 夹具的旧用例，
  本轮没重新申请管理员创建该夹具，不能说 Windows 全部用例通过。
- Linux 105 passed / 24 Windows 用例 skipped；build 通过。
- 原生 Windows app-server → WindowsBridge → exec-server 默认工作策略建文件成功，
  不排除临时目录；这不能代表 Linux 编排端到 Windows 的网页验收。
- e：所有者确认待办 33 已上线并重拉沙箱。00:02 临时连接 Windows；网页读和写仍失败。
  项目填的是 `workspace\\myproject`，该目录不存在；沙箱 turn_context 另有
  `/data/C:\\…\\myproject/.codex` 混合路径，桥拒绝工作命令。未做专家。
- 已补不存在工作目录的明确错误提示；混合路径不得通过删除保护条目或提权绕过。
- 59 条拒绝完整入仓，原 Linux 代理已恢复在线，原配置摘要未变；临时凭据清理见结果。

**现在不进第 2 段、不报 1b 通过。**远程核对项目目录存在性、thread/turn 的本地 cwd
与 environments 中的远端 cwd；修正后要补 Linux 编排端 → Windows 执行端的真实三项网页验收。

### 本轮执行顺序（留作交接）

只改 runtime，不进入第 2 段；本轮顺序与验收表：

| 顺序 | 工作 | 状态 |
| --- | --- | --- |
| 1 | 固定 0.155.1 真机探针：临时目录解析、缺失文件、已结束进程终止、配置读取 | 完成 |
| 2 | 代理管理临时目录及环境/目录替换攻击；不开放用户全局 Temp | 完成 |
| 3 | 缺失文件回包、结束进程宽限、只读固定配置文件；原生与 Linux 回归 | 完成，覆盖限制见上 |
| 4 | 待办 33 及重拉沙箱；网页三项；恢复 Linux 代理 | 前提确认；读写失败、专家未做；恢复完成 |
| 5 | 新报告、完整拒绝列表、临时凭据清理、本地提交交审 | 本轮收尾 |

反馈已撤回“优先改工作台排除临时目录”的建议：先由代理把 TEMP/TMP 固定到受管目录，
实测 slash_tmp 在 Windows 的行为，走不通才交远程采用退路。以下保留上轮历史，不当作当前指令。

## 当前停点：第 1 段补验 1b，待远程修工作台请求后复验

基线 `9d68ed90dca32193a263b544123122c916b8f088`；按 k8s `87e36b47` 最新反馈，
仅修改 runtime，不进入第 2 段。顺序与完成条件：

1. 用户环境/PATH 继承、保留变量过滤和远端合并；真实工具可发现性验证。
2. 固定 0.155.1 的所有 fs 真回包与 Node 助手逐字段核对，帧追加入 probe/frames.jsonl。
3. opendir 句柄优化先原生实验；失败保留已验过的目录固定方式。
4. 原生攻击回归通过后，临时连接 Windows 代理，由所有者在网页执行聊天/建文件/专家，记录全部拒绝；结束恢复原 Linux 代理。
5. 追加 windows-agent-1b 结果，清理临时凭据/副本，本地提交交审。

第 4 项未实际完成不能写整个第 1 段已交付。

1b 已完成：环境继承与保留项过滤；原生 FS 14 组真回包对齐，修复 walk 顺序、
readBlock 的 eof/零长度错误；opendir 不阻止重命名，保留 cwd guard。
首轮真实网页请求已到达，initialize 被拒 3 次（resumeSessionId:null 漏列）。
已恢复原 Linux 代理且核对配置摘要不变；又用固定版 app-server → WindowsBridge →
exec-server 的无模型探针发现 environment/info 的 params:null 漏列，两处已修复。
本地客户端现在可取得环境信息并建立线程，白名单外 metadata 与 MCP 配置读取仍拒绝。
第二轮真实网页进入工作模式，process/start 因真实客户端字段不全被拒 4 次，合计 denied=38。
现已补齐 metadata/envPolicy/沙箱启动选项、保留标记核值后丢弃、缺失只读目录保护。
Windows 113 passed；Linux 96 passed、17 skipped。固定客户端本机只读命令通过；
默认 workspaceWrite 额外申请系统临时目录写权限，违反项目白名单；排除两项后本机建文件通过。
这些用确定性本地模型响应驱动，不是网页验收。

**需要改工作台，按任务书停下交远程**：WORK/EXPERT 的 turn sandboxPolicy 显式加
excludeTmpdirEnvVar=true、excludeSlashTmp=true，并核对云端客户端 Windows sandbox 选择。
具体源文件、两组真帧和复验步骤见 scripts/results/windows-agent-1b.20261007-2220.md 第 7 节。
只读查库确认普通“＋新建”不带项目，项目“新聊天/新工作”才绑定机器；未改应用数据。
原 Linux 代理已恢复在线、配置摘要不变。网页聊天/建文件/专家仍未全部成功，禁止报交付或进第 2 段。

## 当前停点：Windows 代理第 1 段完成开发自检，交远程审读（2026-10-07）

本轮基线 `36ec68be9a47386b3a39f387a3a12cd5fe9785d7`；采用所有者确认的
“内层沙箱 + 严格协议过滤”，文件助手使用本机 Node，不依赖 Python、不编译自有 exe。
只修改 runtime/luna，无 fetch/pull/rebase/push，不进入第 2 段。

| 顺序 | 当前结果 |
| --- | --- |
| 1 边界实现 | 逐项核对 process 权限、方法允许清单、FS 读白名单；Node 文件助手由 Codex sandbox 承载 |
| 2 原生攻击 | 普通用户/elevated 对照、联接/符号/硬链接/别名/检查后替换通过；普通 Node 写入由 OS 沙箱阻止外部路径 |
| 3 CLI/生命周期 | init 实际探测并优先可用 elevated；真实启停、20 秒重连、4003 拒绝及子孙进程清理通过 |
| 4 回归/现网 | Windows 98 passed；Linux 82 passed、16 Windows 用例 skipped；原 Linux 模型链路 pass。所有者已确认网页在线，最终 Node 版本也重连现网并恢复原 Linux 代理 |
| 5 交付 | 报告、原始状态和测试结果入仓；清理本轮临时凭据及试验副本；本地提交后等待审读 |

本机 Smart App Control = On，代码完整性状态原值均为 2，自编译未签名 helper 曾被
应用控制拦截。没有改动系统保护。后续打包使用官方 Node + JS + 官方 Codex，禁止自编译 exe。

结果：[windows-agent-1.20261007-2150.md](scripts/results/windows-agent-1.20261007-2150.md)。
安装器/托盘/开机恢复、Windows 10/干净机、MCP、抬高权限交互、真实网页轮换令牌等未做；
明确方法/路径支持范围及其他限制见报告，不将本段说成整个产品已交付。

## 历史：上一提交的受阻停点

以下保留上一提交的事实作为背景，不能当成本轮完成状态。

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
