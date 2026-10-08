# Windows 第 1 段补验：工作台断后恢复修复与真实结果

交远程 Fable。2026-10-08，所有者临时授权 Luna 直接修改工作台源代码，试验成功后详细回报。
本报告接续 `windows-agent-1b.20261008-1750.md` 的失败现场；不改写其历史结论。
只本地提交，由所有者同步；未 push。Windows 代理产品代码仍为 `3bf4d3d`，
助手仍用官方 Node + Codex，没有增加 Windows Python 依赖、未自编译 exe、未放宽代理边界。

## 1. 当前结论与验收范围

| 项目 | 结果 | 证据/限制 |
| --- | --- | --- |
| 原专家断线后自动恢复 | **pass** | 同一个真实 Task 从 WAITING(ENVIRONMENT) 恢复一次，续完原第 2–5 步，18:57:09 SUCCEEDED，原失败 Attempt 保留 |
| 网页返回操作权 | **pass** | 所有者刷新原页面，回传“专家交回了”“接着让它做…”及发送输入框；数据库 wheel=user、active_task_id=null |
| 项目聊天空闲时代理重启 | **pass** | 原报告 17:50–17:52 同一个 chat/session/thread 发新命令实际读取，所有者确认；不是运行中断线验收 |
| 普通工作空闲时代理重启 | **pass** | 同一原 work/session/thread，19:05 建第一行，19:08 停代理，19:09 重连，19:10 新命令追加第二行；所有者回执及实际 38 字节相符 |
| 工作执行中断线 | **错误收尾与重连后继续操作通过；原命令输出未恢复** | 45 秒只读等待命令运行中停止代理，命令报超时，模型交回；同一会话下一问实际读取成功，未重复旧命令 |
| 聊天执行中断线 | **错误收尾与重连后继续操作通过；原命令输出未恢复** | 同样的只读延迟命令中途重启，模型报 25 秒恢复超时并结束；19:21 同一个聊天实际重读成功 |
| 投资工作台事件频道权限 | **pass** | 实际 publish/subscribe 回环、外频道/外 key/admin/FLUSHALL 拒绝、ACL 保存通过；新 API 未再出现原 subscribe 权限错误 |
| 线上“停止”按钮点击取消 | **未实测** | 原任务在用户查看前已完成；只有组件测试及本机 1280/390 宽度浏览器预览，不冒充现网取消验收 |

专家此次 Profile=DATA_QUERY，但原问题是读本机文件，先前测试指导不合适。这里证明的是
真实专家状态机恢复、完成和交还操作权，**不证明该 SQL 专家对文件问题回答正确**。
第 1 段最终由 Fable 审读，不自行进入第 2 段。

## 2. 原因与实现

### 2.1 专家等待没有恢复入口

原 MachineSync 只更新 online/offline；Advisor 不处理 WAITING，runner 接管也不捞这个状态。
所以代理已连回仍留在 WAITING(ENVIRONMENT)，单发 task.drive 也不能恢复。

修复保持账房为唯一状态真源：

1. 机器对账只为同一所有者、同一执行环境、advisor 持有且无活跃 Attempt/Interaction 的
   WAITING(ENVIRONMENT) 任务排持久 `task.reconnect`；任务行锁下检查 pending/claimed，避免重复排队。
2. runner 经固定版公开协议调用 `environment/info` 和 `environment/status`；只有 ready 才交给账房。
   超时、离线、不 ready 保持等待，下次对账再探测；探测不发用户命令、不调模型。
3. `Ledger.resume_environment` 再查所有者、会话、执行环境、操作权、取消状态与活跃对象，
   在同一事务完成 WAITING→QUEUED、事件与 task.drive；并发恢复/取消只发生一次有效迁移。
4. 保留 current_step 和原 Attempt，按既有重试机制创建下一次 Attempt；不恢复 INPUT/RESOURCE 等等待。
5. environment connected/disconnected 通知按 thread 隔离；短断在当前 turn 完成前恢复时清除其断线标记。

没有直接 SQL 修改现场状态、没有绕过项目互斥、没有禁用 Windows 沙箱。
本次自动恢复沿用既有步骤重试语义；**没有新增“任意外部写入自动幂等”的保证**。
有不可逆外部动作或结果未知的专家包，仍需其自身确认/幂等设计，不以本次只读 SQL 流程覆盖。

