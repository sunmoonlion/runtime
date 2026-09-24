# Windows exec-server 探针

在 Windows 原生 Git 检出中运行 `probe-windows-exec-server.ps1`。需要 Node 20+、
Python 3.10+ 和 Codex CLI **0.155.1**。`ORCH_HOME` 指向已登录的独立测试目录；
执行端使用 `%USERPROFILE%\.codex-probe-exec`，不复制登录态。

首次使用时，在 **Windows 管理员 PowerShell** 中为两个测试目录初始化官方沙箱：

```powershell
foreach ($probeName in @('.codex-probe', '.codex-probe-exec')) {
    $env:CODEX_HOME = Join-Path $env:USERPROFILE $probeName
    codex sandbox setup --elevated --current-user
    if ($LASTEXITCODE -ne 0) { throw "沙箱初始化失败：$probeName" }
}
```

初始化会设置 Windows 沙箱账号、权限和防火墙，并在对应配置中启用
`windows.sandbox = "elevated"`。只有安装与登录、没有初始化沙箱时，
`approvalPolicy=never` 下的写操作可能在编排端直接被策略拒绝，不能据此证明执行端的文件边界。
参见 [OpenAI Windows 沙箱说明](https://learn.chatgpt.com/docs/windows/windows-sandbox)。

之后在普通 PowerShell 的 runtime 目录执行：

```powershell
$env:ORCH_HOME = Join-Path $env:USERPROFILE '.codex-probe'
# 默认 47001。若已被 Cursor 转发等程序占用，明确指定空闲端口，结果中记录差异。
$env:EXEC_PORT = '47011'
New-Item -ItemType Directory -Force scripts\results | Out-Null
$out = "scripts\results\probe-windows-exec-server.$(Get-Date -Format yyyyMMdd-HHmmss).txt"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-windows-exec-server.ps1 *> $out
$probeExit = $LASTEXITCODE
Add-Content -Path $out -Value "exit=$probeExit"
```

脚本解析 npm 包声明的 `bin.codex`，通过 Node 启动 exec-server 和 app-server；
不直接把 `.ps1` / `.cmd` 包装器当作 Windows 原生进程启动。
`.ps1` 保存为带 BOM 的 UTF-8，兼容 Windows PowerShell 5.1。

判据保持原待办的 L2 / L3 定义：两项 `True` 且 Python 正常退出为 `pass`；
执行端明确报告无法实施沙箱为 `fail`；证据不完整为 `undecidable`。
脚本分别以 `0`、`1`、`2` 退出，exec-server 未监听时以 `5` 退出。
端口占用时停止，不接入或终止占用它的其他进程；结束时清理本次启动的进程树。
