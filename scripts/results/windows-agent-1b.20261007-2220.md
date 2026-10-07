# Windows 代理第 1 段补验 1b

工作仓 `runtime`，分支 `luna`；基线 `9d68ed90dca32193a263b544123122c916b8f088`。
任务来源：k8s `87e36b47` 的 `luna-feedback.md` 最后一节。
仅修改 runtime；未 fetch/pull/rebase/push，未进入第 2 段。

**第 1 段补验未通过，停在工作台权限请求与 Windows 白名单的衔接。**
代理侧已完成本轮兼容修复；真实网页聊天、建文件、请专家仍未全部成功。
任务书限定只改 runtime，需要工作台配合的修改交远程，不进入第 2 段。

## 1. 三项完成条件

| 条件 | 结果 |
| --- | --- |
| 用户环境与 PATH | 已改为继承本机环境，过滤保留项，固定代理 CODEX_HOME，再合并允许的远端变量。Windows 大小写键统一后合并，避免 Path/PATH 冲突 |
| 固定版本 FS 回包 | 0.155.1 原生 exec-server 与助手的 14 组响应逐字段一致，覆盖全部 12 个已支持 FS 方法；真实帧追加到 probe/frames.jsonl |
| 网页端到端 | 两轮真实流量暴露握手/命令字段遗漏，均已修复并用固定客户端复验；工作默认临时目录权限仍冲突，网页三项未通过 |

证据目录：[windows-agent-1b-20261007](windows-agent-1b-20261007/)。

## 2. 环境变量与真实工具

`CODEX*`、`SUNMOON*`、`NODE_OPTIONS`、`NODE_PATH`、`RUST*`、`LD_*`
从继承环境移除；代理自行写回 CODEX_HOME。远端企图覆盖保留项仍被拒绝，
允许重复给出完全相同的 CODEX_HOME。固定客户端带来的五种保留标记单独核值后丢弃：
CODEX_VERSION=0.155.1、CODEX_CI=1、CODEX_SANDBOX_NETWORK_DISABLED=1（仅 restricted 网络）、
CODEX_THREAD_ID/CODEX_SESSION_ID（必须等于 metadata.threadId UUID）。其他保留项仍拒绝。
这些标记不进入命令环境；其他合法环境变量及用户 PATH 保留。
仅接收已抓到的 inherit=all 环境策略（set/includeOnly 为空，exclude 只能是保留变量的确切名字）；
本地完成过滤与合并后，将转发策略设为 inherit=none，防止执行器内部变量再次进入命令。
不输出实际环境值；探针留存的 process/start.env 值统一脱敏。

| 本机用户工具 | 普通用户 PATH 查找 | Codex 0.155.1 沙箱内实际执行 |
| --- | --- | --- |
| Git | C:\Program Files\Git\cmd\git.exe | git version 2.54.0.windows.1，退出 0 |
| Python | Python313/python.exe（另有 WindowsApps alias） | Python 3.13.15，退出 0 |
| uv | where.exe 未找到 | 退出 1；普通环境也缺少，不归因于代理丢失 PATH |

命令通过真实 process/start 启动 `cmd.exe /d /c <工具> --version`。
初次尝试从沙箱内 Node 再 spawnSync 子命令遇到 EPERM，不将该次失败记为 PATH 成功；
改为执行器直接启动命令后取得上述结果。此处调用 Python 仅验证用户工具，产品仍只有 Node JS 助手。

## 3. 响应契约实测与修复

探针：[windows-agent-contract.mjs](../../probe/windows-agent-contract.mjs)。
使用自建空目录、固定文件内容，不读取模型或会合点凭据。
两种实现操作同一文件，比较完整 result/error 对象，RPC 请求 ID 各自独立。

| 实测差异 | 修复 |
| --- | --- |
| walk 真实回包先列本层，再列下一层 | 助手改为广度优先，保留路径边界和遍历上限 |
| readBlock 恰好读满请求长度时 eof=false | 改为实际读取字节数小于请求长度才 eof=true |
| readBlock len=0 的真实错误 | 对齐 -32600 和 `file read block length must be between 1 and 1048576` |

14 组包括 write/read/metadata/canonicalize/mkdir/copy/readDirectory/walk/open/
readBlock（超出文件长度、恰好等长、零长度）/close/remove。
完整结果见 `fs-comparison.json`；新增原生回归覆盖遍历顺序、精确 EOF 与零长度。
不能把有限样例扩大为全部文件错误和所有目录形状完全兼容。

额外抓到 capabilityRoots/discoverV1 和带 sandbox 的 readFile 在原生执行器成功。
这只证明固定版本的协议形状，不代表桥已支持它们；是否影响真实轮次由网页联调核对。

## 4. 目录句柄实验