### 2.2 页面退路和项目占用提示

- 原停止按钮依赖可能为空的 now 快照；现在依赖非终态 Task，窄屏也保留按钮。
- 专家占项目的 409 原来显示通用“没有发出去”；现在提示占用原因并提供项目/专家入口。
- 首句失败后的重试复用已创建会话，避免每点一次新增空工作会话。
- 停止操作同时失效项目缓存，便于返回已释放状态。

### 2.3 SSE Redis 错误是另一件故障

原 investment_runtime 没有 subscribe 权限，SSE wakeup 订阅报 NoPermissionError。
这不能解释本次发送被 409 拒绝，也不能替代专家无恢复调度的原因。

通过原生部署链为投资应用增加 `investment:workbench:*` 频道的
publish/subscribe/unsubscribe，沿用原 key 边界；不使用全频道/全命令授权。
新 v3 初始化 Job 实测同频道收发、外频道和外 key 拒绝、管理员命令/FLUSHALL 拒绝，再保存 ACL。
tpl/info/knowledge 原渲染初始化内容逐字节未变。

## 3. 代码、提交与发布

| 仓 | 本地提交 | 内容 |
| --- | --- | --- |
| investment-app/investment-backend | `ab4da3064dac5f047b4204fa44f573b5f8cf2ab9` | 合法恢复、探测、通知隔离、数据库并发回归 |
| 同上 | `0f0ae68` | 63 项测试输出；部署源码仍固定 ab4da306，二者产品源码相同 |
| investment-app/investment-web-frontend | `9c47e303de255a357703a26ec6d818f037c6e9af` | 停止按钮、占用提示、首句重试复用会话及测试 |
| k8s | `dfe30caaf016765e788017dcfd5284d7c4a91f82` | 投资 Redis 频道权限、源码与镜像锁、渲染候选及真实原源快照 |
| k8s | `1fd485d3` | 晋级此次固定 Flux 源 |

两个子仓进入本轮时是 detached HEAD 且没有本地 luna，提交后各建立 luna 保留提交。
未改父仓 gitlink、未修改其它工位、没有 fetch/pull/rebase/push。由所有者脚本同步子仓再同步父仓。

后端产品改动集中于 application/workbench 的 machines、runner、ledger，repository 与 Port；
测试在 test_workbench_reconnect_db.py。构建静态检查另发现原代码的 7 处类型错误，本轮一并修复：
machines 可空字段用明确类型值，offline UPDATE RETURNING 的行数代替不可靠 rowcount 类型，
library 对不存在 artifact 名称先判空。没有数据库表结构迁移。

镜像（均为 `harbor.sunmoonai.com:30443/platform/` 下）：

- investment-backend：`sha256:d2e6ed5d20a3d9872170832f7efe29abab4a4d13785447b45ce98a648311d9c0`
- investment-web-frontend：`sha256:f2e2e6a1d9b646b124751694fa5e6e89451527fa10c742b811ca016838f40581`
- 当前 deployments-kind OCI：`sha256:e761175adf35e18eb525de2d977b637e8a80c2257069971fd3ee7918b1537b0e`

原 Make/Ansible/Flux 构建、Harbor 发布、stage、flux-release、flux-source-apply 后实际检查通过。
本次维护 18:48:31 开始，20:48:31 截止；没有关闭 WSL、重建集群或操作其它 Harbor。

部署前发现本地锁记载的旧 Flux 源落后于现网；没有直接覆盖。读取并校验现网 artifact，
解包后逐文件对比，只存在投资应用与共用初始化模板的 12 个预期差异。
原真实 OCI `sha256:4615fc1ab69c89b9b609bd15ad59f57600f7ff5aaaebc86ad376d7daf6ad4608`，
revision `ee0b19a94c41f22f5860f82f40cc8813fb605e0c`，回退锁已入 k8s 结果目录 source-before.yaml。
回退需用这份真实锁，经原 `make -C infrastructure flux-source-apply FLUX_SOURCE_FILE=<绝对路径>`；
它会恢复旧应用行为和旧 Redis 初始化，不能声称保留新恢复能力。当前未执行回退。

