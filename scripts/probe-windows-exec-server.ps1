# Windows exec-server probe (D11). PowerShell 5.1 / 7, UTF-8 with BOM.
# ORCH_HOME must point to an independently authenticated Codex home.
# Keep the original L2 / L3 acceptance criteria; infrastructure errors are undecidable.
$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$env:PYTHONUTF8 = "1"
Set-Location (Join-Path $PSScriptRoot "..")

function Resolve-CodexLauncher {
    $shim = Get-Command codex -ErrorAction Stop
    if ([IO.Path]::GetExtension($shim.Source) -eq ".exe") { return @($shim.Source) }
    # Resolve npm's documented package bin entry instead of executing a shell shim
    # or depending on the package's internal native-binary layout.
    $packageRoot = Join-Path (Split-Path $shim.Source) "node_modules\@openai\codex"
    $package = Get-Content (Join-Path $packageRoot "package.json") -Raw | ConvertFrom-Json
    $entry = Join-Path $packageRoot $package.bin.codex
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Missing Codex npm entry: $entry" }
    return @((Get-Command node.exe -ErrorAction Stop).Source, $entry)
}

$execPort = if ($env:EXEC_PORT) { [int]$env:EXEC_PORT } else { 47001 }
if ($execPort -lt 1 -or $execPort -gt 65535) { throw "Invalid EXEC_PORT" }
$env:EXEC_URL = "ws://127.0.0.1:$execPort"
$es = $null
$exitCode = 2
try {
    $launcher = @(Resolve-CodexLauncher)
    $program = $launcher[0]
    $prefix = @($launcher | Select-Object -Skip 1)
    $env:CODEX_COMMAND_JSON = ConvertTo-Json -InputObject $launcher -Compress
    $python = (Get-Command python.exe -ErrorAction Stop).Source
    Write-Output "===== 环境 ====="
    Write-Output "主机        $env:COMPUTERNAME"
    Write-Output "时间        $(Get-Date -Format o)"
    Write-Output "系统        $([Environment]::OSVersion.VersionString)  PowerShell $($PSVersionTable.PSVersion)"
    Write-Output "内存        $([math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)) GB 可用"
    & $python --version
    if ($LASTEXITCODE -ne 0) { throw "Python unavailable (exit $LASTEXITCODE)" }
    node --version
    if ($LASTEXITCODE -ne 0) { throw "Node unavailable (exit $LASTEXITCODE)" }
    & $program @prefix --version
    if ($LASTEXITCODE -ne 0) { throw "Codex unavailable (exit $LASTEXITCODE)" }
    Write-Output "Codex 启动参数 $env:CODEX_COMMAND_JSON"
    $antivirus = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop)
    Write-Output "杀毒        $(($antivirus | Select-Object -ExpandProperty displayName) -join ', ')"
    git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw "Cannot determine tested Git commit" }
    git status --short
    if ($LASTEXITCODE -ne 0) { throw "Cannot determine tested working-tree changes" }
    Write-Output "===== 开始 ====="
    if (-not $env:ORCH_HOME -or -not (Test-Path -LiteralPath $env:ORCH_HOME -PathType Container)) {
        throw "Missing ORCH_HOME (authenticated orchestration CODEX_HOME)"
    }
    $execHome = Join-Path $env:USERPROFILE ".codex-probe-exec"
    if ([IO.Path]::GetFullPath($execHome).TrimEnd('\') -eq [IO.Path]::GetFullPath($env:ORCH_HOME).TrimEnd('\')) {
        throw "Executor and orchestrator homes must be separate"
    }
    if (Test-Path (Join-Path $execHome "auth.json")) { throw "Executor home must not contain auth.json" }
    if (Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $execPort) {
        throw "Port $execPort is already in use; set EXEC_PORT to an unused loopback port"
    }
    New-Item -ItemType Directory -Force -Path $execHome, "probe\user-ws", "probe\cloud-ws" | Out-Null
    $config = Join-Path $execHome "config.toml"
    if (-not (Test-Path -LiteralPath $config)) {
        [IO.File]::WriteAllText($config, "sandbox_mode = `"read-only`"`napproval_policy = `"never`"`n", (New-Object System.Text.UTF8Encoding))
    }

    Write-Output "--- 1. 起 exec-server（$env:EXEC_URL）"
    $env:CODEX_HOME = $execHome
    $env:PROBE_SIDE = "exec-server"
    # Start-Process joins ArgumentList into a string. Preserve spaces in npm paths.
    $serverArgs = @($prefix | ForEach-Object { '"' + $_ + '"' }) + @("exec-server", "--listen", $env:EXEC_URL)
    $es = Start-Process -FilePath $program -ArgumentList $serverArgs -RedirectStandardOutput "probe\es-windows.log" -RedirectStandardError "probe\es-windows.err.log" -PassThru -WindowStyle Hidden
    $listening = $false
    for ($i = 0; $i -lt 40; $i++) {
        $es.Refresh()
        if ($es.HasExited) { break }
        $listening = [bool](Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $execPort)
        if ($listening) { break }
        Start-Sleep -Milliseconds 250
    }
    Write-Output "exec-server launcher pid $($es.Id) 退出了吗: $($es.HasExited) 监听 ${execPort}: $listening"
    if (-not $listening) {
        Write-Output "结论：fail（exec-server 没有监听）"
        $exitCode = 5
    } else {
        Write-Output "--- 2. 沙箱案例 L2（写 cwd 之外，应被拒）与 L3（写 cwd 内，应成功）"
        $env:CODEX_HOME = $env:ORCH_HOME
        $env:PROBE_SIDE = "app-server"
        $env:CASES = "L2,L3"
        $env:WIN = "1"
        # PowerShell 5.1 turns native stderr into ErrorRecord; retain the full stream,
        # then judge the process exit explicitly rather than aborting on stderr.
        $ErrorActionPreference = "Continue"
        & $python -u probe\probe_local_ceiling.py 2>&1 | Tee-Object -FilePath "probe\ceiling-windows.log"
        $pythonExit = $LASTEXITCODE
        $ErrorActionPreference = "Stop"
        Write-Output "python 退出码 $pythonExit"
        $output = Get-Content "probe\ceiling-windows.log" -Raw
        if ($output -match "sandbox intent cannot be enforced") {
            Write-Output "结论：fail（执行端报告无法实施请求的沙箱）"
            $exitCode = 1
        } elseif ($pythonExit -eq 0 -and $output -match '(?m)^\s*VERDICT L2 .*: True\s*$' -and $output -match '(?m)^\s*VERDICT L3 .*: True\s*$') {
            Write-Output "结论：pass（L2 与 L3 均为 True）"
            $exitCode = 0
        } else {
            Write-Output "结论：undecidable（没有取得完整的 L2/L3 通过证据）"
            $exitCode = 2
        }
    }
} catch {
    Write-Output ($_ | Out-String)
    Write-Output "结论：undecidable（探针执行错误）"
    $exitCode = 2
} finally {
    Write-Output "--- 3. 收尾"
    if ($null -ne $es) {
        $es.Refresh()
        if (-not $es.HasExited) {
            & taskkill.exe /PID $es.Id /T /F
            if ($LASTEXITCODE -ne 0) {
                Write-Output "清理进程失败"
                $exitCode = 2
            }
            $es.WaitForExit()
        }
    }
    foreach ($log in @("probe\es-windows.log", "probe\es-windows.err.log")) {
        if (Test-Path -LiteralPath $log) {
            Write-Output "--- $log（完整）"
            Get-Content -LiteralPath $log
        }
    }
}
exit $exitCode
