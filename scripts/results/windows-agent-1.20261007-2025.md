# Windows 代理第 1 段：沙箱组合阻塞，未完成

日期：2026-10-07（Asia/Shanghai）。仓：runtime；分支：luna。
代码基线：`e9f194b3d4178021f035cc81aeb1ed265299970c`。
任务及反馈：k8s `switch-test/luna-task-windows-agent.md`、`luna-feedback.md`，
k8s 提交 `6ded692ea7a8d5175f5253e4b28a938bb342e3ea`。

## 1. 结论与停点

**第 1 段未达到完成条件。**内层目录隔离和外层文件操作分别通过，但固定版
Codex 0.155.1 的外层包住 exec-server 后，嵌套进程执行未通过。
不能用“端口已监听”“文件没生成”或单元测试全过替代完整代理验收。

按约束 C-A7（能力不足不得启用）和 IMP 规则（发现设计问题交回审读，不顺手改设计），
当前 Windows `start` 明确拒绝启动，`--no-outer-sandbox` 不能绕过。
Linux 原有运行方式保留。没有取消请求沙箱、静默降级或更换 Codex 版本。

本次只修改 runtime。所有者批准的现网临时替换**尚未执行**，因准入未通过；
原 Linux 代理仍在线，无需恢复。未轮换令牌，未调用现网吊销接口。

## 2. 环境与有效实测

Windows 11 10.0.26200.0，普通用户进程（非管理员），PowerShell 5.1.26100.9444，
Node 24.19.0，Python 3.13.15；Windows Defender。Codex 原生 exe：0.155.1。
已有 `.codex-probe-exec` 曾做 elevated setup；所有 unelevated 测试使用全新执行端家，
不跑 setup、不复制凭据、不含 auth.json。没有覆盖 Windows 10 或干净机器。

每项写入前都由普通用户对同一文件完成可写/删除对照。执行结果须含真实
`process/start` 成功、`process/exited` 和预期文件/权限错误。

| 组合 | 工作目录外、USERPROFILE 内 | USERPROFILE 外 | 工作目录内 | 结论与原始记录 |
| --- | --- | --- | --- | --- |
| 无外层，内层 unelevated、新家无 setup | PermissionDenied，文件不存在 | PermissionDenied，文件不存在 | exit 0、内容正确 | pass；`inner-cmdlet.txt` |
| 无外层，内层 elevated、已有 setup 家 | 明确拒绝 | 明确拒绝 | exit 0、内容正确 | pass；`inner-elevated.txt` |
| elevated 身份补录 | 明确拒绝 | 明确拒绝 | exit 0 | whoami 为 `codexsandboxoffline`，并非只看配置推测；`inner-elevated-identity.txt` |
| unelevated 外层 + 内层 | RPC -32603 | RPC -32603 | RPC -32603 | 均为 `CreateRestrictedToken failed: 87`；`outer-cmdlet.txt` |
| 新家重做上述嵌套 | 同上 | 同上 | 同上 | 可重复；`outer-cmdlet-repeat.txt` |
| elevated 外层 + elevated 内层、已有 setup 家 | 首个请求 15 秒超时 | 未执行 | 未执行 | 不可判；`outer-elevated.txt` |
| unelevated 外层 + `sandbox:null` 诊断对照 | 明确拒绝 | 明确拒绝 | exit 0、内容正确 | 外层本身能运行子进程；`outer-only-control.txt`，**不能替代双层验收** |

上述日志均在 [windows-agent-1-20261007/](windows-agent-1-20261007/)。
嵌套组没有子进程终态，所以各目录边界记为 undecidable；“该组合能正常执行”的
能力检查失败。这不是声称沙箱越权，也不是断言所有 Windows 组合都不可行。

`sandboxType=windowsRestrictedToken` 同时出现在两种内层模式响应中；它单独不足以
区分运行身份。elevated 的 whoami 补录提供了额外证据。unelevated 的新家和
“不执行 setup”证明本次未利用该家的 elevated 初始化材料，但本机历史 setup 的事实仍保留。

### arg0 / PATH 警告

