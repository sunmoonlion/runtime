param([Parameter(Mandatory=$true)][ValidateSet('confirm','tray','autostart','setup')][string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$InputData = [Console]::In.ReadToEnd() | ConvertFrom-Json

if($Action -eq 'setup'){
    foreach($Value in @($InputData.codex,$InputData.home)){if($Value -notmatch '^[A-Za-z]:\\' -or $Value -match '["\r\n]'){throw 'Unsupported setup path'}}
    $Sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $Setup=Join-Path $PSScriptRoot 'elevated-setup.ps1'
    $Arguments='-NoLogo -NoProfile -File "'+$Setup+'" -Codex "'+$InputData.codex+'" -CodexHome "'+$InputData.home+'" -ExpectedSid "'+$Sid+'"'
    $Process=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $Arguments -Verb RunAs -Wait -PassThru
    if($Process.ExitCode -ne 0){throw 'Optional elevated setup failed or was cancelled'}
    @{setup='completed'; next='real sandbox capability probe'} | ConvertTo-Json -Compress
    exit 0
}

if ($Action -eq 'autostart') {
    if ($InputData.instance -notmatch '^[a-f0-9]{24}$') { throw 'Invalid instance' }
    $Name = 'SunMoonAgent-' + $InputData.instance
    $Marker = 'SunMoon agent current-user login v1 ' + $InputData.instance
    $Wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    foreach ($Value in @($InputData.node,$InputData.cli,$InputData.state,$InputData.hiddenScript)) {
        if ($Value -notmatch '^[A-Za-z]:\\' -or $Value -match '["\r\n]') { throw 'Unsupported task path' }
    }
    $Arguments = '//B //Nologo "' + $InputData.hiddenScript + '" "' + $InputData.node + '" "' + $InputData.cli + '" "' + $InputData.state + '"'
    $Existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($Existing -and ($Existing.Description -ne $Marker -or $Existing.Actions.Count -ne 1 -or $Existing.Actions[0].Execute -ne $Wscript -or $Existing.Actions[0].Arguments -ne $Arguments)) {
        throw 'Task name belongs to another configuration; refusing to modify it'
    }
    if ($InputData.action -eq 'enable') {
        $User = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $TaskAction = New-ScheduledTaskAction -Execute $Wscript -Argument $Arguments
        $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
        $Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
        $Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName $Name -Description $Marker -Action $TaskAction -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
    } elseif ($InputData.action -eq 'disable') {
        if ($Existing) { Unregister-ScheduledTask -TaskName $Name -Confirm:$false }
    } elseif ($InputData.action -ne 'status') { throw 'Unsupported action' }
    $Task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    @{name=$Name; installed=[bool]$Task; enabled=([bool]$Task -and $Task.Settings.Enabled); runLevel=if($Task){[string]$Task.Principal.RunLevel}else{$null}} | ConvertTo-Json -Compress
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

if ($Action -eq 'confirm') {
    if ($InputData.challenge -notmatch '^[a-f0-9]{32}$' -or $InputData.description.Length -gt 16000) { throw 'Invalid prompt' }
    $Form = New-Object System.Windows.Forms.Form
    $Form.Text = 'SunMoon - 本机权限确认'
    $Form.Size = New-Object System.Drawing.Size(730,590)
    $Form.StartPosition = 'CenterScreen'; $Form.TopMost = $true; $Form.MinimizeBox = $false; $Form.MaximizeBox = $false
    $Description = New-Object System.Windows.Forms.TextBox
    $Description.Multiline=$true; $Description.ReadOnly=$true; $Description.ScrollBars='Vertical'
    $Description.SetBounds(15,15,680,365); $Description.Text=[string]$InputData.description
    $Label = New-Object System.Windows.Forms.Label
    $Label.SetBounds(15,395,680,48)
    $Code = $InputData.challenge.Substring(0,6)
    $Label.Text = '核对以上范围。若同意，请输入本机确认码 ' + $Code + '，再点击允许。关闭或超时均拒绝。'
    $Answer = New-Object System.Windows.Forms.TextBox; $Answer.SetBounds(15,449,220,28)
    $Allow = New-Object System.Windows.Forms.Button; $Allow.Text='允许本次会话'; $Allow.SetBounds(340,495,165,32); $Allow.Enabled=$false
    $Deny = New-Object System.Windows.Forms.Button; $Deny.Text='拒绝'; $Deny.SetBounds(530,495,165,32)
    $Form.Tag=$false; $Form.CancelButton=$Deny
    $Answer.Add_TextChanged({ $Allow.Enabled = ($Answer.Text -ceq $Code) })
    $Allow.Add_Click({ if ($Answer.Text -ceq $Code) { $Form.Tag=$true; $Form.Close() } })
    $Deny.Add_Click({ $Form.Close() })
    $Timer = New-Object System.Windows.Forms.Timer; $Timer.Interval=60000
    $Timer.Add_Tick({ $Timer.Stop(); $Form.Close() }); $Timer.Start()
    $Form.Controls.AddRange(@($Description,$Label,$Answer,$Allow,$Deny))
    try { $Form.ShowDialog() | Out-Null; $Approved = [bool]$Form.Tag }
    finally { $Timer.Dispose(); $Form.Dispose() }
    @{approved=$Approved; challenge=if($Approved){$InputData.challenge}else{$null}} | ConvertTo-Json -Compress
    exit 0
}

# The tray is a separate process. Closing it never stops the background agent.
if ($InputData.instance -notmatch '^[a-f0-9]{24}$') { throw 'Invalid instance' }
$Mutex = New-Object System.Threading.Mutex($false,('Local\SunMoonAgentTray-' + $InputData.instance))
if (-not $Mutex.WaitOne(0,$false)) { $Mutex.Dispose(); exit 0 }
$Node = [string]$InputData.node; $Cli = [string]$InputData.cli; $State = [string]$InputData.state
if ($Node -match '["\r\n]' -or $Cli -match '["\r\n]') { throw 'Unsupported executable path' }

function Invoke-Agent([string[]]$Command, $Body=$null) {
    # Command strings are fixed menu verbs. User values are only JSON on stdin.
    if (@($Command | Where-Object { $_ -notmatch '^[a-z-]+$' }).Count) { throw 'Invalid menu action' }
    $Exec = @(); $ExtraCa = $null
    $NodeDir = Split-Path -Parent $Node
    if ((Split-Path -Leaf $NodeDir) -eq 'node') {
        $Root = Split-Path -Parent $NodeDir
        $SiteFile = Join-Path $Root 'site\site.json'
        if (Test-Path -LiteralPath $SiteFile) {
            $Exec = @('--use-system-ca')
            $Raw = Get-Content -LiteralPath $SiteFile -Raw -Encoding UTF8
            $Ca = Join-Path $Root 'site\ca.pem'
            if ($Raw.Contains('"mode": "bundled-ca"') -and (Test-Path -LiteralPath $Ca)) { $ExtraCa = $Ca }
        }
    }
    $Info = New-Object System.Diagnostics.ProcessStartInfo
    $Info.FileName=$Node
    $Prefix = if ($Exec.Count) { ($Exec -join ' ') + ' ' } else { '' }
    $Info.Arguments=$Prefix + '"' + $Cli + '" ' + ($Command -join ' ')
    $Info.UseShellExecute=$false; $Info.CreateNoWindow=$true
    $Info.RedirectStandardInput=$true; $Info.RedirectStandardOutput=$true; $Info.RedirectStandardError=$true
    $Info.StandardOutputEncoding=New-Object System.Text.UTF8Encoding($false)
    $Info.EnvironmentVariables['SUNMOON_AGENT_HOME']=$State
    if ($Exec.Count) {
        if ($Info.EnvironmentVariables.ContainsKey('NODE_OPTIONS')) { [void]$Info.EnvironmentVariables.Remove('NODE_OPTIONS') }
        if ($Info.EnvironmentVariables.ContainsKey('NODE_EXTRA_CA_CERTS')) { [void]$Info.EnvironmentVariables.Remove('NODE_EXTRA_CA_CERTS') }
        if ($ExtraCa) { $Info.EnvironmentVariables['NODE_EXTRA_CA_CERTS'] = $ExtraCa }
    }
    $Process=New-Object System.Diagnostics.Process; $Process.StartInfo=$Info
    $Process.Start() | Out-Null
    if ($null -ne $Body) { $Process.StandardInput.Write(($Body | ConvertTo-Json -Depth 8 -Compress)) }
    $Process.StandardInput.Close()
    $ReadOut=$Process.StandardOutput.ReadToEndAsync(); $ReadErr=$Process.StandardError.ReadToEndAsync()
    if (-not $Process.WaitForExit(35000)) { $Process.Dispose(); throw '操作未及时完成，请查看状态；没有强杀进程。' }
    $Text=$ReadOut.Result; $ErrorText=$ReadErr.Result; $ExitCode=$Process.ExitCode; $Process.Dispose()
    if ($ExitCode -ne 0) { throw '操作未完成，请使用 CLI 查看原因和本地日志。' }
    if ($Text.Trim()) { return ($Text | ConvertFrom-Json) }
}
function Show-Result([scriptblock]$Operation) {
    try { $Result=& $Operation; [System.Windows.Forms.MessageBox]::Show(($Result | ConvertTo-Json -Depth 6),'SunMoon') | Out-Null }
    catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'SunMoon') | Out-Null }
}
function Get-ConnectionText($Current) {
    if (-not $Current) { return '已停止' }
    if (-not $Current.running) {
        if ($Current.relay.status -eq 'rejected') { return '连接被拒绝，代理已停止' }
        return '已停止或状态过期'
    }
    switch ([string]$Current.relay.status) {
        'connected' { return '在线' }
        'connecting' { return '正在连接' }
        'rejected' { return '连接被拒绝' }
        default { return '离线，等待重连' }
    }
}
function Show-Status {
    try {
        $Current=Invoke-Agent @('status')
        $Reason=if($Current.relay.lastError){[string]$Current.relay.lastError}elseif($Current.relay.lastNotice){[string]$Current.relay.lastNotice}elseif($Current.running){'无连接错误'}else{'代理未运行；可从托盘启动'}
        $Text='状态：'+(Get-ConnectionText $Current)+"`r`n`r`n原因："+$Reason
        if($Current.relay.lastNotice -and $Current.relay.lastNotice -ne $Reason){$Text+="`r`n提示："+[string]$Current.relay.lastNotice}
        if($Current.execServer.windowsSandbox.mode){$Text+="`r`n`r`n沙箱模式："+[string]$Current.execServer.windowsSandbox.mode}
        if($Current.at){$Text+="`r`n状态更新时间："+[string]$Current.at}
        [System.Windows.Forms.MessageBox]::Show($Text,'SunMoon - 连接状态')|Out-Null
    } catch {[System.Windows.Forms.MessageBox]::Show('无法读取状态，请查看本机日志。','SunMoon - 连接状态')|Out-Null}
}
function Show-Preferences {
    $Prefs=Invoke-Agent @('settings','show')
    $Dialog=New-Object System.Windows.Forms.Form; $Dialog.Text='SunMoon - 本机设置'; $Dialog.Size=New-Object System.Drawing.Size(700,525); $Dialog.StartPosition='CenterScreen'
    $NameLabel=New-Object System.Windows.Forms.Label; $NameLabel.Text='机器名称'; $NameLabel.SetBounds(15,15,100,24)
    $Name=New-Object System.Windows.Forms.TextBox; $Name.Text=$Prefs.machineName; $Name.SetBounds(120,15,500,26)
    $RootLabel=New-Object System.Windows.Forms.Label; $RootLabel.Text='勾选允许访问的目录；未勾选的目录只记住位置，不授予访问权限。'; $RootLabel.SetBounds(15,52,650,26)
    $Roots=New-Object System.Windows.Forms.CheckedListBox; $Roots.Name='DirectoryChoices'; $Roots.AccessibleName='允许访问的目录'; $Roots.CheckOnClick=$true; $Roots.HorizontalScrollbar=$true; $Roots.SetBounds(15,82,650,170)
    $Choices=if($null -ne $Prefs.rootChoices){@($Prefs.rootChoices)}else{@($Prefs.roots)}
    foreach($Root in $Choices){$Roots.Items.Add([string]$Root,([bool](@($Prefs.roots) -contains $Root)))|Out-Null}
    $Add=New-Object System.Windows.Forms.Button; $Add.Text='添加待选目录'; $Add.SetBounds(15,265,135,30)
    $Remove=New-Object System.Windows.Forms.Button; $Remove.Text='移除选中行'; $Remove.SetBounds(165,265,135,30)
    $Add.Add_Click({ $Picker=New-Object System.Windows.Forms.FolderBrowserDialog; try { if($Picker.ShowDialog() -eq 'OK' -and -not $Roots.Items.Contains($Picker.SelectedPath)){$Roots.Items.Add($Picker.SelectedPath,$false)|Out-Null} } finally{$Picker.Dispose()} })
    $Remove.Add_Click({ if($Roots.SelectedIndex -ge 0){$Roots.Items.RemoveAt($Roots.SelectedIndex)} })
    $Mode=New-Object System.Windows.Forms.ComboBox; $Mode.DropDownStyle='DropDownList'; $Mode.SetBounds(15,310,230,28); $Mode.Items.AddRange(@('read-only','workspace-write')); $Mode.SelectedItem=$Prefs.ceiling.sandbox
    $Network=New-Object System.Windows.Forms.CheckBox; $Network.Text='允许联网（包括本机代发 MCP HTTP）'; $Network.Checked=[bool]$Prefs.ceiling.network; $Network.SetBounds(270,310,395,28)
    $NoteText='保存后需停止并重新启动代理才生效。全部取消勾选可关闭项目目录访问；临时批准在断开时失效。'
    try { $Current=Invoke-Agent @('status'); if($Current.relay.lastError){$NoteText+="`r`n"+[string]$Current.relay.lastError} } catch {}
    $Note=New-Object System.Windows.Forms.Label; $Note.Text=$NoteText; $Note.SetBounds(15,350,650,55)
    $Save=New-Object System.Windows.Forms.Button; $Save.Name='SaveSettings'; $Save.Text='保存设置'; $Save.SetBounds(405,425,120,30)
    $Cancel=New-Object System.Windows.Forms.Button; $Cancel.Text='取消'; $Cancel.SetBounds(545,425,120,30)
    $Save.Add_Click({
        try {
            Invoke-Agent @('settings','set') @{machineName=$Name.Text; roots=@($Roots.CheckedItems | ForEach-Object{[string]$_}); rootChoices=@($Roots.Items | ForEach-Object{[string]$_}); ceiling=@{sandbox=[string]$Mode.SelectedItem; network=[bool]$Network.Checked}} | Out-Null
            [System.Windows.Forms.MessageBox]::Show('已保存。请在托盘中停止、再启动代理使设置生效。','SunMoon')|Out-Null; $Dialog.Close()
        } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'SunMoon')|Out-Null }
    })
    $Cancel.Add_Click({$Dialog.Close()}); $Dialog.CancelButton=$Cancel
    $Dialog.Controls.AddRange(@($NameLabel,$Name,$RootLabel,$Roots,$Add,$Remove,$Mode,$Network,$Note,$Save,$Cancel))
    try{$Dialog.ShowDialog()|Out-Null}finally{$Dialog.Dispose()}
}

