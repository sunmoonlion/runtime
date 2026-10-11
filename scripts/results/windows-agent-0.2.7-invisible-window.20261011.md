# SunMoon 本地代理 0.2.7：设置窗口不可见取证

日期：2026-10-11，Asia/Shanghai。调查范围：Windows 本机；未部署集群、未修改产品源码或安装文件。
安装目录：`C:\Users\zymun\AppData\Local\Programs\sunmoon-agent`。
runtime 源码：`d90cef3e9114c6a336758ceb9b8e3a46b9872e27`。
已安装 desktop.ps1 与此提交的仓库文件 SHA256 一致：
`D14B7F9AA09C4011182082FA2AFBC9C68FC507DC3369C9238A034F1871FCA2A6`。

## 结论与证据边界

**本次 0.2.7 的“窗口已建但看不见”，证据支持假设 1：PowerShell 的隐藏启动选项压住了 WinForms 的显示。**

1. 原来三个进程确实各有一个设置窗口：标题、句柄、700×480 尺寸都正常；全部 `IsWindowVisible=false`，`IsIconic=false`，位置在屏幕内。不是“没有创建窗口”，也不是最小化或窗口跑到屏幕外。
2. 同一份已安装脚本直接从可见交互控制台运行，窗口出现。所有者确认连接码、倒计时、自动打开浏览器、窗口持续显示均正常，控制台无红字；脚本最后正常返回 exit=0。
3. Node spawn 对照使用相同 executable、参数和 stdin 结构，均为全新空诊断状态，仅 windowsHide 开关不同（为避免状态互相覆盖，各组状态路径分别命名）。true → 窗口隐藏；false → 窗口可见。所有者确认对照中的最小化为手动操作。
4. 本次没有证据支持假设 2 为现有问题的原因：Show-Onboard 没有隐藏整个 Form 的代码；Form.Dispose 只在 ShowDialog 返回后的 finally；直接开窗并完成配对观察正常。不能据此排除所有可能的历史异常，更不能把上午 0.2.6 的“先出现再消失”直接归成同一原因。

**精度限制：**没有向原进程注入代码，也没有读取其 STARTUPINFO；具体 `wShowWindow=SW_HIDE` 是对启动选项、对照结果和 Win32 显示规则的机制推断，不是从原进程逐字段读出的事实。未单独隔离测定上游 VBS/Start-Process 的贡献。Node 这一层的 `windowsHide=true` 已能独立复现。

## 操作边界与实验隔离

- 没有 Stop-Process、taskkill、TerminateProcess、WM_CLOSE 或其它主动结束进程的操作。
- 没有修改、删除安装目录或真实 `C:\Users\zymun\.sunmoon-agent` 中的任何文件；没有读取或输出 config.json。
- 原命令直接执行 Show-Onboard 会写真实状态目录的 onboard-ready.json，点连接还会修改 pair-status.json。因此实际对照仍调用**原安装脚本**，但把 stdin 的 state 改成回执目录下的独立诊断目录。
- 直接开窗用 `direct-state`；Node true/false 用 `spawn-hidden-state` 和 `spawn-normal-state`。其余 node、cli、instance 字段沿用题给值。instance 在 onboard 分支中不用于注册任务。
- 用户后来确认浏览器批准了诊断配对；只读状态摘要看到 approved。诊断配置落在 direct-state，不是原 .sunmoon-agent。**direct-state 中的配置含诊断凭据，不属于可转发证据；请只转本报告和不含凭据的证据文件。**
- 没有点击完成、安装自启或启动新的诊断 resident 的自动化操作。
- 最后取样发现原六个窗口相关进程及对照进程均已不存在；助手没有终止它们，退出原因未逐个追踪，不能给原六个进程填写退出码。

## 1. 原三个 PowerShell 的所有顶层窗口

方法：P/Invoke EnumWindows；对每个 HWND 调 GetWindowThreadProcessId，筛 PID 4392、9252、40428，再读取 GetWindowText/GetClassName/IsWindowVisible/GetWindowRect/IsIconic。没有使用只返回可见主窗口的 MainWindowTitle 作为窗口存在的判据。

首次成功现场枚举：2026-10-11T22:34:20.4305604+08:00。