外层启动时会出现清理 arg0、创建 PATH aliases 的 `os error 5`。只有外层的
诊断对照中也有相同警告，绝对路径 PowerShell、Set-Content 仍可运行。
因此不能把警告认定为全部失败的唯一原因；PATH 别名、apply_patch 等没有专门验证，
也不能声称警告对所有命令无影响。未修改外部 Codex 二进制或内部实现。

## 3. 可复现的方法

沿用 `scripts/probe-windows-exec-server.ps1`；新增的
`probe/probe_windows_process.mjs` 只负责协议和标记文件，不是另一套代理入口。
准备、入口及收尾见 [README-windows-probe.md](../README-windows-probe.md)。

```powershell
$env:PROBE_PROCESS_ONLY = '1'
$env:SANDBOX_MODE = 'unelevated'
$env:PROBE_OUTER_SANDBOX = '0' # 内层通过组；改为 1 是失败的嵌套组
# CODEX_NATIVE_EXE、EXEC_PORT、专用 L2_OUTSIDE_ROOT 按探针说明设置。
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-windows-exec-server.ps1
```

实际外层形状：

```text
codex.exe -c <临时 permission profile> -c windows.sandbox="unelevated"
  sandbox --permission-profile probe_outer -C <workspace>
  -- codex.exe exec-server --listen ws://127.0.0.1:<动态空闲端口>
```

profile 仅根只读、测试 workspace 与执行端家可写；network enabled 用于回环连接，
不声称外层具备网络硬隔离。已有 elevated 家通过命令行 profile 参与，不覆盖其配置。

直接执行器握手是 `initialize {clientName}` 后 `initialized` 通知。
反馈中的 `environment/add` 属于编排端 app-server；直接 exec-server 不发该方法。
真实 `process/start` 必含 `tty`、`env` 等字段；`sandbox.permissions` 为 managed，
filesystem restricted（root read、project_roots write）、network restricted，
cwd/workspaceRoots 为 Windows file URI。
`windowsSandboxLevel=restricted-token` 对应配置 `unelevated`；已有 elevated 组用 `elevated`。

早期四次尝试记录保留：配置模式字符串误当 wire 枚举、缺 env、缺 tty、受限 PowerShell
禁止任意 .NET `WriteAllText`。这些均不算沙箱通过；修正为完整协议及 `Set-Content`
后才形成表中的有效证据。elevated 嵌套首轮因 WebSocket 关闭未返回而停滞，精确核对
PID/路径后终止该探针客户端，由原 wrapper finally 清理其树；随后 helper 补上有界退出。

## 4. 本次代码处置

| 文件 | 处置 |
| --- | --- |
| `agent/src/pathuri.ts` | 显式区分 Windows/POSIX，规范化盘符和斜杠、Windows 比较不分大小写；明确目录边界；拒绝相对盘符、UNC/设备路径、ADS、控制字符、歧义尾点/空格等 |
| `agent/src/filter.ts` | 路径判断共用以上逻辑；可明确传入平台以在两个系统复测真实帧；不改会合点协议 |
| `agent/src/config.ts`、`cli.ts` | 白名单使用同一规范；roots 去重/删除不受 Windows 大小写影响；add 拒绝普通文件和缺失参数 |
| `agent/src/outerSandbox.ts` | Windows 准入失败时在 spawn 前明确拒绝；Linux bwrap 参数继续使用 POSIX 路径 |
| `agent/package.json` | Node 最低 20.13，使用 fileURLToPath 的显式 windows 选项；没有新增依赖，锁文件未变 |
| `agent/test/*` | 保留 Linux 语义回归；增加 Windows 真实帧、路径正反例、CLI 配置及拒绝启动测试；测试临时目录自行回收 |
| `probe/frames.jsonl` | 原空文件填入 43 条带来源路径的真实帧；initialize/initialized/dataBase64 与 Windows process 帧，不伪造抓包 |
| `scripts/probe-windows-exec-server.ps1` | 增加互斥 process 模式，沿用原入口、版本检查及 owned process tree 收尾；profile 改命令行覆盖 |
| `probe/probe_windows_process.mjs` | 无模型进程探针，普通用户可写对照、终态/内容/权限判定；有界超时，清理自身固定标记 |
| 两份 README、CHECKPOINT、`scripts/results/` | 更新使用限制、复现和本次停点；原证据不删改，结果只追加 |

