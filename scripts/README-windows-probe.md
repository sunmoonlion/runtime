# Windows exec-server 探针

入口仍为 `scripts/probe-windows-exec-server.ps1`，固定 Codex **0.155.1**。
结果解释见 [2026-10-07 报告](../probe/REPORT-2026-10-07-windows-unelevated.md)。
这里是探针操作说明，不是代理安装器；不要据此改变现有代理或用户 Codex 配置。

## 准备

在 Windows 原生 NTFS 检出中运行，使用**普通、非管理员 PowerShell**。
需要 Python 3.10+、Node 22+（本次实测 24.19.0）及原生 `codex.exe`。
`.ps1` 保持带 BOM 的 UTF-8，兼容 Windows PowerShell 5.1。

```powershell
# 本机 npm 0.155.1 的实际布局；其他安装位置请填写对应原生 exe 的完整路径。
$env:CODEX_NATIVE_EXE = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$env:SANDBOX_MODE = 'unelevated'
$env:EXEC_PORT = '47011' # 已占用就选另一个；脚本不会占用或杀死别人的进程。
# 专用、当前普通用户可写、位于 USERPROFILE 之外的目录。
$env:L2_OUTSIDE_ROOT = 'C:\sunmoon-probe-outside-' + [guid]::NewGuid().ToString('N')
New-Item -ItemType Directory -Path $env:L2_OUTSIDE_ROOT | Out-Null
New-Item -ItemType Directory -Force scripts\results | Out-Null
```

若普通用户不能建立外部测试目录，停止并记录环境条件不足；不能用管理员创建测试文件来冒充普通用户写入对照。
每次 unelevated 运行使用新的 `.codex-probe-exec-unelevated-<GUID>`，不复制 `auth.json`，不跑 setup，不改 `~/.codex`。
日志记录执行端家路径、版本、管理员状态及三个源码文件 SHA256。
复制源码到 Windows 临时目录时，必须用 `PROBE_SOURCE_COMMIT` 标明 40 位基线提交；文件摘要记录实际改动后的字节。

## 1. 原模型驱动 L2 / L3

```powershell
$env:ORCH_HOME = Join-Path $env:USERPROFILE '.codex-probe' # 已独立登录的测试家
$env:PROBE_OUTER_SANDBOX = '0'
Remove-Item Env:PROBE_FS_ONLY, Env:PROBE_START_ONLY, Env:PROBE_PROCESS_ONLY, Env:PROBE_PROCESS_POLICY -ErrorAction SilentlyContinue
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-windows-exec-server.ps1
$probeExit = $LASTEXITCODE
```

执行端仍默认只读；编排端以 `workspace-write` 请求执行一次固定命令。
L2 同时检查用户目录内、cwd 外的文件和 `L2_OUTSIDE_ROOT` 内的文件；L3 检查 cwd 内文件。
每个路径先由普通用户完成写入、删除对照。必须有实际命令结果，不能把模型拒绝、认证失败、超时或文件不存在当成沙箱通过。
模型服务认证失败时停止排查服务可用性，不反复重试，不把下面的纯本机探针当作这项已通过。

## 2. 不依赖模型的外层边界探针

```powershell
Remove-Item Env:ORCH_HOME, Env:PROBE_START_ONLY, Env:PROBE_PROCESS_ONLY, Env:PROBE_PROCESS_POLICY -ErrorAction SilentlyContinue
$env:PROBE_FS_ONLY = '1'
$env:PROBE_OUTER_SANDBOX = '1'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-windows-exec-server.ps1
$probeExit = $LASTEXITCODE
```

现有 PowerShell 入口负责启动与收尾，`probe/probe_windows_fs.mjs` 只发送本机 JSON-RPC。
无第三方依赖、不请求模型、不携带凭据。真实握手为 `initialize {clientName}`，随后 `initialized` 通知；写请求字段为 `dataBase64`。
请求使用 `sandbox:null`，验证的是**包住整个 exec-server 的 OS 层**，不是请求自带的沙箱。

脚本通过 `-c` 传入 named permission profile，不覆盖已有配置；仅允许测试工作目录和独立执行端家写入，其他目录只读；允许联网以使用回环 WebSocket，**不声称提供网络硬隔离**。
实际命令形状：