**2026-10-11 审读补正：** 之前生成报告时错把后一次采样当成首次证据。22:37:52 的 `initial-inspection.json` 中三个 PID 确实已不存在，表格因此为空；它不能支持“枚举到原窗口”。下面改为本会话首次成功工具调用的原始输出摘录（工具块 chunk `805721`，探针 PID 42532），不是重新运行、不是从后一次 JSON 推算。摘录保留三个进程及其 Form 字段；原输出还含 GDI+、IME、.NET 辅助窗口，下文不把辅助窗口算作设置窗口。

```json
{
  "time": "2026-10-11T22:34:20.4305604+08:00",
  "probe_pid": 42532,
  "probe_session": 1,
  "enum_ok": true,
  "processes": [
    {
      "pid": 4392,
      "name": "powershell",
      "started": "2026-10-11T22:14:06.4994944+08:00",
      "session": 1,
      "main_title": "",
      "main_handle": "0x0",
      "responding": true
    },
    {
      "pid": 9252,
      "name": "powershell",
      "started": "2026-10-11T22:14:53.6923333+08:00",
      "session": 1,
      "main_title": "",
      "main_handle": "0x0",
      "responding": true
    },
    {
      "pid": 40428,
      "name": "powershell",
      "started": "2026-10-11T22:21:08.4491746+08:00",
      "session": 1,
      "main_title": "",
      "main_handle": "0x0",
      "responding": true
    }
  ],
  "windows": [
    {
      "pid": 40428,
      "thread": 33448,
      "handle": "0x40400",
      "title": "SunMoon - 设置",
      "class": "WindowsForms10.Window.8.app.0.263c721_r8_ad1",
      "visible": false,
      "iconic": false,
      "rect_ok": true,
      "rect": {
        "left": 290,
        "right": 990,
        "bottom": 616,
        "top": 136
      }
    },
    {
      "pid": 9252,
      "thread": 42072,
      "handle": "0x4092E",
      "title": "SunMoon - 设置",
      "class": "WindowsForms10.Window.8.app.0.25e08d1_r8_ad1",
      "visible": false,
      "iconic": false,
      "rect_ok": true,
      "rect": {
        "left": 290,
        "right": 990,
        "bottom": 616,
        "top": 136
      }
    },
    {
      "pid": 4392,
      "thread": 42080,
      "handle": "0x8090C",
      "title": "SunMoon - 设置",
      "class": "WindowsForms10.Window.8.app.0.25e08d1_r8_ad1",
      "visible": false,
      "iconic": false,
      "rect_ok": true,
      "rect": {
        "left": 290,
        "right": 990,
        "bottom": 616,
        "top": 136
      }
    }
  ]
}
```

三个 Form 均为 700×480、位置 (290,136)，visible=false、iconic=false；探针与目标均在 Session 1。证据来源是首次工具输出，独立存盘的 `initial-inspection.json` 是**另一时刻**的进程已结束快照，两者不再混用。

后一次快照原文：

```json
{"time":"2026-10-11T22:37:52.0992684+08:00","processes":[{"pid":4392,"exists":false},{"pid":9252,"exists":false},{"pid":40428,"exists":false}],"windows":[]}
```

判断：首次工具输出支持原三个窗口隐藏；第 3 节独立对照仍是根因的主要证据。MainWindowTitle 为空、MainWindowHandle=0 不能证明“没有窗口”。

## 2. 交互控制台直接开窗

开始：2026-10-11T22:37:52.9873153+08:00。
可见控制台 PID 9880；实际运行 desktop.ps1 的 PowerShell PID 5588。

实际 JSON（只有 state 使用隔离路径）：

```json
{
  "node": "C:\\Users\\zymun\\AppData\\Local\\Programs\\sunmoon-agent\\node\\node.exe",
  "cli": "C:\\Users\\zymun\\AppData\\Local\\Programs\\sunmoon-agent\\app\\dist\\cli.js",
  "state": "C:\\Users\\zymun\\sunmoon-probe-runs\\windows-agent-027\\direct-state",
  "instance": "5b4377b497ee820ab8d076cf"
}
```

核心调用：

```powershell
$Body | & powershell.exe -NoLogo -NoProfile -File 'C:\Users\zymun\AppData\Local\Programs\sunmoon-agent\app\native\desktop.ps1' -Action onboard
```

外层控制台以 Start-Process -WindowStyle Normal 打开，未给内层 -NonInteractive 或隐藏开关。
完整包装脚本：`sunmoon-direct-window.ps1`；控制台全文：`direct-console.txt`。

