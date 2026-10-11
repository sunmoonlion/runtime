# 0.2.7 取证：设置窗口点「连接我的账号」后整窗消失

工位 luna（实施者 Qwen），runtime 分支 luna。任务来源：k8s luna `59ae4914` 的 `luna-feedback.md`「0.2.6 审读」节，给 Qwen 的第一张活第 1 步（取证）。
规矩：证据先于猜测；不手改生产库；不 `Stop-Process` 杀进程；不用界面自动化替所有者点按钮。

被复现对象：所有者机器现装 **0.2.6**，安装目录 `C:\Users\zymun\AppData\Local\Programs\sunmoon-agent`，其 `app\native\desktop.ps1` 含 `add_OutputDataReceived`（`grep -c` = 1），即 fable 判定的崩因那份。
`SUNMOON_AGENT_HOME` = `C:\Users\zymun\.sunmoon-agent`；`site\site.json`：web_origin `https://investment.sunmoonai.com:30443`、relay `wss://relay.sunmoonai.com:30443`、bundled-ca。

---

## 取证 a：Windows 事件查看器（从 WSL 调 `powershell.exe Get-WinEvent` 只读取）

### a-1 Application 日志 1000/1026（近 3 天，过滤 powershell/.NET）

命令：
```
Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000,1026; StartTime=(Get-Date).AddDays(-3)} |
  Where-Object { $_.Message -match 'powershell' -or $_.ProviderName -match '\.NET' } |
  Select-Object TimeCreated,Id,ProviderName
```
输出：
```
TimeCreated           Id ProviderName
2026-10-10 15:43:51 1000 .NET Runtime
2026-10-10 15:43:50 1000 .NET Runtime
2026-10-10 10:11:21 1000 .NET Runtime
2026-10-10 10:11:21 1000 .NET Runtime
```
均为 **10/10**，早于今天窗口测试时刻（约 11:16–11:45），对不上。

### a-2 今天(10/11)全部 1000/1026

```
TimeCreated           Id ProviderName
2026-10-11 11:06:59 1000 CodexSandboxService.OpenAI.Codex
2026-10-11 7:27:59  1000 Application Error
```
11:06:59 是 Codex 沙箱服务（代理 exec-server 侧，与设置窗口无关）；7:27 早于窗口测试。**没有 powershell.exe 的 1000/1026。**

### a-3 近 3 天含 `Runspace`/`powershell` 的 1000/1026 完整报文

命令用 `Where-Object { $_.Message -match 'Runspace|powershell' }` 输出全文 → **返回空**。
即事件日志里**没有** `There is no Runspace available to run scripts in this thread` 的记录。

### a-4 今天 11:00 后 Application 里 PowerShell/.NET/WER/Error 相关

```
TimeCreated           Id ProviderName
2026-10-11 11:39:27 1022 .NET Runtime
2026-10-11 11:33:14 1022 .NET Runtime
2026-10-11 11:29:48 1022 .NET Runtime
2026-10-11 11:08:54 1001 Windows Error Reporting
2026-10-11 11:08:28 1022 .NET Runtime
2026-10-11 11:07:16 1022 .NET Runtime
2026-10-11 11:07:15 1001 Windows Error Reporting
2026-10-11 11:06:19 1022 .NET Runtime
2026-10-11 11:06:13 1001 Windows Error Reporting
```
- `.NET Runtime 1022`（信息级）全文：`初始化 COM+ API 基础结构时出错，HRESULT: 0x80004005`，进程 ID 8924/12040 —— COM+ 初始化提示，非崩溃、非 powershell 专属。
- `WER 1001` 全是 `StoreAgentScanForUpdatesFailure0`（Windows 商店更新扫描失败，`P1: Update; P2: 8024001e`），与代理无关。

### a-5 PowerShell Operational 日志（今天错误级 + 含关键字全文）

- Level 1/2/3 今天只有 `4104`（脚本块日志，信息级）若干，**无 4103 错误级、无引擎终止崩溃**。
- 含 `Runspace|onboard|desktop|pair` 全文匹配 → 命中的全是 **4103 信息级 CommandInvocation**，时间 11:12–11:13，内容：
  ```
  CommandInvocation(Add-Type): "Add-Type"
  ParameterBinding(Add-Type): 参数="AssemblyName" 值="System.Drawing" / "System.Windows.Forms"
  主机版本 = 5.1.26100.9444；主机应用 = C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
    -NoLogo -NoProfile -NonInteractive -File C:\Users\zymun\AppData\Loc…（sunmoon-agent 的 desktop.ps1）
  ```
  → 证明 **11:12–11:13 确有一个前台/隐藏 powershell.exe 在跑安装目录的 desktop.ps1，并成功执行到 `Add-Type System.Windows.Forms`（画窗口那步）**；但日志里没有紧随其后的未处理异常/引擎终止记录。

### a-6 状态文件时间戳（对齐窗口时刻）

```
status.json  2026-10-11 11:46:52  （代理仍在写、connected）
tray.json    2026-10-11 11:07:14
config.json  2026-10-11 10:49:12
```

### 取证 a 结论

