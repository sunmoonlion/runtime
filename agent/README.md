# @sunmoon/agent — 本地代理

用户机器上唯一要装的东西：包 `codex exec-server`（钉版 0.155.1，随包带），出站连会合点，守本地上限。不跑模型循环，不接触 key。

Windows 使用 **内层 Codex 沙箱 + 严格协议过滤**；Linux 保持 bwrap 外沙箱。
Windows 不嵌套外沙箱。`init` 实际启动受限命令，已有可用 elevated 环境时优先使用，
否则探测 unelevated；两者都不可用就拒绝启动。不会自动提权或运行 setup。

```text
sunmoon-agent start
├── codex exec-server：Windows 原生；Linux 在 bwrap 内
├── 出站桥 → wss://relay.sunmoonai.com:30443
│   ├── process/*：完整权限检查 → Codex 每请求沙箱
│   └── Windows fs/*：白名单检查 → codex sandbox → node.exe native/helper.mjs
└── status.json + 仅回环状态口
```

Windows 安装、后台、托盘、登录自启和卸载入口见[发行与日常操作](distribution/README.md)。
本机原生检查与所有者在干净 Windows 上的验收分别记录，不能互相代替。
阶段结果及限制见 `../scripts/results/windows-agent-1.*.md`。

## 命令

```bash
sunmoon-agent init --relay wss://edge.example.com/relay --user <id> --token <t> --root ~/research
sunmoon-agent roots add|remove|list <dir>          # 改完要重启 start（外沙箱的 bind 在启动时定）
sunmoon-agent ceiling show | set --sandbox read-only|workspace-write|danger-full-access --network on|off
sunmoon-agent start                                # 前台调试
sunmoon-agent start --background                   # Windows 后台，确认用本机窗口
sunmoon-agent tray                                 # Windows 托盘；退出后后台继续
sunmoon-agent stop                                 # Windows 正常停止
sunmoon-agent autostart enable|disable|status        # 当前用户登录自启，默认关闭
sunmoon-agent status
sunmoon-agent mcp import                          # Windows：本机逐项确认 HTTP MCP
sunmoon-agent mcp list                            # 查看已确认配置；不读取用户凭据
```

## Windows MCP 与临时权限（第 2 段候选）

这部分源码已有本地回归。2026-10-08 Cursor 已补齐普通用户 Windows 150/150，
并发布投资后端与 relay。随后真实本机确认→工作台提交→回执→执行链已通过；
真实 MCP 调用、两次旧投影拒绝的完整定位由所有者决定延后，整段不标全通过。

`mcp import` 固定读取当前 Windows 用户的 `~/.codex/config.toml`，只选择 HTTP/HTTPS
`mcp_servers` 条目。在本机交互终端逐项列出、输入本次随机确认码后，保存到代理配置目录
`mcp.json`；重新启动 `start` 时写进代理自己的 `codex-home/config.toml`。
后续重启继续沿用已确认条目，不自动跟随用户配置变化。没有确认的项不写入。

支持 URL、enabled/required、超时和工具白/黑名单；带 command/args/env、HTTP 认证头、
bearer 环境变量、URL 用户信息/查询串/fragment 的整项跳过，不悄悄删掉认证字段后导入。
模型、偏好、skills、auth.json、OAuth 缓存均不复制。URL 路径也可能含秘密，确认前须人工核对；
代码不能判断任意路径中的不透明字符串是否是令牌。固定版 Codex 会经 `http/request`
交给本机 exec-server 发 HTTP；这里的 `localhost` 是本机。必须明确开启本机网络上限，
禁网时立即拒绝；导入不会替你开启联网。HTTP URL 必须与本机确认且 enabled 的完整地址
逐字相等，不接受子路径、查询或主机/端口替换；请求必须显式 stop 跳转。
此前“请求从云端发出”的说明已按真实帧纠正。
需要认证的 MCP 仍由服务端自己的受保护配置管理，本轮不支持转交个人 MCP 凭据。

