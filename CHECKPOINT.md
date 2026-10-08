# CHECKPOINT（runtime 仓，分支 luna）

## 当前工作：第 2 段，先补跨仓协议，再实现代理（2026-10-08）

Fable 在 k8s `434241be` 的反馈末节已接受 1b。所有者随后授权 Luna 直接修改
第 2 段必要的会合点/工作台接口，验证后向 Fable 报备。只本地提交；所有者同步，
Fable 只在 luna 审读，整体验收后再合 fable。构建镜像/发布交 Cursor 的 switch-test 待办。

| 顺序 | 工作与完成条件 | 状态 |
| --- | --- | --- |
| 1 | 会合点权限报告、工作台持久化回执、版本错配通知；跨仓契约与隔离/重放测试 | 源码完成；relay 39、后端/DB/契约 31 通过 |
| 2 | HTTP MCP 本机选择导入；隔离用户配置/凭据；固定 Codex 原生投影对照 | 代码和原生投影对照完成；真实 HTTP 调用待联调 |
| 3 | 本机 CLI 确认、请求摘要、当前会话权限；断线/过期/拒绝默认关闭 | 本地终端与真实 Windows 写边界已验；云端审计链待发布 |
| 4 | 可操作的拒绝提示；Windows 文件日志轮转与秘密排除 | 已实现并回归；第三方任意 URL 路径秘密仍需本人核对 |
| 5 | Windows/Linux 回归、Linux 最小对；Cursor 发布后真实链路验收 | Linux 124 通过/26 Windows 专用跳过；Windows 149 通过/1 缺夹具失败；最小对 pass |
| 6 | windows-agent-2 结果、限制、跨仓提交清单，交 Fable 审读 | 本地候选报告与 Cursor 同机待办；未宣布第 2 段通过 |

发现：旧会合点忽略 hello 后的控制消息；Codex 错配只通知沙箱，代理收不到。
实现通过控制通道扩展，不在 Codex 数据流塞自定义消息。权限仍由本机确认；工作台
回执仅证明报告已记账。Windows 必须保留已接受的内层沙箱，不由云端关闭。
不复用旧 source-before.yaml 回退锁；当前没有重连测试代理或发布服务。

当前停点：Cursor 直接读取本机 k8s 的 switch-test/inbox/2026-10-08-luna-stage2-cursor.md，
无需先推远端或同步。先补原生符号链接夹具、普通用户全测通过，再发布两个候选镜像。
报告：scripts/results/windows-agent-2.20261008-2130.md。
Windows replica：C:\Users\zymun\sunmoon-probe-runs\windows-agent-2-20261008。
既有无认证 elevated 测试家只复用，不复制；Node + 官方 Codex，不编译自有 exe、不关应用控制。
之前两次投影拒绝没有原始参数，尚未解决；发布后捕获受限投影参数再定位，不能猜测放行。
Windows 临时授权仅提高白名单内的 managed 权限；danger-full-access 一律拒绝并上报。
仓库协议、部署版本与网页真实验收由 Fable 在本次整体完成后审读；本轮只本地提交。

以下为历史停点，不代表当前待办。

## 当前停点：临时授权修复已上线，真实验收完成，待 Fable 审读（2026-10-08 19:25）

最新完整报告：[windows-agent-1b.20261008-1900.md](scripts/results/windows-agent-1b.20261008-1900.md)。
只本地提交，由所有者同步，不 push；未进入第 2 段。Windows 代理产品保持 3bf4d3d，仍为 Node + Codex。

| 工作 | 已完成 |
| --- | --- |
| 后端恢复 | ab4da306；心跳排持久探测、公开协议确认 ready、账房原子恢复；63 项通过，静态/架构检查通过 |
| 网页修复 | 9c47e303；非终态停止、窄屏按钮、项目占用说明、首句失败复用会话；192 项通过/2 项原有跳过 |
| Redis 与发布 | k8s dfe30caa、1fd485d3；有界频道、真实回环/越界拒绝；原生发布与 application-check 通过 |
| 原专家 | 同一个 Task 只恢复一次，18:57:09 SUCCEEDED，保留失败 Attempt；所有者确认“专家交回了”及输入框 |
| 普通聊天/工作 | 空闲重启后同会话继续读写通过；运行中重启明确报告命令失败并结束，重连后原会话下一问实际读取通过 |
| 清理 | 第7轮19:22:42正常退出、临时凭据已删；原 Linux 代理初始停止状态与配置不变；隔离数据库/预览/端口转发均已退出 |

不能扩大结论：代理重启时原命令输出未恢复；没有测试仅网络闪断且执行端保活；线上点击取消
只做了测试与预览、没有操作真实任务取消；专家 Profile 与文件问题不匹配，本轮证明状态恢复而非业务答案正确。
两次非致命 environmentConfig/read 投影拒绝仍保留、待远程评估，不为验收放宽边界。