所有者原文：

> 打开了，可见

对“直接与新窗口是否手动最小化、诊断配对是否在浏览器批准”的合并询问：

> 是

对“8 位码、倒计时、自动打开浏览器、窗口持续显示四项是否正常；控制台有无红字”的单独确认：

> 四项都正常，控制台无红字

只读配对结果摘要（不含连接码、账号、凭据）：

```json
{"event":"result","status":"approved","seq":2,"message":null}
```

2026-10-11T22:39:13.9167176+08:00 的窗口枚举：

| PID | HWND | 标题 | 窗口类 | IsWindowVisible | IsIconic | GetWindowRect (L,T,R,B) |
| --- | --- | --- | --- | --- | --- | --- |
| 5588 | 0x1D04A6 | SunMoon - 设置 | WindowsForms10.Window.8.app.0.25e08d1_r8_ad1 | true | true | (-32000,-32000,-31686,-31950) |

此处 iconic=true、坐标 -32000 是取样时窗口已由用户最小化，不是最初的隐藏症状。

控制台原文全文：

```text
**********************
Windows PowerShell 脚本开始
开始时间: 20261011223752
用户名: ZYMUN\zymun
RunAs 用户: ZYMUN\zymun
配置名称: 
计算机: ZYMUN (Microsoft Windows NT 10.0.26200.0)
主机应用程序: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NoExit -File C:\Users\zymun\sunmoon-probe-runs\windows-agent-027\sunmoon-direct-window.ps1
进程 ID: 9880
PSVersion: 5.1.26100.9444
PSEdition: Desktop
PSCompatibleVersions: 1.0, 2.0, 3.0, 4.0, 5.0, 5.1.26100.9444
BuildVersion: 10.0.26100.9444
CLRVersion: 4.0.30319.42000
WSManStackVersion: 3.0
PSRemotingProtocolVersion: 2.3
SerializationVersion: 1.1.0.1
**********************
Direct interactive probe started 2026-10-11T22:37:52.9873153+08:00; console pid=9880
Diagnostic state only. Click Connect to observe code/timer/browser. Do NOT approve in browser or finish setup.

Desktop returned exit=0 at 2026-10-11T22:41:18.8799821+08:00
**********************
Windows PowerShell 脚本结束
结束时间: 20261011224118
**********************
```

判断：原安装脚本能显示、完成本次连接交互且正常返回；本次路径没有复现假设 2。尝试补采控件倒计时读数时，窗口已关闭、onboard-ready.json 正常删除，所以没有自动采到两次计数值；功能结论来自所有者现场观察，没有写成自动采样通过。

## 3. Node spawn：只改隐藏开关

开始：两组均在 2026-10-11T22:39:44+08:00。同一已安装 node.exe、同一个探针 JS，父 Node 都以正常显示状态启动。没有改桌面脚本。

共同参数：

```javascript
spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
  '-NoLogo', '-NoProfile', '-NonInteractive',
  '-File', 'C:\\Users\\zymun\\AppData\\Local\\Programs\\sunmoon-agent\\app\\native\\desktop.ps1',
  '-Action', 'onboard'
], {
  windowsHide: mode === 'hidden',
  stdio: ['pipe', 'ignore', 'ignore']
});
child.stdin.end(JSON.stringify(body));
```

stdin 两组均与第 2 项相同结构和固定字段，只是 state 分别使用两个空目录；这项隔离差异已明示，不冒充逐字节相同 JSON。没有给两组点击连接或自动改变 Form 状态。

| 分组 | Node PID | PowerShell PID | windowsHide | Form 可见 | 最小化 |
| --- | --- | --- | --- | --- | --- |
| hidden | 38920 | 43248 | true | false | false |
| normal | 42232 | 37636 | false | true | true（所有者确认手动最小化） |

2026-10-11T22:40:06.0243417+08:00 的 Form 原文数据：

