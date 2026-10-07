# Windows exec-server probe (D11). PowerShell 5.1 / 7, UTF-8 with BOM.
# Model-driven mode requires an independently authenticated ORCH_HOME.
# PROBE_FS_ONLY=1 uses a local, credential-free RPC probe instead.
# Keep the original L2 / L3 acceptance criteria; infrastructure errors are undecidable.
$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$env:PYTHONUTF8 = "1"
Set-Location (Join-Path $PSScriptRoot "..")

function Resolve-CodexLauncher {
    if ($env:CODEX_NATIVE_EXE) {
        if (-not (Test-Path -LiteralPath $env:CODEX_NATIVE_EXE -PathType Leaf) -or
            [IO.Path]::GetExtension($env:CODEX_NATIVE_EXE) -ne ".exe") {
            throw "CODEX_NATIVE_EXE must name an existing native executable"
        }
        return @($env:CODEX_NATIVE_EXE)
    }
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

$sandboxMode = if ($env:SANDBOX_MODE) { $env:SANDBOX_MODE } else { "elevated" }
if ($sandboxMode -notin @("elevated", "unelevated")) { throw "Invalid SANDBOX_MODE" }
$outerSandbox = $env:PROBE_OUTER_SANDBOX -eq "1"
$probeModes = @($env:PROBE_START_ONLY, $env:PROBE_FS_ONLY, $env:PROBE_PROCESS_ONLY) | Where-Object { $_ -eq "1" }
if (@($probeModes).Count -gt 1) { throw "Choose only one probe mode" }

# Start-Process in Windows PowerShell 5.1 takes a command line, not an argv array.
function Quote-NativeArgument([string] $Value) {
    if ($Value -notmatch '[\s"]' -and $Value.Length -gt 0) { return $Value }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
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
    if ($outerSandbox -and $launcher.Count -ne 1) { throw "Outer probe requires CODEX_NATIVE_EXE" }
    # Override the orchestration home in this process only; never edit its config.
    $orchestrator = @($launcher) + @("-c", "windows.sandbox=`"$sandboxMode`"")
    $env:CODEX_COMMAND_JSON = ConvertTo-Json -InputObject $orchestrator -Compress
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
    $codexVersion = & $program @prefix --version
    if ($LASTEXITCODE -ne 0) { throw "Codex unavailable (exit $LASTEXITCODE)" }
    if ($codexVersion.Trim() -ne "codex-cli 0.155.1") { throw "Expected codex-cli 0.155.1" }
    Write-Output $codexVersion
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Write-Output "Sandbox mode $sandboxMode; administrator=$isAdmin; outer=$outerSandbox"
    if ($sandboxMode -eq "unelevated" -and $isAdmin) { throw "Run the unelevated probe from a non-administrator process" }
    Write-Output "Codex 启动参数 $env:CODEX_COMMAND_JSON"
    $antivirus = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop)
    Write-Output "杀毒        $(($antivirus | Select-Object -ExpandProperty displayName) -join ', ')"
    if ($env:PROBE_SOURCE_COMMIT) {
        if ($env:PROBE_SOURCE_COMMIT -notmatch '^[0-9a-f]{40}$') { throw "Invalid PROBE_SOURCE_COMMIT" }
        Write-Output "Source baseline $env:PROBE_SOURCE_COMMIT (copied to native Windows storage)"
    } else {
        git rev-parse HEAD
        if ($LASTEXITCODE -ne 0) { throw "Cannot determine tested Git commit" }
        git status --short
        if ($LASTEXITCODE -ne 0) { throw "Cannot determine tested working-tree changes" }
    }
    $sources = @($PSCommandPath, (Join-Path (Get-Location) 'probe\probe_local_ceiling.py'))
    if ($env:PROBE_FS_ONLY -eq "1") { $sources += Join-Path (Get-Location) 'probe\probe_windows_fs.mjs' }
    if ($env:PROBE_PROCESS_ONLY -eq "1") { $sources += Join-Path (Get-Location) 'probe\probe_windows_process.mjs' }
    foreach ($source in $sources) {
        $hash = Get-FileHash -LiteralPath $source -Algorithm SHA256
        Write-Output "Source SHA256 $($hash.Hash.ToLowerInvariant()) $($hash.Path)"
    }
    Write-Output "===== 开始 ====="
    if ($env:PROBE_START_ONLY -ne "1" -and $env:PROBE_FS_ONLY -ne "1" -and $env:PROBE_PROCESS_ONLY -ne "1" -and
        (-not $env:ORCH_HOME -or -not (Test-Path -LiteralPath $env:ORCH_HOME -PathType Container))) {
        throw "Missing ORCH_HOME (authenticated orchestration CODEX_HOME)"
    }
    $execHome = if ($sandboxMode -eq "unelevated") {
        Join-Path $env:USERPROFILE (".codex-probe-exec-unelevated-" + [guid]::NewGuid().ToString('N'))
    } else { Join-Path $env:USERPROFILE ".codex-probe-exec" }
    if ($sandboxMode -eq "elevated" -and
        (-not (Test-Path -LiteralPath (Join-Path $execHome '.sandbox') -PathType Container) -or
         -not (Test-Path -LiteralPath (Join-Path $execHome '.sandbox-secrets') -PathType Container))) {
        throw "Elevated probe requires an existing setup home; it must not provision sandbox accounts"
    }
    if ($env:ORCH_HOME -and [IO.Path]::GetFullPath($execHome).TrimEnd('\') -eq [IO.Path]::GetFullPath($env:ORCH_HOME).TrimEnd('\')) {
        throw "Executor and orchestrator homes must be separate"
    }
    if (Test-Path (Join-Path $execHome "auth.json")) { throw "Executor home must not contain auth.json" }
    if (Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $execPort) {
        throw "Port $execPort is already in use; set EXEC_PORT to an unused loopback port"
    }
    New-Item -ItemType Directory -Force -Path $execHome, "probe\user-ws", "probe\cloud-ws" | Out-Null
    $config = Join-Path $execHome "config.toml"
    if (-not (Test-Path -LiteralPath $config)) {
        $configText = "sandbox_mode = `"read-only`"`napproval_policy = `"never`"`n[windows]`nsandbox = `"$sandboxMode`"`n"
        [IO.File]::WriteAllText($config, $configText, (New-Object System.Text.UTF8Encoding))
    }
    Write-Output "Executor home $execHome; auth.json absent; no setup command executed"

    Write-Output "--- 1. 起 exec-server（$env:EXEC_URL）"
    $env:CODEX_HOME = $execHome
    $env:PROBE_SIDE = "exec-server"
    # Start-Process joins ArgumentList into a string. Preserve spaces in npm paths.
    $serverArgs = @($prefix) + @("exec-server", "--listen", $env:EXEC_URL)
    if ($outerSandbox) {
        # 0.155.1 on Windows exposes `sandbox [COMMAND]`, not `sandbox windows`.
        # Permit loopback for the bridge; this probe does not claim network isolation.
        # CLI overrides also let the already-setup elevated home participate
        # without changing its existing configuration or copying setup secrets.
        $workspaceKey = ConvertTo-Json -InputObject (Join-Path (Get-Location) 'probe\user-ws') -Compress
        $homeKey = ConvertTo-Json -InputObject $execHome -Compress
        $profile = "permissions.probe_outer={filesystem={`":root`"=`"read`",$workspaceKey=`"write`",$homeKey=`"write`"},network={enabled=true}}"
        $serverArgs = @("-c", $profile, "-c", "windows.sandbox=`"$sandboxMode`"", "sandbox", "--permission-profile", "probe_outer",
            "-C", (Join-Path (Get-Location) 'probe\user-ws'), "--", $program, "exec-server", "--listen", $env:EXEC_URL)
    }
    $serverCommandLine = ($serverArgs | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
    Write-Output "Executor argv $(ConvertTo-Json -InputObject $serverArgs -Compress)"
    $es = Start-Process -FilePath $program -ArgumentList $serverCommandLine -RedirectStandardOutput "probe\es-windows.log" -RedirectStandardError "probe\es-windows.err.log" -PassThru -WindowStyle Hidden
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
    } elseif ($env:PROBE_START_ONLY -eq "1") {
        Write-Output "Startup: pass; boundary: undecidable (PROBE_START_ONLY; no model or write requests)"
        $exitCode = 2
    } elseif ($env:PROBE_PROCESS_ONLY -eq "1") {
        & node.exe (Join-Path (Get-Location) 'probe\probe_windows_process.mjs')
        $exitCode = $LASTEXITCODE
    } elseif ($env:PROBE_FS_ONLY -eq "1") {
        if (-not $env:L2_OUTSIDE_ROOT) { throw "FS probe requires a dedicated L2_OUTSIDE_ROOT outside USERPROFILE" }
        & node.exe (Join-Path (Get-Location) 'probe\probe_windows_fs.mjs')
        $exitCode = $LASTEXITCODE
        Write-Output "Filesystem-only probe exit=$exitCode; model-driven L2/L3 remain unverified"
    } else {
        Write-Output "--- 2. 沙箱案例 L2（写 cwd 之外，应被拒）与 L3（写 cwd 内，应成功）"
        $env:CODEX_HOME = $env:ORCH_HOME
        $env:PROBE_SIDE = "app-server"
        $env:CASES = if ($outerSandbox) { "L1,L2,L3" } else { "L2,L3" }
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
        } elseif ($outerSandbox -and $output -match '(?m)^\s*VERDICT L1 .*: True\s*$') {
            Write-Output "结论：fail（外沙箱允许 danger-full-access 写到 cwd 之外）"
            $exitCode = 1
        } elseif ($output -match '(?m)^\s*VERDICT L[23] .*: False\s*$') {
            Write-Output "结论：fail（已执行的 L2/L3 不满足写入边界）"
            $exitCode = 1
        } elseif ($pythonExit -eq 0 -and $output -match '(?m)^\s*VERDICT L2 .*: True\s*$' -and $output -match '(?m)^\s*VERDICT L3 .*: True\s*$' -and
            (-not $outerSandbox -or $output -match '(?m)^\s*VERDICT L1 .*: False\s*$')) {
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
            Get-Content -LiteralPath $log -Encoding UTF8
        }
    }
}
exit $exitCode