移除已导入条目：停止代理，在本机编辑代理配置目录 `mcp.json` 删除整个服务键，
运行 `mcp list` 检查后重新启动。不要修改自动生成的 codex-home 文件；它会在启动时重建。
解析器新增 `smol-toml@1.4.2`，用于完整 TOML 解析和重新序列化，纯 JS、无原生编译。

超出当前配置上限但仍在 Windows 固定沙箱和目录白名单以内的 `process/start`，
前台 `start` 在本机终端确认，`start --background` 使用系统 WinForms 窗口。
后台窗口走私有子进程管道，没有网络批准接口；远端命令强制私有桌面。
提示包含线程、目录、程序、权限范围、请求摘要；
60 秒内输入当次随机码才同意，无 TTY、超时、断线或拒绝均不放行。云端不能填写此答案。
同意后还要收到工作台事务提交后的 `recorded` 回执，最长等 30 秒；旧 relay、不匹配的会话、
审计失败均拒绝。回执证明决定已记账，不证明命令已执行。

临时授权仅用于当前数据连接中的同一 thread、目录和权限摘要，最长 30 分钟，
断线、控制通道重连、退出即失效；不改 config.json 的默认上限。
允许只读提升到白名单内 workspace-write、或相同范围的联网权限；
**Windows 的 danger-full-access/null sandbox 永远拒绝并报告摘要，不弹出批准选项**。
新目录、未知字段和不带 threadId 的文件 RPC 不能借此扩权。永久改目录/上限仍走本机配置命令。

## Windows 日志与拒绝排查

`start` 在 `%LOCALAPPDATA%\sunmoon-agent\logs` 写 `agent.log`，每份 2 MiB，
共保留 5 份（含当前文件）；仅轮转这五个自有文件。stdout/stderr 继续可见。
令牌和敏感字段脱敏，不记录执行器原始 stdout/stderr、命令正文、环境或 MCP 配置。
轮转/写入失败给出一次提示；检查目录权限、磁盘空间，不能以关闭沙箱解决。

令牌无效/吊销：从网页重新取得 init 命令，本机重新配置；不把令牌贴到日志或工单。
同账号被新代理替换：保留所需代理，不循环重连互踢。Codex 配对版本不一致：
保持代理在线等待兼容沙箱，同时显示配套升级提示，不自动换版本或降级。
`status.json` 的 `lastError`/`lastNotice` 只记录已知原因，不回显任意远端错误文本。

配置：`~/.sunmoon-agent/config.json`（`SUNMOON_AGENT_HOME` 可改目录），600 权限。
Windows 路径按本地盘符绝对路径处理，大小写和斜杠形式不影响白名单匹配；
UNC/设备路径、ADS 和存在 Win32 歧义的路径目前明确拒绝。这里只做路径规范化，
不以字符串过滤替代 OS 沙箱对符号链接的约束。

## 本地上限怎么挡