```json
[
  {
    "pid": 37636,
    "thread": 13336,
    "handle": "0x490222",
    "title": "SunMoon - 设置",
    "class": "WindowsForms10.Window.8.app.0.263c721_r13_ad1",
    "visible": true,
    "iconic": true,
    "rect_ok": true,
    "rect": {
      "left": -32000,
      "right": -31686,
      "bottom": -31950,
      "top": -32000
    }
  },
  {
    "pid": 43248,
    "thread": 44956,
    "handle": "0x1B0A16",
    "title": "SunMoon - 设置",
    "class": "WindowsForms10.Window.8.app.0.25e08d1_r8_ad1",
    "visible": false,
    "iconic": false,
    "rect_ok": true,
    "rect": {
      "left": 290,
      "right": 990,
      "bottom": 616,
      "top": 136
    }
  }
]
```

全部辅助窗口在 `spawn-window-inspection.json`；启动命令、stdin、PID 在 `spawn-hidden.json`、`spawn-normal.json`。脚本 `sunmoon-spawn-window.mjs` 可审读。
normal 组原文退出记录：

```json
{
  "time": "2026-10-11T14:41:18.071Z",
  "code": 0,
  "signal": null
}
```

hidden 组没有捕获退出记录；最后进程已不存在。没有据此推断崩溃。
stdio 的 ignore 与产品保持一致，所以这一组不能提供 console stderr；控制台红字检查由第 2 项承担。

判断：Node 的 windowsHide 开关与本次可见性变化建立了直接对照，支持假设 1。

## 4. Application 事件与代理日志

查询：

```powershell
Get-WinEvent -FilterHashtable @{
  LogName='Application'
  StartTime=[datetime]'2026-10-11T22:10:00'
} | Where-Object {
  $_.ProviderName -match 'PowerShell|\.NET Runtime|Application Error'
}
```

实际使用当日日期构造 22:10，时区 +08:00。初次与 2026-10-11T22:43:15.2890693+08:00 的复查均成功，筛选结果原文：

```json
"event_start": "2026-10-11T22:10:00.0000000+08:00",
"events": []
```

这仅说明指定日志、时间和 provider 条件下没有匹配条目；不证明不存在被捕获的脚本异常。GUI 子进程 stdout/stderr 被产品忽略，是取证盲区。

最新日志：`C:\Users\zymun\AppData\Local\sunmoon-agent\logs\agent.log`。
最后写入：2026-10-11T22:39:02.8656741+08:00。
读取时明确 -Encoding UTF8，输出前过滤 bearer/JWT/敏感字段和凭据 URL；最终下面 50 行未检出 token/device_secret/password/authorization 等敏感字段或 JWT，无需删掉任何秘密值。