路径判断仍是词法过滤，不宣称能够单独防 symlink/junction；需要 OS 外层配合。
Windows UNC 支持未纳入本次准入，不以猜测映射放行。

## 5. 机械检查及其范围

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Windows `build/typecheck/test` | 65 passed，5 文件 | `windows-tests-js.txt` |
| Windows 最终代码与测试副本 | 20 个输入文件 SHA256 一致 | `windows-source-match.json` |
| Linux `build/typecheck/test` | 64 passed、1 Windows 专用测试 skipped | `linux-final-tests.txt` |
| PowerShell AST 语法 | pass | `cleanup-windows.txt` |
| `node --check probe/probe_windows_process.mjs`、`git diff --check` | pass | 本次本地检查；汇总见 `local-checks.json` |
| Linux 原模型一机联调 | 未重跑 | 不以单元测试冒充其 pass；阶段 0 已记录模型认证 403，未尝试绕过限制 |
| 现网及网页“我的机器” | 未做 | Windows 准入阻塞；未消费临时替换授权 |

任务 AT 状态：AT-WA-01 未完成；02 仅内层原生探针及桥内规则测试通过，完整组合未通过；
03 仅规则/假会合点测试通过；04/05 只有既有模拟重连/拒绝测试，未完成本机真实网络中断或
现网吊销验收；06 留第 3 段；07 本次源码/结果无凭据命中，安装包未做；08 两系统单元和
类型检查通过，但原 Linux 模型联调未重跑，所以整项不标 pass。

Windows 开发工具首试 pnpm 12.0.0 原生入口报 `spawnSync ... pnpm-native.exe UNKNOWN`，
不是已证实的网络故障。换用官方 pnpm 10.24.0 JavaScript 入口，冻结安装相同锁文件
并通过全部测试；不用关闭 TLS、签名或完整性检查。Node 24.19.0 原生 Windows 执行，
不是 WSL 代跑。临时使用国内 npm 源直连，没有改用户全局 npm/代理设置。

## 6. 未完成项与下一步

1. **先解决双层组合。**请远程审以上最小复现，确认固定 0.155.1 的公开接口是否有
   能同时保留请求权限和本地硬边界的承载方式。当前只证实指定组合失败，不臆测底层根因。
2. 不建议把 `sandbox` 改成 null、禁用内层、仅留协议过滤或直接允许普通用户启动
   无外层执行器：这会改变既定安全模型，不能作为本次实现里的“修复”。
3. 若需换 Codex 版本，必须与沙箱编排端成对并重新跑探针；若需调整架构/会合点，
   超出本 runtime 任务，先由远程审定。本次未做跨仓变更或升级。
4. 组合验证通过后再补 init 的**实际能力探测**、配置生成、完整进程树生命周期及现网
   验收。本次只有探针的 tree cleanup 和 Windows start 拒绝检查，不能说产品已具备它们。
5. 任务给出的现网端口为 30471，而现有私有配置为 30443；真正联调前核对部署事实。
   所有者已允许临时替换再恢复；不要重复索取同一批准，但必须先确认原代理可恢复。
6. Windows 10、干净机器、安装器/托盘/开机启动仍按反馈留到第 3 段。

官方说明分别介绍 elevated/unelevated，不保证这里的嵌套组合；本报告以固定版实测为准：
[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)、
[Permissions](https://learn.chatgpt.com/docs/permissions)。

## 7. 清理与回滚

原始记录入仓后，按精确清单清理本轮 Windows 运行根目录、8 个新建无凭据执行端家、
11 个专用外部标记目录及两套 Windows 测试依赖副本；先确认探针端口和进程已退出。
结果以 `cleanup-windows.txt` 为准。保留原 `.codex`、`.codex-probe`、已 setup 的
`.codex-probe-exec`、原代理配置和正在运行的 Linux agent。没有安装新计划任务、服务或全局工具。

本地提交可整体审读；若撤销代码改动，回到基线即可恢复原 Linux 行为。
基线 Windows start 没有外层保护，**不能把回滚当成可上线的 Windows 修复**。
交付完整提交号在本地提交后提供给所有者，不 push，由所有者同步。
