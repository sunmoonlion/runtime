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

开发入口已验证；安装器、托盘、开机常驻和干净 Windows 10/11 验收留第 3 段。
阶段结果及限制见 `../scripts/results/windows-agent-1.*.md`。

## 命令

```bash
sunmoon-agent init --relay wss://edge.example.com/relay --user <id> --token <t> --root ~/research
sunmoon-agent roots add|remove|list <dir>          # 改完要重启 start（外沙箱的 bind 在启动时定）
sunmoon-agent ceiling show | set --sandbox read-only|workspace-write|danger-full-access --network on|off
sunmoon-agent start                                # 前台；systemd/launchd 由安装器管
sunmoon-agent status
```

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
其他配置内容、项目配置和 requirements 文件不读取。HTTP MCP 的导入和合并留第 2 段实现。

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
