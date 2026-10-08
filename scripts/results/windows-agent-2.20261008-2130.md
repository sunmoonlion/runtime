# Windows 代理第 2 段：本地候选，待 Cursor 补验与发布

结论：**undecidable，未完成第 2 段验收**。没有把缺夹具失败算通过，没有发布生产镜像，
没有重连或替换真实代理。Fable 在 k8s `434241be` 接受 1b 后，本轮按第 2 段任务继续。
所有者明确授权必要的跨仓源码修改，并要求试验成功后报备 Fable；又明确 Cursor 与 Luna 同机，
构建/发布直接交本机 switch-test/inbox，无需先推远端。本轮均只本地提交。

## 交给 Fable 的改动说明

| 仓 | 固定源码提交 | 改动 |
| --- | --- | --- |
| runtime | `6461f3f29c63d74dbdf0364a65de5c9ada7cdf7c` | HTTP MCP 本机确认导入、owned config 投影、临时会话权限、本机终端确认、审计回执等待、拒绝提示、Windows 轮转日志、协议锁与回归 |
| k8s | `4d0ff0433628b8e821ca6239eebd8cf46f0a4fe3` | relay 控制通道报告、受限队列、工作台持久化回执、Codex 错配 notice；Dockerfile 纳入新模块；提供方合同和测试 |
| investment-backend | `db96b401944b43fc2541704b165951eaac808e84` | MachineSync 接收报告，核所有者/机器/线程，Session 锁内幂等记录，事务提交后回执；真实 DB 回归和消费者锁 |

需要跨仓的原因：旧 relay 忽略 hello 后的上报消息；版本错配只通知沙箱。
工作台也没有接收审计/确认持久化的接口。按所有者本次授权补齐，未自行重设数据通道，
未修改前端或沙箱公开协议。提供方真源是 relay/local-permission-v1.json，两个消费者锁定
canonical SHA-256 `0b4ec422bebc4835a2c251410cd0432416db7bc39be1a025806f1bcc9d2b6981`。

报告只含 UUID、摘要、决定、权限范围和期限，不含命令、环境、路径或令牌；
当前 conn 必须属于当前代理。工作台按 relay 用户绑定所有者，核 thread 对应 Session/机器。
`agent/localPermission` 使用既有 record 账本及事务 outbox；无需数据库迁移。
DB 提交后才发 recorded；本机已同意且收到正确回执才转发命令。重复上报不重复入账，
同 id 改内容拒绝；代理替换、连接断开、过期、旧 relay、失去回执都不带着许可继续执行。

## 需要审阅的明确边界

1. **Windows 内层沙箱不可关闭**。临时确认只允许白名单内 read-only → workspace-write 或联网；
   同一连接、thread、cwd/权限摘要，最长 30 分钟，重连/退出即失效。新路径、未标 thread 的 FS RPC
   不适用。danger-full-access/null sandbox 直接拒绝并报告 denied，不能得到 approved 回执。
   这承接第 1 段的安全决定，不能把本轮写成支持无沙箱提权。
2. MCP 只导入明确确认的无认证 HTTP/HTTPS 项。stdio、认证头、bearer 环境变量等整项跳过，
   不复制 auth.json、模型/偏好/skills/OAuth。URL 路径中不透明字符串是否为秘密仍需本机人工判断。
   本功能只传公开配置，调用端在云端；没有实现访问用户 localhost 的隧道。
3. 终端 60 秒随机确认码，无 TTY 拒绝；无云端自动回答入口。审计最长等 30 秒。
   本机 TTY 的同意/拒绝已由合成测试实际操作，不冒充所有者批准过某个真实请求。
4. Windows 日志 2 MiB × 5，自有文件轮转，敏感字段/已知令牌脱敏；执行器原始输出不入日志。
   只记已知拒绝原因，Codex 错配 notice 不把代理踢下线。