```text
{"t":"2026-10-11T02:59:29.770Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.772Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.774Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.776Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.782Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.876Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.880Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.883Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.912Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.915Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.919Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.978Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.980Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:29.981Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:30.040Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:30.041Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T02:59:30.042Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T03:03:49.826Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T03:03:49.828Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T03:03:49.831Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T03:03:49.850Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T03:03:49.852Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T03:03:49.854Z","level":"warn","msg":"denied by local ceiling","method":"fs/getMetadata","reason":"filesystem path outside the whitelisted roots"}
{"t":"2026-10-11T03:07:01.922Z","level":"info","msg":"sunmoon-agent starting","version":"0.2.6","machine":"zymun","codex":"0.155.1","codexBin":"C:\\Users\\zymun\\AppData\\Local\\Programs\\sunmoon-agent\\app\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe","bwrap":null,"platform":"win32"}
{"t":"2026-10-11T03:07:03.741Z","level":"info","msg":"Windows inner sandbox and strict protocol filter; no OS outer sandbox","mode":"unelevated"}
{"t":"2026-10-11T03:07:03.882Z","level":"info","msg":"exec-server starting","port":49696,"sandboxed":false,"roots":["C:\\Users\\zymun\\Desktop"],"generation":1}
{"t":"2026-10-11T03:07:16.741Z","level":"info","msg":"exec-server ready","url":"ws://127.0.0.1:49696/","generation":1}
{"t":"2026-10-11T03:07:19.027Z","level":"info","msg":"status endpoint","url":"http://127.0.0.1:65317/"}
{"t":"2026-10-11T03:07:19.030Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":1000}
{"t":"2026-10-11T03:07:20.055Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":2000}
{"t":"2026-10-11T03:07:22.240Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":4000}
{"t":"2026-10-11T03:07:26.281Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":8000}
{"t":"2026-10-11T03:07:34.294Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":16000}
{"t":"2026-10-11T03:07:50.307Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":30000}
{"t":"2026-10-11T03:08:20.322Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":30000}
{"t":"2026-10-11T03:08:50.336Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":30000}
{"t":"2026-10-11T03:09:20.342Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":30000}
{"t":"2026-10-11T03:09:50.355Z","level":"warn","msg":"relay control down, will retry","why":"ECONNREFUSED: 连不上 relay.sunmoonai.com。检查网络或代理设置。","inMs":30000}
{"t":"2026-10-11T03:11:28.664Z","level":"info","msg":"relay connected"}
{"t":"2026-10-11T13:59:13.806Z","level":"info","msg":"shutting down","why":"SIGINT","exitCode":0}
{"t":"2026-10-11T13:59:14.217Z","level":"info","msg":"exec-server exited","code":1,"signal":null,"generation":1}
{"t":"2026-10-11T14:11:34.626Z","level":"info","msg":"sunmoon-agent starting","version":"0.2.7","machine":"zymun","codex":"0.155.1","codexBin":"C:\\Users\\zymun\\AppData\\Local\\Programs\\sunmoon-agent\\app\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe","bwrap":null,"platform":"win32"}
{"t":"2026-10-11T14:11:35.766Z","level":"info","msg":"Windows inner sandbox and strict protocol filter; no OS outer sandbox","mode":"unelevated"}
{"t":"2026-10-11T14:11:35.778Z","level":"info","msg":"exec-server starting","port":58484,"sandboxed":false,"roots":["C:\\Users\\zymun\\Desktop"],"generation":1}
{"t":"2026-10-11T14:11:37.505Z","level":"info","msg":"exec-server ready","url":"ws://127.0.0.1:58484/","generation":1}
{"t":"2026-10-11T14:11:37.652Z","level":"info","msg":"status endpoint","url":"http://127.0.0.1:58646/"}
{"t":"2026-10-11T14:11:37.674Z","level":"info","msg":"relay connected"}
{"t":"2026-10-11T14:39:02.361Z","level":"error","msg":"4003: 这台电脑的连接已失效，请点『重新连接账号』。","code":4003}
{"t":"2026-10-11T14:39:02.362Z","level":"error","msg":"shutting down","why":"relay rejected: 4003: 这台电脑的连接已失效，请点『重新连接账号』。","exitCode":3}
{"t":"2026-10-11T14:39:02.866Z","level":"info","msg":"exec-server exited","code":1,"signal":null,"generation":1}
```

判断：日志证实 22:11 的 0.2.7 后台启动并连接 relay。白天的权限拒绝、连接重试不属于今晚设置窗口隐藏证据；后台在线与 GUI 可见性是不同状态。

## 5. 0.2.6 与 0.2.7 的 Show-Onboard 之外差异

题给旧残目录查询原文：

```json
{"path":"C:\\Users\\zymun\\AppData\\Local\\Programs\\sunmoon-agent.broken-20261011\\app\\native\\desktop.ps1","exists":false}
```

所以不能完成**两个实际安装文件**的对比，不能把 Git 对照冒充旧残目录现场文件。

补充参考采用 Git 中 package.json version=0.2.6 的提交：
`08f8f9dfb20b79b5483dc324a30c6fc9a9fefee6`。
只读取其 desktop.ps1，另存 `reference-026-desktop.ps1`；没有执行该旧脚本。差异全文在 `desktop-026-027.diff`。
对比时使用 PowerShell AST 提取 Show-Onboard 函数的起止偏移，移除该函数后逐字符比较其余文本（不忽略空白）。

原文结果：

```json
{
  "installed_sha256": "D14B7F9AA09C4011182082FA2AFBC9C68FC507DC3369C9238A034F1871FCA2A6",
  "original_broken_file_exists": false,
  "reference_outside_sha256": "A1A525F1BB735AD2BF298F520F33B083926A100863DD6062A203668F0E3B791E",
  "reference_version": "0.2.6",
  "time": "2026-10-11T22:43:15.0127683+08:00",
  "reference_sha256": "8E67B5B94A3084846131747847E7E8B56A407D3F2964D4011E2D7879982EA127",
  "reference_commit": "08f8f9dfb20b79b5483dc324a30c6fc9a9fefee6",
  "current_outside_sha256": "A1A525F1BB735AD2BF298F520F33B083926A100863DD6062A203668F0E3B791E",
  "outside_onboard_exact_equal": true
}
```

