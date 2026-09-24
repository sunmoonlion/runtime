# Windows 上的 exec-server 探针（D11）。PowerShell 7 或 Windows PowerShell 5.1。
# 看三件事：1) codex exec-server 起得来、监听 127.0.0.1:47001 吗；2) workspace-write 沙箱在 Windows 上生效吗（L2 该拒、L3 该写成）
#           还是报 "sandbox intent cannot be enforced on this executor"；3) 杀毒软件拦不拦。
# 用法：  $env:ORCH_HOME="$HOME\.codex-probe"   （有登录态的编排端 CODEX_HOME）
#         powershell -ExecutionPolicy Bypass -File scripts\probe-windows-exec-server.ps1 *> scripts\results\probe-windows-exec-server.$(Get-Date -Format yyyyMMdd-HHmmss).txt
$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..")
Write-Output "===== 环境 ====="
Write-Output "主机        $env:COMPUTERNAME"
Write-Output "时间        $(Get-Date -Format o)"
Write-Output "系统        $([System.Environment]::OSVersion.VersionString)  PowerShell $($PSVersionTable.PSVersion)"
Write-Output "内存        $([math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)) GB 可用"
Write-Output "Python      $(python --version 2>&1)"
Write-Output "Node        $(node --version 2>&1)"
Write-Output "Codex       $(codex --version 2>&1)"
Write-Output "杀毒        $((Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Select-Object -ExpandProperty displayName) -join ', ')"
Write-Output "runtime     $(git rev-parse --short HEAD)  $(git branch --show-current)"
Write-Output "===== 开始 ====="

$execHome = Join-Path $HOME ".codex-probe-exec"
New-Item -ItemType Directory -Force -Path $execHome, "probe\user-ws" | Out-Null
if (-not (Test-Path "$execHome\config.toml")) { Set-Content "$execHome\config.toml" "sandbox_mode = `"read-only`"`napproval_policy = `"never`"`n" }
if (-not $env:ORCH_HOME) { Write-Output "缺 ORCH_HOME（编排端 CODEX_HOME，要有登录态）"; exit 2 }

Write-Output "--- 1. 起 exec-server"
$env:CODEX_HOME = $execHome; $env:PROBE_SIDE = "exec-server"
$es = Start-Process -FilePath "codex" -ArgumentList "exec-server","--listen","ws://127.0.0.1:47001" -RedirectStandardOutput "probe\es-windows.log" -RedirectStandardError "probe\es-windows.err.log" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
$listening = Get-NetTCPConnection -LocalPort 47001 -State Listen -ErrorAction SilentlyContinue
Write-Output "exec-server pid $($es.Id) 退出了吗: $($es.HasExited)  监听 47001: $([bool]$listening)"
Get-Content "probe\es-windows.log","probe\es-windows.err.log" -ErrorAction SilentlyContinue | Select-Object -First 20
if (-not $listening) { Write-Output "结论：fail（exec-server 没有监听；看上面的日志与杀毒记录）"; exit 5 }

Write-Output "--- 2. 沙箱案例 L2（写 cwd 之外，应被拒）与 L3（写 cwd 内，应成功）"
$env:CODEX_HOME = $env:ORCH_HOME; $env:PROBE_SIDE = "app-server"; $env:CASES = "L2,L3"; $env:WIN = "1"
python -u probe\probe_local_ceiling.py 2>&1
Write-Output "python 退出码 $LASTEXITCODE"

Write-Output "--- 3. 收尾"
if (-not $es.HasExited) { Stop-Process -Id $es.Id -Force; Write-Output "停 exec-server" }
Write-Output "exec-server 日志尾部："
Get-Content "probe\es-windows.log" -ErrorAction SilentlyContinue | Select-Object -Last 15
Write-Output "结论三值由输出里的 VERDICT L2 / L3 判：两者都 True 为 pass；出现 'sandbox intent cannot be enforced' 为 fail（Windows 无沙箱实现）；其余 undecidable。"