## 4. 自动检查与真实恢复时间线

- 后端 63 项通过：真实隔离 PostgreSQL 上的并发心跳去重、恢复一次、取消竞争、事务回滚、
  非环境等待不恢复、探测超时/not-ready、thread 通知隔离，另含既有回归。
- 后端 Ruff、格式、pyright（0 错误）、import-linter（4 条合同）通过。
- 前端 192 项通过、2 项原有跳过；typecheck/lint/i18n 通过。
- 本机 Playwright 1280/390 宽度均能看到停止按钮并打开确认；仅预览夹具。
- 原 `application-check APP=investment` 通过（最后 play：ok=50、changed=0、failed=0）。
- 部署前 139 个 Pod 中 134 个 UID 保持；替换的 5 个全为投资应用 API/runner/worker/scheduler/web。
  其它旧 Pod 没有被本次发布替换；替换数不表示所有新初始化 Job 数。

北京时间，完整事件见 fix-acceptance/expert-before.json、expert-after.json：

| 时间 | 事实 |
| --- | --- |
| 17:25:29 | 我的首轮 10 分钟计时器到期，代理退出；不是已证实的家庭网络故障 |
| 17:25:57 | 原 sql_generate Attempt FAILED/environment/retryable，Task WAITING(ENVIRONMENT) |
| 18:56 | 修复已上线，同名 Windows 代理第 4 轮连回 |
| 18:56:12 | 公开 ready 探测后，原 Task 唯一一次 WAITING→QUEUED，新 sql_generate Attempt |
| 18:56:25 / 41 / 57 | 继续 sql_execute、normalize、final |
| 18:57:09 | SUCCEEDED 与 wheel/return 同时落账，active_task_id 清空 |
| 19:06 左右 | 所有者回传页面“专家交回了”及“接着让它做…”输入框 |

Task=`5e77067c-983d-4e0d-a88e-e4e77f68fa71`；
session=`6e0bc2cf-7c86-4784-9156-5b4d3c7a6e5e`；
environment=`c4f8711a-5506-4b59-9469-0ed11e1d8b40`。
共 6 个 Attempt：原首步、原失败第二步、新第二至第五步，没有重复恢复或并行 Attempt。

## 5. 证据、剩余项与清理

runtime：`scripts/results/windows-agent-1e-20261008/` 保存原失败、真实聊天回执及各轮桥请求脱敏投影；
`fix-acceptance/` 保存修复前后原 Task 只读查询及停止按钮预览截图。
k8s：`sunmoonai/scripts/local-integration/results/reconnect-fix.20261008/` 保存真实旧源、差异和 Pod/日志核查。
后端：`app/scripts/results/reconnect-fix.20261008-tests.txt` 保存 63 项测试输出。

第 4 轮截至 18:59 的桥请求中，出现 1 次 `environmentConfig/read` 的
`unsupported executor config projection` 拒绝；另有预期的越白名单 fs/getMetadata 拒绝。
专家在该拒绝后仍完成，未因此放宽允许清单；完整轮次结束后补最终数量和逐条拒绝。
本轮专家恢复过程没有 process/start，不能把这段当作新的 Windows 文件写入验收。
第 4 轮后续原工作会话另有 1 次成功 process/start；全轮 80 帧、59 次拒绝（58 次越白名单
fs/getMetadata、1 次 config projection），19:08:38 正常退出并删除临时令牌。
第 5 轮有 25 帧、16 次越白名单 metadata 拒绝、2 次 process/start；第 2 个命令用于运行中断线。
19:13:28 正常退出，原配置未变、临时令牌已删；完整清单分别在 round4、round5。

普通工作空闲重连新 turn=`01a11b35-48d2-77c1-b1d5-b0e2ca9eeda8`；session/thread 与原专家完全相同。
目标文件 `reconnect-work-20261008.txt` 两行为 before-reconnect / after-reconnect，38 字节，
SHA-256=`39e5ed241ed8cb16a9ed7cf7a096d7d078acb7563315f8d6c958ff3e5c629d36`。
证据在 fix-acceptance/work-before*.json、work-after*.json。