**Show-Onboard 之外差异：无。**
函数内变化为子进程 stdout/stderr 回调改成 pair-status.json 轮询、pid/seq 校验、绝对到期时刻计算、Timer/Click try/catch。原来的 ShowDialog、finally 清理、托盘隐藏启动链仍在。

静态核对：
- Show-Step 改的是子控件 Visible，不是 Form.Visible。
- Show-Onboard 中没有 Form.Hide、Form.Visible=false 或主动 Form.Close。
- Form.Dispose 在 ShowDialog 的 finally 中；当前窗口 HWND 存在时，不能把该 Dispose 当作已发生。
- 没有显式 Form.Shown 后重新显示窗口的补救。
- onboard-ready.json 写在 ShowDialog **之前**。其存在本身不能证明窗口可见，也不能单独证明 UI 初始化完成；此次窗口是否存在以 EnumWindows 为准。

## 6. 最小修法建议（仅建议，未实施）

### 候选 A：只调整 onboard 的 PowerShell 启动

在 resident.ts 的 runDesktopScript，onboard 分支不使用 windowsHide=true，例如：

```typescript
windowsHide: action !== "onboard"
```

参数、stdin、配对协议、配置持久化均保持原机制。本次对照已证明在正常父 Node 下 false 可以显示窗口。
**仍须补验实际三层隐藏启动链**，并观察是否闪出 PowerShell 控制台；本次未声称这行改法已经完成整链回归。

### 候选 B：保留无控制台启动，由 Form 明确显示

在 Show-Onboard 的 Shown 事件中显式调用 Win32 ShowWindow(Form.Handle, SW_SHOW=5)，再 Activate；只影响该设置窗口，不去显示后台控制台。若需要通过 BeginInvoke 放到 UI 消息循环，则在候选包上确认事件触发和可见性。

这项没有在安装目录修改或试跑；作为可审读替代方案，不写成验证通过。不要直接调用原隐形窗口的 ShowWindow 来掩盖缺陷后宣布新代码已修复。

机制参考：微软说明首次 ShowWindow 的显示请求可能使用启动者提供的 STARTUPINFO 值；Node 文档说明 windowsHide 用于隐藏 Windows 子进程控制台。两者解释本次现象，但实际因果以第 3 项对照为主。
[Microsoft ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)，[Node child_process](https://nodejs.org/api/child_process.html)。

### 修复后的验收建议

1. 用打包版本从托盘实际点重新连接账号，EnumWindows 必须找到 visible=true 的 Form，所有者能看见；不是只查 ready 标记。
2. 连接码、倒计时、浏览器跳转、批准后继续步骤以及取消都检查，确认窗口持续存在且未留下隐藏副本。
3. 窗口关闭后核对正常退出与标记清理；后台在线不被误当作窗口验收通过。
4. 同时观察控制台是否闪出。若采用 Shown，确认应用控制允许对应 P/Invoke；这次只读 P/Invoke 已能运行，但没有因此宣称候选显示补丁已验过。

## 7. 收尾现场与证据清单

2026-10-11T22:43:15.2890693+08:00 最后只读检查，以下 PID 均不存在：
`4392,9252,40428,10000,45032,24176,9880,5588,38920,43248,42232,37636`。
助手未执行进程终止命令。安装脚本最终摘要仍与初次相同。
runtime 工作区未改动，没有产品代码提交。

可转交：
- `invisible-window.md`：本报告。
- `initial-inspection.json`：原三进程全部顶层窗口、事件、脱敏日志。
- `direct-console.txt`、`direct-window-inspection.json`：直接开窗记录。
- `spawn-window-inspection.json`、`spawn-launches.json`、`spawn-hidden.json`、`spawn-normal.json`、`spawn-normal-exit.json`：对照记录。
- `desktop-comparison.json`、`desktop-026-027.diff`：Git 参考比较。
- `final-inspection.json`：最终进程、事件与脱敏日志快照。
- 探针脚本保存在本目录，仅供复核。状态目录不作为证据发送。

执行过程说明：WSL 沙箱内第一次 Windows 调用报 `UtilBindVsockAnyPort:309: socket failed 1`，经授权后调用正常；从 UNC 直接执行探针被现有 PowerShell 执行策略以 UnauthorizedAccess 拒绝，改为复制到指定本地诊断目录再执行。没有修改 ExecutionPolicy、Windows 安全设置或安装文件。