本机 `fs.opendirSync` 持有目录时，`renameSync` **成功**；不能替代当前目录固定。
当前工作目录固定时，rename 返回 EBUSY。因此保留现有 cwd guard，未改为常驻 opendir 助手。
并发命令可能启动较多 guard 进程的限制仍在，不声称已解决该性能问题。

## 5. 回归、应用控制与约束

- Windows 原生：最终 build/typecheck，通过 113 项测试、9 个测试文件，见 windows-tests-final.txt；包含两种沙箱模式、链接攻击、检查后替换、CLI 生命周期及真实客户端环境投影。此前的 110/93 回执保留。
- Linux：最终 96 passed、17 skipped（Windows 专用）；build/typecheck 通过，见 linux-tests-final.txt。后续只追加探针证据，不把跳过算通过。
- 最终 Windows 产品源码、测试与依赖/构建清单 27 个文件摘要与工作树一致，见 `windows-source-match-final.json`。
- 本轮首次完整 Windows 运行少复制 probe/frames.jsonl，导致一个测试文件无法加载；补齐夹具重跑后全部通过，不改测试标准。
- Windows 原生符号链接夹具需要一次 UAC 创建；回归测试用普通用户运行，没有关闭 Smart App Control 或修改系统策略。
- 上次只读应用控制证据：SmartAppControlState=On，两项代码完整性 enforcement 原值均为 2，见第 1 段报告。此次没有重新查询，不冒充新的系统状态读数。
- 不编译自有 exe；开发用官方 Node 24.19.0、Codex 0.155.1、pnpm 10.24.0 JS 入口。后续安装包仍需带官方 Node/Codex + JS。

| 项目规则 | 落实 |
| --- | --- |
| C-C7/C-C8/C-A4 | 固定 0.155.1 公开 CLI/协议的真实帧，不凭 HEAD 源码宣称兼容 |
| C-A7/C-A11 | 维持内层沙箱、严格方法/字段过滤、FS 读写上限；未知能力不自动放开 |
| C-T5/本次范围 | 只修改 runtime/luna；真实网页验收完成前不报第 1 段交付，不进入第 2 段 |

## 6. 网页联调与恢复

第一轮（14:19–14:36Z）：

- 会合点和数据库均确认 stage1b 机器在线；旧 stage1 名称相似但离线，保存 machine-state.json。
- 所有者最初两次普通聊天显示“未归入项目”，没有请求到达代理，不能算验收。
- 从实际项目发起后，收到三次 initialize，全部拒绝，denied=3，原因均为 unknown or invalid request fields。逐条记录见 live-round1-denied.json。
- 以固定 0.155.1 的真实 app-server 复现，发现它显式发送 resumeSessionId:null；补允许字段并验证非空值必须是 UUID。
- 增加无模型的真实客户端 → 生产 WindowsBridge → 原生 exec-server 探针，又发现 environment/info 使用 params:null；仅对无参数方法接受 null，其他方法仍必须提供有效参数。
- 修复后 initialize、environment/add、environment/info、thread/start 全成功。该探针仍有 8 次拒绝：3 个不存在的白名单内 metadata、4 个白名单外 metadata，以及 environmentConfig/read（MCP 配置读取尚未开放）。线程可以建立，不放宽读白名单或顺手实现第 2 段 MCP。
- 原 Linux 代理恢复在线，配置摘要不变，见 live-round1-status.jsonl。

第二轮（14:42–14:51Z）：

- 只读查库确认 14:44Z 会话未归入项目，模式确实为 chat；14:47Z 新会话正确绑定 stage1b 和测试目录，模式为 work。见 browser-mode-diagnosis.json。侧栏顶部“＋新建”与项目页“新聊天/新工作”不是同一个入口。
- 所有者在项目工作会话中请求建文件，模型尝试四次终端命令，全部被拒；没有新文件。工作区仍只有本轮预建的 README.md、sample.txt。
- **denied=38**，逐条见 live-round2-denied.json：27 次 fs/getMetadata 越读白名单；5 次 fs/getMetadata 文件助手拒绝；2 次 environmentConfig/read（未开放 MCP）；4 次 process/start 未知字段。
- 后续本机固定 app-server 经同一生产 WindowsBridge 复现命令拒绝：实际多出 metadata、envPolicy、Windows 沙箱启动选项和五种保留环境标记；已逐项核值并适配。metadata 只允许 UUID threadId 与有限长度 toolCallId；私有桌面只接受 true、代理设置模式只接受 reconcile；未知字段/更宽权限依旧拒绝。
- 还支持真实 workspace-write 的 .git/.agents/.codex 只读覆盖及 missing_path_behavior=skip。缺失只读目录不再被误当成必须存在的 cwd 固定目标，不会创建它。
- 本机客户端使用**确定性本地模型响应桩**驱动真实 Codex 工具轮次，绝不冒充网页或真实模型验收：只读命令成功列出 README.md；默认工作模式申请 tmpdir/slash_tmp 写权限，被拒；只排除这两项后成功创建 client-created.txt，内容 client probe OK。见 client-read-command.json、client-write-default.json、client-write-confined.json。
- 成功命令结束后，客户端补发的 process/terminate 被拒为 unknown processId in this stream（guard 已在 process/closed 释放）。命令退出 0、轮次完成，不影响这两次成功对照；没有为避免计数而放行其他流的 processId。
- 另试未显式设置 Windows sandbox 的本机客户端：线程/轮次完成，但没有产生 process/start，也没创建文件，**失败**，见 client-default-windows-config.json。该对照不等于云端 Linux 客户端行为；远程需核对自己的客户端沙箱设置。
- 原 Linux 代理于 14:51:31Z 恢复在线，配置摘要不变；见 live-round2-status.jsonl。未轮换令牌、未改任何应用/集群配置。