| 平台/入口 | 边界 |
| --- | --- |
| Windows process/start | 只接受固定版 managed/restricted 权限；逐项核对可写路径、cwd、workspaceRoots、网络；禁止 null/disabled/none 和配置环境变量覆盖 |
| Windows fs/* | 只读写白名单，额外允许读取代理 codex-home；拒绝 auth.json 和 .sandbox-secrets；未列入的方法、消息及二进制帧都拒绝并记日志 |
| Windows 文件助手 | `codex.exe sandbox --permission-profile … -- node.exe helper.mjs`，普通 Node fs 写入受 OS 沙箱约束；读取使用目录固定、真实路径及打开文件身份检查，拒绝联接/链接别名 |
| Linux | 保留既有 bwrap + filter.ts 行为，不把 Windows 的读限制偷偷套到 Linux |

Windows `--no-outer-sandbox` 被忽略。状态明确标识 `inner-sandbox+strict-protocol`、
实际探测模式以及 `sandboxed:false`（执行器本身无外层）。这不表示文件助手或命令无沙箱。
沙箱命令的运行库仍需要系统读取权限；文件 RPC 的读白名单不是对任意命令的全盘禁读承诺。

Windows 命令继承当前用户的 PATH 和普通环境变量，过滤 `CODEX*`、`SUNMOON*`、
`NODE_OPTIONS`、`NODE_PATH`、`RUST*`、`LD_*`，将 CODEX_HOME 固定到代理的执行器家，
再合并允许的远端环境变量。Windows 环境键按大小写不敏感合并；远端不能覆盖保留项。
`TEMP`、`TMP`、`TMPDIR` 也属于保留项，统一固定到代理创建的
`%LOCALAPPDATA%\sunmoon-agent\tmp\executor-<随机后缀>`。每次代理/探测启动独立创建，
执行器及其命令共用，目录在使用期间固定；退出时先停进程树再删除自己的目录。
不清扫其他实例的临时目录。异常断电残留的自动回收尚未实现。
固定客户端自动附带的版本、线程 ID、CI/禁网标记先按真实协议核值，再丢弃；
不让它们变成远端环境覆盖。只接受已核实的 `inherit=all` 环境策略，
实际转发完整过滤后的环境并使用 `inherit=none`，防止执行器内部变量被再次继承。
代理不替用户安装 Git/Python/uv；工具须先能在该 Windows 用户的 PATH 中找到。

当前明确拒绝：UNC/设备路径、8.3 别名、ADS、硬链接、符号链接；未知方法；
非空的 FS 请求 sandbox（尚未实现其更窄权限组合，不会丢弃后放行）；
process 的显式文件权限目标目前须为可固定的现有目录；只读且标记 `missing_path_behavior=skip`
的缺失目录保留原限制，不为固定目录而创建它。默认 workspace-write 的 `tmpdir` 写权限仅在
执行器 TEMP/TMP/TMPDIR 与上述受管目录一致、目录身份及固定进程仍有效时接受；
`slash_tmp` 在固定 Windows 0.155.1 上不增加可写路径。无需工作台排除临时目录，
不会因此开放用户全局 Temp。`http/request` 暂不在 Windows
允许清单，网络开关不会放行未知方法。能力不足返回 `-32001`，不降级执行。

跨系统编排有一项明确例外：Linux app-server 的后备目录可能产生 `file:///data/.codex`
这类纯 POSIX 路径。仅当它是 `read`、`missing_path_behavior=skip` 且不是 Windows
绝对路径时，桥在转发命令前丢弃该无效条目。Windows 只读保护仍保留；写权限、
未带 skip、混合 `/data/C:\\…`、UNC/设备/别名路径照旧拒绝。不会删除前缀猜测目标。
这不改变 `fs/*` 请求的读白名单。

白名单内缺失文件返回固定执行器的 `-32004`，保留本机 Windows 的错误消息，
不算权限拒绝；路径经过联接或链接时仍拒绝。命令结束后，同一流在 60 秒内补发
`process/terminate` 返回 `running:false`；陌生或其他流的进程 ID 不放行。
`environmentConfig/read` 目前只接受已捕获的 `mcp_servers` 查询字段，
由沙箱助手只读代理生成的 `config.toml`，返回与原生相同的空配置层。
其他配置内容、项目配置和 requirements 文件不读取。HTTP MCP 导入与合并见上文。

文件助手和目录固定助手均复用正在运行代理的本机 Node。**不依赖 Python，
不编译自有 exe，不使用 native addon/FFI。**第 3 段打包采用官方 Node 运行时 + JS
文件 + 固定版官方 Codex 二进制；不能用 SEA/pkg 或自编译 helper 重新引入自有 exe。
本机 Smart App Control 为 On，自编译未签名 helper 曾被应用控制拦截；不能要求
关闭应用控制或添加绕过规则。将来安装包能否运行仍须在目标机器单独验收。

## 开发

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test
```

测试：`test/filter.test.ts`（过滤规则，用真实抓到的帧）、`test/outerSandbox.test.ts`、`test/relayClient.test.ts`（假会合点 + 假 exec-server 的进程内端到端）。
一机联调见 `../scripts/integration-minimal-pair.sh`。
Node 最低 20.13（跨平台 `fileURLToPath(..., { windows })`）；本次在 Node 24 验证。
Windows 开发测试使用 pnpm 10.24.0 的 JavaScript 入口；本机 pnpm 12.0.0 原生入口
曾报 `spawnSync ... pnpm-native.exe UNKNOWN`，没有因此改动项目依赖或锁文件。

### Windows 原生攻击用例

在 Windows 本地 NTFS 检出/测试副本运行，使用本机 Node（本次 24.19.0），固定 Codex 0.155.1。
`test/windowsNative.test.ts` 在 Windows 必须执行，Linux 会明确跳过，不将跳过算通过。
需要两个测试输入（都不得含真实凭据）：

- `SUNMOON_TEST_ELEVATED_HOME`：已做 setup、无 auth.json 的测试家。普通用户执行测试，不自动提权，不复制 .sandbox-secrets。
- `SUNMOON_TEST_SYMLINK_FIXTURE`：独立夹具目录。其 `outside/secret.txt` 内容为 `outside-control`；
  `allowed/directory-link` 是指向 outside 的 Windows 目录符号链接，
  `allowed/file-link.txt` 是指向该 secret.txt 的文件符号链接。
  预先由具备创建符号链接权限的人创建；不用 junction 冒充 symlink。

```powershell
$env:SUNMOON_TEST_ELEVATED_HOME = 'C:\path\to\credential-free-test-home'
$env:SUNMOON_TEST_SYMLINK_FIXTURE = 'C:\path\to\test-links'
corepack pnpm@10.24.0 build
corepack pnpm@10.24.0 typecheck
corepack pnpm@10.24.0 test
```

原生测试包含允许操作对照、OS 直接写入边界、启动沙箱后替换联接、读取替换、
symlink/hardlink/大小写/短名/设备路径、严格方法过滤及 CLI 生命周期。
生命周期测试用回环测试会合点断开 20 秒后重连，并发送 4003 验证退出与进程树清理；
这不是对生产网页“轮换令牌”的冒充验证。现网网页在线另由所有者确认。

### 固定版本文件协议核对

在完整 Windows 测试副本的仓根执行（需先构建 agent，保留 probe/frames.jsonl）：

```powershell
$env:SUNMOON_PROBE_OUTPUT = 'C:\path\to\owned-probe-results'
node probe/windows-agent-contract.mjs
```

探针只创建自有临时目录，不接会合点、不使用模型凭据；比较原生 0.155.1 与助手的
完整响应，输出 fs-frames.jsonl 和 fs-comparison.json。环境值在帧中脱敏。
对照包含 12 种文件方法、块读取边界、真实 PATH 命令和目录句柄实验。
样例响应一致不代表所有错误情形兼容，也不能代替网页聊天/工作/专家的真实联调。

### 固定客户端命令协议核对

`node probe/windows-client-bridge.mjs` 用本机确定性 HTTP 响应驱动固定版 app-server，
经过真实 WindowsBridge 和 exec-server 执行一次只读命令。没有外部模型调用或用户凭据。
`SUNMOON_PROBE_WRITABLE=1` 改为创建探针文件；默认工作策略通过代理受管临时目录执行。
`SUNMOON_PROBE_EXCLUDE_TEMP=1` 仅保留为诊断对照，产品不要求这个排除设置。
输出仍由 `SUNMOON_PROBE_OUTPUT` 指定；命令退出、轮次完成和目标文件均检查，失败返回非零。
默认客户端显式配置 unelevated；`SUNMOON_PROBE_CLIENT_DEFAULT_WINDOWS=1` 可对照未配置时的行为。
这些是协议与执行器诊断，不能当作真实浏览器、实际模型或 Linux 云端客户端的验收。

`probe/windows-agent-1c-contract.mjs` 补抓缺失路径、结束命令终止、配置层及临时权限的
固定版真回包。`test/windowsFollowup.test.ts` 验证同码同消息、目录替换攻击、环境覆盖攻击、
受管临时目录写入对照与固定配置来源；无需模型服务或生产令牌。