$Tray=New-Object System.Windows.Forms.NotifyIcon; $Tray.Icon=[System.Drawing.SystemIcons]::Application; $Tray.Text='SunMoon Agent'; $Tray.Visible=$true
$Menu=New-Object System.Windows.Forms.ContextMenuStrip
$Connection=$Menu.Items.Add('状态：正在读取'); $Connection.Enabled=$false
$Status=$Menu.Items.Add('查看状态与原因'); $Status.Add_Click({ Show-Status })
$Tray.Add_DoubleClick({Show-Status})
$Start=$Menu.Items.Add('启动代理'); $Start.Add_Click({ Show-Result { Invoke-Agent @('start','--background') } })
$Stop=$Menu.Items.Add('停止代理'); $Stop.Add_Click({ Show-Result { Invoke-Agent @('stop') } })
$Preferences=$Menu.Items.Add('白名单与上限设置'); $Preferences.Add_Click({ try{Show-Preferences}catch{[System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'SunMoon')|Out-Null} })
$Enable=$Menu.Items.Add('启用登录自启'); $Enable.Add_Click({ Show-Result { Invoke-Agent @('autostart','enable') } })
$Disable=$Menu.Items.Add('关闭登录自启'); $Disable.Add_Click({ Show-Result { Invoke-Agent @('autostart','disable') } })
$Menu.Items.Add('-')|Out-Null
$Exit=$Menu.Items.Add('退出托盘（代理继续运行）'); $Exit.Add_Click({[System.Windows.Forms.Application]::Exit()})
$Tray.ContextMenuStrip=$Menu
$TrayId=[Guid]::NewGuid().ToString()
$TrayStatus=Join-Path $State 'tray.json'; $TrayStop=Join-Path $State 'tray-stop.json'
@{pid=$PID;runId=$TrayId} | ConvertTo-Json -Compress | Set-Content -LiteralPath $TrayStatus -Encoding UTF8
$Timer=New-Object System.Windows.Forms.Timer; $Timer.Interval=5000
$Timer.Add_Tick({
    try {
        if(Test-Path -LiteralPath $TrayStop){
            $Request=Get-Content -LiteralPath $TrayStop -Raw -Encoding UTF8 | ConvertFrom-Json
            if($Request.pid -eq $PID -and $Request.runId -eq $TrayId){
                Remove-Item -LiteralPath $TrayStop
                [System.Windows.Forms.Application]::Exit(); return
            }
        }
        $StatusPath=Join-Path $State 'status.json'
        if(Test-Path -LiteralPath $StatusPath){
            $Current=Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $Age=((Get-Date).ToUniversalTime()-[DateTime]::Parse($Current.at).ToUniversalTime()).TotalSeconds
            $Current|Add-Member -NotePropertyName running -NotePropertyValue ($Age -ge -2 -and $Age -lt 15) -Force
            $Label=Get-ConnectionText $Current
            $Tip='SunMoon: '+$Label; if($Tip.Length -gt 63){$Tip=$Tip.Substring(0,63)}
            $Tray.Text=$Tip
            if($Current.relay.lastError){$Connection.Text=[string]$Current.relay.lastError}else{$Connection.Text='状态：'+$Label}
        } else {$Tray.Text='SunMoon: 已停止';$Connection.Text='状态：已停止'}
    } catch {$Tray.Text='SunMoon: 状态暂不可读';$Connection.Text='状态：暂不可读'}
})
$Timer.Start()
try {[System.Windows.Forms.Application]::Run()}
finally {$Timer.Dispose(); $Tray.Visible=$false; $Tray.Dispose(); $Menu.Dispose(); Remove-Item -LiteralPath $TrayStatus -ErrorAction SilentlyContinue; $Mutex.ReleaseMutex(); $Mutex.Dispose()}