5. 新增 `smol-toml@1.4.2` 完整解析/序列化 TOML，纯 JS；Windows 产品仍只用 Node 和
   固定官方 Codex 0.155.1。不编译自己的 exe，不修改 Smart App Control。

## 已跑的检查

| 检查 | 实际结果 |
| --- | --- |
| Linux build、typecheck | pass |
| Linux pnpm test | 124 pass，26 Windows 专用 skip |
| relay 环回协议回归 | 39 pass；队列、回执、伪造 conn、替换代理、过期/重放、非致命 notice |
| 后端相关单测/真实 PostgreSQL/契约 | 31 pass；独立 DB，提交后可见、并发幂等、改内容拒绝、回滚与 outbox 一起撤销 |
| 后端 ruff / pyright / 架构导入门禁 | pass / 0 errors、0 warnings / 4 kept、0 broken |
| Windows Node v24.19.0 build、typecheck | pass |
| Windows pnpm test | **149 pass、1 fail**；唯一失败是缺预建原生 symlink 夹具，普通用户创建返回 EPERM |
| Windows 新增原生对照 | MCP 投影与固定版实际返回一致，不读项目配置；未记账不执行，同意且记账后白名单写入成功、外部写入失败 |
| Windows 既有原生边界 | unelevated/elevated、junction、hardlink、目录替换、20 秒控制断线、吊销退出与进程树清理通过 |
| Linux integration-minimal-pair.sh | pass；真 app-server/exec-server、bwrap、relay、bridge 和模型 turn；内写成功、danger 外写被拒 |
| PowerShell 夹具脚本语法 | pass；**仅解析，没以管理员执行** |
| Windows 应用控制只读状态 | `VerifiedAndReputablePolicyState=1`；当前测试账号 `IsAdmin=false`；未改策略 |

临时数据库启动时遇到连接 HBA/SQL_ASCII 配置问题，修正本次独立库后才得到上述通过结果。
首轮 Windows 副本漏带公开 frames 和 elevated 测试家路径，已补齐；另修正新增测试漏写
toolCallId 的错误。不把这些先前失败删除或当产品通过。

证据索引：[verification-summary.json](windows-agent-2-20261008/verification-summary.json)，
保存固定提交、日志绝对路径及 SHA-256。Windows 副本与被测 agent src/native/test/contracts
逐文件相同；早轮日志在同一目录按时间后缀保留。实际私有配置未导入，无真实令牌写进本轮夹具。

独立 PostgreSQL 测试容器已停止并按 --rm 移除，仅 tmpfs 测试数据；生产数据库/容器/卷未动。
Windows 副本、失败日志和公开夹具保留给 Cursor 补验。

## 没查与下一步

- **环境事实**：原生文件/目录 symlink 的剩余一项未跑通；Cursor 只创建两个测试链接，再以普通用户
  跑全套。准备脚本为 scripts/prepare-windows-link-fixture.ps1，不关闭系统保护。
- **服务端与授权**：两个新镜像尚未发布，真实工作台记账 → relay 回执 → Windows CLI 放行仍待联调；
  合成回执测试不能替代这条链。MCP 真实端点调用与用户选择导入也待验。
- **既有非致命拒绝**：1b 第 4/6 轮的 environmentConfig/read 日志没有保留原始参数，
  本轮只能核已抓到的 MCP 投影，不能断言两次旧拒绝已解决。真实联调时捕获受限字段再定位，
  不依据猜测放开任意 TOML 投影。
- **执行者内部**：继续承认原有系统运行库读取需求；未承诺所有命令全盘禁读，也不恢复代理重启前
  丢失的运行中命令输出。安装器、托盘、自启仍属于第 3 段。

待办：k8s/sunmoonai/docs/dev-investment-agent/switch-test/inbox/2026-10-08-luna-stage2-cursor.md。
Cursor 回执后 Luna 继续真实联调，补结果和提交清单，再交 Fable 完整审读；本报告不是验收完成通知。

exit=1