现场 Task=5e77067c-983d-4e0d-a88e-e4e77f68fa71，work session=6e0bc2cf-7c86-4784-9156-5b4d3c7a6e5e。
聊天 session=52511429-3a68-4bb3-a102-55db1e6b4c3f。Windows 测试机器现在按约定停止；
项目里的 browser-check.txt 和 reconnect-work-20261008.txt 保留，不把离线当新故障。
部署真实旧 Flux 锁在 k8s results/reconnect-fix.20261008/source-before.yaml。
后端 HEAD 0f0ae68 只比已部署源码 ab4da306 多测试输出，不需要为此重新构建。
下一步：所有者同步全部本地提交 → Fable 审此次跨仓修复/验收 → 经审读决定是否进第2段。

以下为历史停点，不代表当前状态。

## 当前停点：专家重连卡住已报告，聊天通过，工作补验受专家占用阻挡（2026-10-08 18:00）

runtime 产品代码仍为 `3bf4d3d`；本轮只追加证据/报告，不修改工作台仓、不改任务数据、不 push。
报告：[windows-agent-1b.20261008-1750.md](scripts/results/windows-agent-1b.20261008-1750.md)。

- 专家真实 Task `5e77067c-983d-4e0d-a88e-e4e77f68fa71` 进入 WAITING(ENVIRONMENT) 后，
  机器恢复 online，Task 仍未恢复。MachineSync 只更新机器状态；advisor 不处理 WAITING，
  runner 接管也不包含 WAITING。请远程补合法状态迁移与幂等重新调度。
- 第一轮断开是我设置的 10 分钟联调计时器到期，并非确认的网络故障；“请专家读文件”误入
  DATA_QUERY SQL 流程，测试指导不合适，已经说明。1b 仍未通过。
- 普通聊天/工作已核对原前端投影，五组合成事件诊断通过：只有断线/error 没有终结事件时均保持忙碌；
  有 turn/completed/command-failed 则可收尾。**这不是现网普通会话重连通过或失败的证据。**
- 所有者说“重新来”，已重新单项引导：先在 myproject 新聊天只读 browser-check.txt，收到成功回执后
  才安排受控重连，并在原聊天再读；再做工作。不要在用户尚未准备时停代理。
- 新聊天基线及重连后原聊天再次读取均成功，kind=chat；session=`52511429-3a68-4bb3-a102-55db1e6b4c3f`。
  第二轮 17:50:38 正常退出并删临时令牌，第三轮 17:50:58 重连，17:52:03 新 turn 完成；
  所有者实际网页回执与桥新命令相符，browser-check.txt 摘要未变。仅覆盖空闲时断线。
- 工作补验第一句被 API 409 project_held_by_expert 拒绝。专家仍占项目，前端只有泛化错误；
  多次点开始留下四个空 work 会话。已补报告，用户正在通过精确链接停止原专家；不绕过互斥。
  另发现 SSE Redis subscribe 权限不足，已留错误行交远程；不是此次发送 409 的原因。
  报告初版已本地提交 `6f7449c`，新增发现待补提交。
  第三轮监督 `/tmp/luna-1e-watch3.py`、停止标记 `/tmp/luna-1e-stop3`，执行会话 56661，
  Windows PID 9244（操作前复核），最晚 18:20:53 自动停；记录前缀 `live3-`。
  不要把测试私有 config.json 令牌副本提交；仍需归档第三轮、补工作验收和最终清理。

## 前一停点：网页读写已通过，专家步骤待完成（2026-10-08 17:29）

runtime/luna `3bf4d3d`；已只读确认待办 34 的 Windows 顶层 cwd 修复在现网 runner 生效。
本轮 Windows 代理真实上线后，所有者完成：

- 项目页新聊天列文件：`myproject` 中只有 README.md；真实只读 process/start 正常通过。
- 项目页工作建文件：所有者改为内容 `hello！`；实际 browser-check.txt 字节
  `efbbbf68656c6c6fefbc81` 已核对。首次补丁命令失败，随后 PowerShell 写入及字节核验成功；
  三条命令均通过桥，未放宽沙箱。实际 `file:///data/.codex` read/skip 出现并按反馈丢弃，
  Windows 的 .git/.agents/.codex 只读保护均保留。
- 第一轮完整 95 条请求、62 条拒绝（全部是越白名单 fs/getMetadata）已归档到
  `scripts/results/windows-agent-1e-20261008/round1/`；读写回执在同目录上一级。
- 17:25:29 第一轮因本机联调计时器到期正常退出（0）；原 Linux 代理在开始前已停止，
  保持原状态且配置摘要未变。专家步骤没完成，不能把 1b 记通过。
- 所有者反馈断开后，17:28:48 重连同一台 Windows 测试机器，工作台已确认 online；
  本轮给专家验收 30 分钟，最晚 17:58:45 自动停止，完成则提前停止。

当前临时控制器 `/tmp/luna-1e-watch2.py`，停止标记 `/tmp/luna-1e-stop2`；
Windows PID 16368（操作前再核对身份），当前状态与记录为 Windows 测试副本下的
`live2-status.json`、`live2-frame-projection.jsonl`，日志 `/tmp/luna-1e-live2.log`。
本轮控制器退出后删除临时 config.json 令牌副本。产品代码未变。
下一步等待所有者完成专家 → 留实际三项结果与完整拒绝/退出记录 → 清理本轮私有副本与
试验产物 → 本地提交交审。暂不进入第 2 段。

以下为历史停点。

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