运行中断线新 turn=`01a11b37-8782-7aa3-81c4-9864cc6c2afc`，命令是 45 秒延迟后只读同一文件。
真实 process/start 19:13:22 到达，4 秒后请求代理有序停止，19:13:28 退出；19:14:41 模型交回连接失败说明。
错误为 `exec-server transport disconnected; failed to resume exec-server session: recovery timed out after 25s`。
**命令失败，但模型正确报告后 turn 状态为 completed**；两种状态不能混为一谈。
没有自动重复文件命令，原文件未修改；证据 work-inflight-disconnect.json / work-inflight-events.json。

用户回传普通工作页仍有旧占位文案“专家做的每一步有它自己的进度页，这一部分还在做”。
来源是前端 messages/zh-CN.json 的 work 专家区文案；本轮没有改这段历史区的呈现。
它不代表后台任务仍在运行，但措辞容易误解，交 Fable 后续处理。

工作运行中断线后的下一问已通过：19:16:22 原 session/thread 的新 turn
`01a11b3a-4139-74e1-8001-e1369cd4698c` 完成，实际文件摘要不变。
聊天 19:18:13 process/start，4 秒后触发停代理，19:18:20 退出；19:19:11 模型交回错误并完成 turn
`01a11b3b-f6b6-7e93-98c0-d8522478d366`。第 6 轮 46 帧，32 次拒绝（31 metadata、1 config projection）。
这两项都是**代理进程重启**，没有模拟仅网络闪断且 exec-server 保活。原命令输出不能恢复，
不能写“运行中命令无损续跑”；下一问能继续操作与原命令成功是不同验收点。
聊天重连后下一问也已通过：19:21:29 新 turn `01a11b3e-a354-77d2-aabc-2d1ace1ef391` 完成，
所有者确认实际内容 hello！及 11 字节；原 session/thread 不变，SHA-256 与初始值相同。
证据 chat-inflight-recovered.json、final-files.json、owner-receipts.json。
仅网络闪断且进程保活未在本轮重新测试，不扩大本轮结论。
临时隔离 PostgreSQL、前端预览、只读 port-forward 已按精确身份停止，见 temporary-services-cleanup.json；
未清理其它容器/卷。Windows 第 7 轮于 19:22:42 正常退出（0），临时凭据已删除，
原 Linux 代理保持初始停止状态，原配置摘要不变。测试文件保留在用户项目，未删用户交回物。
Windows 机器随后离线是本次临时连接结束，已明确告知所有者，不是新的故障。

## 6. 最终桥记录、清理与交远程审读

完整请求脱敏投影与逐条拒绝分别在 round1–round7；汇总在 fix-acceptance/round-summary.json。
第 4–7 轮为本次修复部署后的轮次：

| 轮次 | 请求 | 拒绝 | 被拒的方法与原因 | 成功发到执行端的命令 |
| --- | --- | --- | --- | --- |
| 4 | 80 | 59 | 58 个 fs/getMetadata 越白名单；1 个 environmentConfig/read 投影不支持 | 1，工作基线建文件 |
| 5 | 25 | 16 | 均 fs/getMetadata 越白名单 | 2，重连追加、工作延迟只读 |
| 6 | 46 | 32 | 31 个 fs/getMetadata 越白名单；1 个 environmentConfig/read 投影不支持 | 2，工作恢复后读取、聊天延迟只读 |
| 7 | 16 | 8 | 均 fs/getMetadata 越白名单 | 2，聊天恢复后读取及字节确认 |

没有 process/start 因放宽上限而获准；两个故意断开的长命令失败属于传输中断，不能算成命令执行成功。
本轮没有收到 capabilityRoots/discoverV1 或 http/request，不能宣称它们兼容；
不支持的 environmentConfig/read 投影两次均未阻止网页操作完成，仍保留拒绝，交远程判断后续范围。

**给 Fable 的结论：**原专家卡死已实际修复；所有者亲自完成了网页聊天读文件、工作写文件、
专家返回操作权；另外补了同会话空闲重启及运行中重启后的聊天/工作继续操作。
本机证据足以交审此次第 1 段补验与临时授权修复，**不等于所有断线都无损恢复、不等于整个代理产品交付**。
未进入第 2 段；请审本次跨仓改动，再决定阶段验收与下一段。