两轮结束后的 capabilityRoots/discoverV1、非空 FS sandbox、HTTP 没有形成真实网页通过证据，
仍不开放。第一轮初始化就失败；第二轮仅成功进入握手后的发现/命令阶段。不能据此保证后续不会再遇到协议差异。

## 7. 交远程的具体修改与复验顺序

任务书第一节规定“只动 runtime；要改工作台后端就停下，写结果，由远程改”。本次停点遵守这条。
下面是已用固定版本公开 schema 和本机命令对照确认的最小配合点，**本仓没有替远程修改后端**：

1. `investment-backend/app/app/domain/workbench/projects.py` 的 `turn_settings()`，WORK 与 EXPERT
   返回的 workspaceWrite 当前只有 writableRoots=[]、networkAccess=false；固定 0.155.1 会自动追加
   tmpdir/slash_tmp 写权限。Windows 白名单仅含项目目录，不能放行这些全局临时目录。
   对这种本地上限，turn/start 应明确带：

   ```json
   {"sandboxPolicy":{"type":"workspaceWrite","writableRoots":[],"networkAccess":false,"excludeTmpdirEnvVar":true,"excludeSlashTmp":true}}
   ```

   两字段的公开 schema 默认值均为 false。是否只对 Windows 加、如何让需要临时文件的工具使用项目内
   临时目录，由远程按工作台的环境契约确定；不能为通过测试扩大全局白名单。普通项目聊天继续 readOnly。
2. 核对云端固定版 app-server 是否实际生成 `windowsSandboxLevel=restricted-token|elevated`；
   本机成功对照显式配置 [windows] sandbox=unelevated，不能把它当成云端默认配置已验收。
   执行器家的配置不能替代调用侧请求中的 sandbox 权限；代理仍拒 disabled/null/none。
3. 先审 runtime 修复、再发布工作台最小改动；恢复临时 Windows 连接后，所有者从**项目页面**依次
   新聊天列文件、新工作明确创建 browser-check.txt（内容 Windows stage1b OK）、请专家一次。
   每项核对真实工具输出/目标文件/账房终态，重新保存完整 denied 列表，结束恢复 Linux 代理。
4. 三项真实网页结果全部成功后才把 1b 改为通过，随后等远程审读，不直接进入第 2 段。

本轮没有越权去改工作台，也没有用本机模拟轮次替代所有者的三项验收。

## 8. 清理与交回

最终保存的探针再次运行：只读与排除临时目录的写入均退出 0，见 final-probe-exits.json、
client-final-read.json、client-final-confined.json。它们仍是本机确定性响应桩对照，不是网页验收。
最终新增帧再跑夹具/策略/环境回归，56 项通过，见 final-fixture-tests.txt。

Windows 测试目录 `C:\Users\zymun\sunmoon-probe-runs\windows-agent-1b-20261007`
已清理，含临时令牌配置、测试家、测试副本、依赖与符号链接夹具。先核对没有所属进程，
工作区只有本轮预建 README.md/sample.txt 后删除；没有删除用户成功创建的文件。
原 elevated 测试家 `.codex-probe-exec` 保留。Windows `.sunmoon-agent` 在本次清理前即不存在，
windows-cleanup.json 的 originalAgentDirectoryPreserved=false 表示未检测到该 Windows 目录，
**不表示删除了原 Linux 代理**。Linux 原目录、配置和实际进程另有独立核对回执。

最终原 Linux 代理仍在 fable/runtime/agent 运行原命令、在线状态新鲜，见 final-restoration.json；
隔离内读取 /proc 的一次断言失败，在隔离外只读复核身份与状态后通过。
临时脚本、原始联调日志、schema 导出清理清单见 temporary-cleanup.json；保留恢复代理所用的
两份 /tmp 输出日志，避免丢失运行期诊断。网页测试机器/项目记录未擅自删除；测试机器现在应离线。

本地提交后由所有者同步，停在第 1 段受阻审读，不推送、不进第 2 段。