1. **事件日志里没有 powershell.exe 的崩溃记录（Application Error 1000 / .NET Runtime 1026），也没有 `There is no Runspace available` 明文。** fable 假设的「Runspace 崩溃」在系统事件层面**查无直接证据**。
2. PowerShell Operational 4103 证明窗口进程确实在跑 desktop.ps1 并执行到 WinForms 加载；但没有对应的错误级/引擎终止事件。
3. 据此**支持所有者的判断**：窗口很可能是 **脚本内抛错后有序退出**（`$ErrorActionPreference='Stop'` + `finally` 关窗），而非进程崩溃——这类 terminating error 的出错行**只在前台控制台的 stderr 能看到，不进事件日志**。
4. 因此 fable 定的改法（去 `add_OutputDataReceived` 脚本块回调、改文件轮询；并把 Timer/Click 包 try/catch 不让窗口退）**依然成立且必要**——它同时消除「后台线程脚本块无 runspace」与「UI 回调抛错导致整窗退出」两条路径。改法不依赖本取证结论（fable 原话「不管取证结果如何都要改成这样」）。

**下一步：取证 b（前台复现看出错行）——见下节，需所有者点按钮，待补原文。**

---

## 取证 b：前台复现 + 最小复现 + 对照实验（根因确证）

### b-1 前台跑真实 `desktop.ps1 -Action onboard`（所有者执行，14:02）

方式：包装脚本 `C:\Users\zymun\sunmoon-probe-runs\run-onboard-foreground.ps1`，用 `Start-Process -RedirectStandardInput`（机制已单独验证：`[Console]::In.ReadToEnd()` 能读到重定向文件内容）把 `{node,cli,state}` 喂进 desktop.ps1 进程 stdin，stdout/stderr 分别重定向到文件，`-NoNewWindow -PassThru` + `WaitForExit`。

结果（三文件核对）：
```
onboard-stdin-…140248.json   214 字节，内容正确（cli/node/state 三路径）
onboard-stdout-…140248.txt     0 字节（空）
onboard-stderr-…140248.txt     0 字节（空）
包装脚本打印：ExitCode=（空）
```
状态目录 `C:\Users\zymun\.sunmoon-agent\`：
```
onboard-ready.json   14:02   ← 由 Show-Onboard 第 310 行写；正常退出时第 311 行 finally 会删
status.json          14:04
```
**关键：`onboard-ready.json` 生成后没被删除** → Show-Onboard 没走到 `finally`（第 311 行）→ 窗口进程**非正常退出**。stderr 空、`ExitCode` 取不到，均与「进程被后台线程未处理异常快速有序终止」一致。

> 注：正式路径 `runDesktopScript`（resident.ts:141）本就 `stdio:["pipe","ignore","ignore"]`——stderr 被丢弃，所以日常使用时红字从来无人接收。

### b-2 最小复现（Qwen 在 WSL 侧自跑，无需点按钮、不产生配对码）

`repro-outputdatareceived.ps1`：起一个输出 3 行（间隔 60ms）的子进程，**挂 `add_OutputDataReceived` / `add_ErrorDataReceived` 脚本块** + `BeginOutputReadLine`，主线程 `WaitForExit` 后打印 `count=` 与 `SURVIVED-TO-END`。
```
（输出完全为空）
----- wrapper-exit=2 -----
```
进程 **exit 2 终止**，`count=`、`SURVIVED-TO-END` 均未打印 → 主线程被后台输出事件的未处理异常连带终止；stderr 无任何明文。

### b-3 对照实验（唯一变量：是否挂脚本块回调）

`repro-control.ps1`：同一子进程、同样重定向，**不挂事件脚本块**，改用 `Invoke-Agent` 的 `StandardOutput.ReadToEnd()`：
```
CONTROL read=[l1 l2 l3] exit=0
SURVIVED-TO-END
----- control-exit=0 -----
```
正常读到全部输出、进程活到结尾、exit 0。

### 取证 b 结论（根因确证）

1. **根因 = `Show-Onboard` 给 `pair` 子进程挂的 `add_OutputDataReceived` / `add_ErrorDataReceived` 脚本块回调**（desktop.ps1:269-272）。.NET 的输出事件在**线程池线程**触发，该线程**没有 PowerShell runspace**；Windows PowerShell 5.1 在此线程执行脚本块会抛未处理异常，引擎随即以 **exit 2 有序终止**整个进程。
2. **对照实验锁定唯一变量**：挂脚本块 → exit 2 秒退、主线程未达结尾；换 `ReadToEnd`（不挂脚本块）→ exit 0、读到全部输出。一崩一活。
3. **「有序终止（exit 2）而非崩溃」解释了取证 a 的全部反常**：不进 Application Error 1000 / .NET Runtime 1026、不进 WER、stderr 无明文、`ExitCode` 取不到、`finally` 未执行（`onboard-ready.json` 残留）。也证实所有者判断「脚本抛错后有序退出」。
4. `There is no Runspace available to run scripts in this thread` 的**明文未捕获**——进程终止过快、引擎未把该后台异常写到重定向的 stderr（b-1/b-2 两处 stderr 均 0 字节）。但 b-2/b-3 的行为对照已充分确证根因，明文缺失不影响结论。
5. **改法方向确证有效**：去掉脚本块回调、改文件轮询（pair 原子写 `pair-status.json`，Timer 在 UI 线程读）根除本坑；`ReadToEnd` 对照证明「不用脚本块回调」即可安全承载子进程输出。复现脚本留存于 `C:\Users\zymun\sunmoon-probe-runs\repro-*.ps1`。

exit=0
