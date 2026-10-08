# Windows 代理真实 MCP 续验（2026-10-09）

## 分工和依据

所有者纠正旧交接安排：仍由本地 Luna 开发，Fable 审读；需要构建发布再交同机 Cursor。
已读 k8s `86f51c9e` 中的深夜反馈，runtime 审读基线 `a95910f`。
后续完整包源码 `9f2b5c6`、最终报告 `3d5b48e`、清理 `97d7490` 尚不据此宣称获 Fable 审过。
完整安装闭环已在前次真机通过，见 [最终报告](windows-agent-3.20261008-2340.md)。

## 本轮方案

| 项目 | 明确范围 |
| --- | --- |
| 执行物料 | 已校验的 `sunmoon-agent-9f2b5c6` 完整候选，不重新发布业务镜像 |
| 本机服务 | 官方包内 Node，固定公开回显服务只监听 `127.0.0.1:48291`，唯一 MCP 路径 `/mcp`，30 分钟自动退出 |
| 代理配置 | 独立的本轮测试目录，原私有输入只读取用于连接；保持 read-only，网络从 false 临时改 true 须先确认 |
| 导入 | 独立 USERPROFILE 中仅一个无凭据回环 MCP 项，通过真正的本机终端确认；不模拟确认、不复用旧码 |
| 云端 | 现有 investment-runner 的公开 app-server 连接；新建 ephemeral read-only thread，无模型 turn、无数据库业务写入 |
| 验收 | 云端枚举出 fixture，再调用 `stage2_echo` 取得固定公开 marker；保留桥的拒绝原因与请求的非敏感字段 |
| 失败 | 记录 fail/undecidable；网络、精确 URL、禁止跳转、沙箱和审计限制不放宽 |
| 清理 | 关闭本轮网络、停代理/回显、清除临时凭据副本，保存脱敏证据；真实用户配置摘要不变，原代理仍保持开始时状态 |

`http/request` 若为 follow/缺省而不是 stop，按现有边界拒绝并把真实契约问题报 Fable。
不通过改帧或更换执行路径把失败包装成通过。

适用约束：C-A4 只用公开协议、C-A11 本机权限上限、C-I9 令牌隔离、C-R8 Codex 两端钉版。
Python 仅运行既有云端后端探针；Windows 产品、文件助手和本机回显均使用 Node。

## 准备时的事实

- 本地候选清单摘要仍为 `95d9219ee12ffeb9b5a992523f9f8a0a8348bfce3c1b2d5c2be79d52f6511946`。
- 原 Linux 代理配置摘要仍为 `c80e10838cac82599861d996b94a5d095f67457e6192e99bb9d798c28bb4fe16`。
- 通过既有脱敏只读探针，relay 返回 `agents: {}`；两个既有网页测试会话与项目目录仍存在。
- 已确认前次真人审批 cursor 402 的持久化记录仍可读；这不是本轮 MCP 通过证据。
- 准备检查时尚未启动 Windows 代理/回显，未开启网络，未发 MCP 实际调用；随后按下面批准执行。
- 探针把误写的 cloud-loopback 提示改为 Windows 本机回环，并只记录 URL 是否等于固定
  fixture、HTTP method、redirectPolicy、streamResponse；不输出任意 URL、headers 或正文。

## 本轮执行与证据

所有者确认“现在开始，我能配合本机确认”，批准仅本轮临时网络；之后在 Windows
普通用户终端亲自确认导入，回复“本机确认已收到”，导入退出 0。没有代填或记录确认码。

证据目录：[windows-agent-2-mcp-20261009/](windows-agent-2-mcp-20261009/)。