```text
codex.exe sandbox --permission-profile probe_outer -C <probe\user-ws> -- codex.exe exec-server --listen ws://127.0.0.1:<port>
```

钉定版本 Windows CLI 使用 `sandbox [COMMAND]`，不要加 `windows` 子命令。
`PROBE_START_ONLY=1` 仅检查监听，总是以 `2` 返回，不能证明边界通过；不能与 `PROBE_FS_ONLY` 同时设置。

对照运行：仅改 `$env:PROBE_OUTER_SANDBOX = '0'` 后重复同一入口。
此时应看到 `mode=unwrapped-control`，三个写入都成功。对照退出 `0` 表示基线可写，**不是安全隔离通过**。
外层运行应看到 `mode=outer-boundary`：目录内成功，目录外两处均明确拒绝，文件不存在。

## 3. 直接进程请求与嵌套执行（第 1 段）

```powershell
Remove-Item Env:ORCH_HOME, Env:PROBE_START_ONLY, Env:PROBE_FS_ONLY, Env:PROBE_PROCESS_POLICY -ErrorAction SilentlyContinue
$env:PROBE_PROCESS_ONLY = '1'
$env:SANDBOX_MODE = 'unelevated'
$env:PROBE_OUTER_SANDBOX = '0'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-windows-exec-server.ps1
# 再用新执行端家复测外层内的嵌套；不要与上述运行并发占用同一端口。
$env:PROBE_OUTER_SANDBOX = '1'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-windows-exec-server.ps1
```

仅复测历史上已经 setup 的执行端家时，使用 `SANDBOX_MODE=elevated`。
脚本不执行 setup、不复制沙箱账号材料；`.codex-probe-exec` 必须预先独立准备且不含 auth.json。
模式是显式请求值；不要仅凭它或 `sandboxType=windowsRestrictedToken` 宣称实际运行身份为 elevated。

`probe/probe_windows_process.mjs` 使用 `initialize/initialized` 后直接 `process/start`。
`environment/add` 属于上游 app-server，与本机 exec-server 握手是两个接口。
真实请求包含 `tty:false`、白名单 env、`permissions`、`workspaceRoots`、
`windowsSandboxLevel`；配置里的 `unelevated` 对应 wire 值 `restricted-token`。
命令用 PowerShell `Set-Content`，不使用 ConstrainedLanguage 禁止的任意 .NET 方法调用。
先做普通用户可写对照，再检查实际 process/exited、权限错误和文件内容。
三项中没有真实子进程结果就记 undecidable，不把“文件没生成”当作拒绝通过。

`PROBE_PROCESS_POLICY=outer-only-control` 是**诊断对照**：仅在外层已启用时发送
`sandbox:null`，用于分离外层执行能力与内层创建失败；其通过不能替代双层组合验收，
也不能用来改写产品请求、丢弃只读或网络权限要求。测试后删除此环境变量。

当前结论：内层三项通过；unelevated 外层中的嵌套启动可重复报
`CreateRestrictedToken failed: 87`；elevated 外层尝试超时。
具体帧和限制见 `scripts/results/windows-agent-1.*.md`，不是 Windows 上线通过记录。

## 结果和收尾

退出 `0` 为当前所选探针通过，`1` 为明确失败，`2` 为证据不足或执行错误，`5` 为执行器未监听。
JSON 帧中的 Base64 只包含固定测试标记。保留日志时不要附带任何认证文件。
探针结束清理自身进程树和测试标记；先留存结果，再删除**日志列明的本次独立执行端家**和空测试目录，不通配删除其他 `.codex*`。

## 保留的 elevated 复测方式

默认 `SANDBOX_MODE=elevated` 是兼容 2026-09-24 探针，不是本次无管理员验收的前提。
仅在专门复测 elevated 时，由管理员为 `.codex-probe` / `.codex-probe-exec` 分别运行官方 `codex sandbox setup --elevated --current-user`，随后回到普通 PowerShell 运行模型探针。
**本次 unelevated 探针没有执行 setup。**模式限制见 [OpenAI Windows 沙箱说明](https://learn.chatgpt.com/docs/windows/windows-sandbox)。