| 事件 | 实际结果 |
| --- | --- |
| 原生准入 | 最终包实际探测 `unelevated` 可用；未使用管理员或执行 setup |
| 本机导入 | 唯一 `sunmoon_stage2_fixture`、精确 `http://127.0.0.1:48291/mcp`，本机真人确认，退出 0 |
| 连接 | 同一测试机器接现网 relay；read-only，network=true；真实用户配置未变 |
| 云端枚举 | 现有 investment-runner 经公开 app-server 协议建立 ephemeral 线程，`fixtureListed=true` |
| 实际调用 | `mcpServer/tool/call` 返回固定文字 `SUNMOON_STAGE2_HTTP_MCP_20261008`，`isError=false`，探针退出 0 |
| 服务端接收 | Windows 回显日志实际收到 initialize、notifications/initialized、tools/list、tools/call |
| 配置投影 | 两次 `environmentConfig/read` 均是已知 Windows 项目 URI、只请求 mcp_servers，未被拒 |
| 正常退出 | 代理于 `2026-10-08T16:18:22.990Z`（本地 10 月 9 日 00:18）exit=0 |
| 恢复 | 临时网络标记关回 false，回显与两个测试终端停止，48291 无监听、无本轮进程，relay agents={} |
| 凭据与目录 | 脱敏证据归档后，本轮精确目录及临时令牌副本删除；原 Linux 配置 SHA256 未变 |

本次 ephemeral thread：`01a11c4e-2220-7b90-aa6d-26a2e904315f`。
回显调用约发生于 `2026-10-08T16:17:25.579Z`；固定 marker 中的 20261008 是夹具常量，
不是本次执行日期。时间和真实回包分别在 fixture.log、cloud-call.jsonl 中。

### 拒绝记录全部保留

| 方法/条件 | 次数 | 结果 |
| --- | --- | --- |
| fs/getMetadata：白名单之外 | 8 | `filesystem path outside the whitelisted roots`，照旧拒绝 |
| http/request：不是本机确认的完整地址 | 1 | `HTTP URL is not an exact locally confirmed MCP address`，照旧拒绝 |

共 9 个 HTTP 帧，全部显式 `redirectPolicy=stop`、streamResponse=true；8 个 URL 与确认地址
完全相同，1 个 GET 地址不同并被拒。诊断只记“是否等于 fixture”，没有记录任意 URL 的内容，
因此不猜该地址具体是什么。该拒绝没有阻止枚举与工具调用成功。

本轮没有 HTTP 跳转响应，禁止跳转的负向回归仍引用前次 302 目标命中为 0 的证据；
不把它写成本轮重新测过。真实请求确实使用 stop，不需要修改或降级边界。

### 工具侧异常也记录

启动 Windows 子进程的 WSL Python 控制器使用 `capture_output`，等待 25 秒后出现
`subprocess.TimeoutExpired ... timed out after 25 seconds`。当时启动回执、Windows PID、
代理 connected 状态和回显 ready 均已存在，因此没有盲目重启或重复启动。
后续真实调用退出 0，最后按启动回执里的精确 PID/路径停止并复核。
这属于控制器等待结束超时，**不是 MCP 调用失败**；尚未证明具体是哪条继承句柄导致等待，
后续控制器应独立记录启动回执，避免凭一次超时判断子进程未启动。

PowerShell 的 launch.json 采用 UTF-16，本地第一次按 UTF-8 读取报 UnicodeDecodeError；
恢复时由 PowerShell 自己读取该文件，成功核对 PID。未更改产品协议处理这种工具输出。

## 当前判定及限制

**pass：真实云端 app-server → 现网 relay → Windows exec-server → 本机 HTTP MCP 回显。**
采用公开协议直接调工具，没有模型 turn、没有网页点击、没有真实外部 MCP 凭据或公网服务；
不据此声称所有供应商、认证方式、模型主动调用均通过。

**仍待验**：真实重启/登录自启、干净 Windows 10/11、GUI 真人正向批准、可选 UAC 安装入口、
旧两次投影拒绝定位、当前源码的 Linux 模型最小对。当前两次投影成功不能解释旧拒绝。

只调整 `probe/windows-stage2-live.mjs` 的提示与脱敏诊断，以及 CHECKPOINT/本报告。
两个 Node 探针静态语法检查和两个 Python 探针 AST 解析通过；没有重跑全套单元回归。
发行源码/包仍是 `9f2b5c6`，本轮源码没有新增产品权限，未部署或重建集群。

Fable 接手审读时，请把反馈中的第 1、2 项与前次安装闭环、本次 MCP 证据对照，避免继续
按 `a95910f` 的较早停点安排重复验收。后续开发仍由 Luna 执行，这是所有者最新决定。

exit=0
