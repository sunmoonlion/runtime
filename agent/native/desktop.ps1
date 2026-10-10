param([Parameter(Mandatory=$true)][ValidateSet('confirm','tray','autostart','setup','onboard')][string]$Action)
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
function Signal-DesktopReady {
    # Fire only after this process is inside its own message loop, so the parent may exit.
    $Ready = New-Object System.Windows.Forms.Timer
    $Ready.Interval = 50
    $Ready.Add_Tick({
        $Ready.Stop(); $Ready.Dispose()
        # Hidden PowerShell has no console; write the redirected stdout handle as UTF-8.
        $Bytes = [System.Text.Encoding]::UTF8.GetBytes("{`"desktop`":`"ready`"}`n")
        $Out = [Console]::OpenStandardOutput()
        $Out.Write($Bytes, 0, $Bytes.Length)
        $Out.Flush()
    })
    $Ready.Start()
}

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
$Node = [string]$InputData.node; $Cli = [string]$InputData.cli; $State = [string]$InputData.state
if ($Node -match '["\r\n]' -or $Cli -match '["\r\n]') { throw 'Unsupported executable path' }

function New-AgentProcess([string[]]$Command) {
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
    return $Process
}
function Invoke-Agent([string[]]$Command, $Body=$null) {
    $Process=New-AgentProcess $Command
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

function Show-Onboard {
    $Form=New-Object System.Windows.Forms.Form
    $Form.Text='SunMoon - 设置'; $Form.Size=New-Object System.Drawing.Size(700,480); $Form.StartPosition='CenterScreen'
    $script:Pair=$null; $script:Account=''; $script:Remaining=0; $script:GotResult=$false; $script:ExitSeen=$false; $script:ExitShown=$false; $script:LastErr=$null
    $script:WebOrigin=$null
    $NodeDir=Split-Path -Parent $Node
    if ((Split-Path -Leaf $NodeDir) -eq 'node') {
        $SiteFile=Join-Path (Split-Path -Parent $NodeDir) 'site\site.json'
        if (Test-Path -LiteralPath $SiteFile) {
            $Site=Get-Content -LiteralPath $SiteFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($Site.web_origin) { $script:WebOrigin=[string]$Site.web_origin }
        }
    }
    $Intro=New-Object System.Windows.Forms.Label; $Intro.Text='连接账号'; $Intro.SetBounds(15,15,650,24)
    $Connect=New-Object System.Windows.Forms.Button; $Connect.Text='连接我的账号'; $Connect.SetBounds(15,48,160,32)
    $Code=New-Object System.Windows.Forms.Label; $Code.Font=New-Object System.Drawing.Font('Segoe UI',28); $Code.SetBounds(15,95,650,60)
    $Clock=New-Object System.Windows.Forms.Label; $Clock.SetBounds(15,160,650,24)
    $Connected=New-Object System.Windows.Forms.Label; $Connected.SetBounds(15,190,650,28)
    $CancelPair=New-Object System.Windows.Forms.Button; $CancelPair.Text='取消'; $CancelPair.SetBounds(15,230,120,30)
    $Refresh=New-Object System.Windows.Forms.Button; $Refresh.Text='重新获取连接码'; $Refresh.SetBounds(150,230,160,30)
    $Next1=New-Object System.Windows.Forms.Button; $Next1.Text='下一步'; $Next1.Enabled=$false; $Next1.SetBounds(545,390,120,30)
    $FolderNote=New-Object System.Windows.Forms.Label; $FolderNote.Text='不选的话工作和专家碰不到你的文件'; $FolderNote.Visible=$false; $FolderNote.SetBounds(15,15,650,24)
    $Roots=New-Object System.Windows.Forms.CheckedListBox; $Roots.Visible=$false; $Roots.CheckOnClick=$true; $Roots.SetBounds(15,48,650,250)
    $Add=New-Object System.Windows.Forms.Button; $Add.Text='添加待选目录'; $Add.Visible=$false; $Add.SetBounds(15,310,135,30)
    $Remove=New-Object System.Windows.Forms.Button; $Remove.Text='移除选中行'; $Remove.Visible=$false; $Remove.SetBounds(165,310,135,30)
    $Next2=New-Object System.Windows.Forms.Button; $Next2.Text='下一步'; $Next2.Visible=$false; $Next2.SetBounds(545,390,120,30)
    $Auto=New-Object System.Windows.Forms.CheckBox; $Auto.Text='开机自动运行'; $Auto.Checked=$true; $Auto.Visible=$false; $Auto.SetBounds(15,48,300,28)
    $Next3=New-Object System.Windows.Forms.Button; $Next3.Text='下一步'; $Next3.Visible=$false; $Next3.SetBounds(545,390,120,30)
    $Finish=New-Object System.Windows.Forms.Button; $Finish.Text='完成'; $Finish.Visible=$false; $Finish.SetBounds(405,390,120,30)
    $Retry=New-Object System.Windows.Forms.Button; $Retry.Text='重试'; $Retry.Visible=$false; $Retry.SetBounds(15,230,120,30)
    $Online=New-Object System.Windows.Forms.Label; $Online.Visible=$false; $Online.SetBounds(15,48,650,80)
    $script:Lines = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
    $script:ErrLines = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
    function Test-SiteUrl([string]$Url, [string]$Origin) {
        if (-not $Origin -or -not $Url.StartsWith($Origin)) { return $false }
        if ($Url.Length -gt $Origin.Length) {
            $Rest = $Url.Substring($Origin.Length, 1)
            if ($Rest -ne '/' -and $Rest -ne '?' -and $Rest -ne '#') { return $false }
        }
        return $Url -match '^https?://[^ \r\n]+$'
    }
    $Timer=New-Object System.Windows.Forms.Timer; $Timer.Interval=1000
    $Timer.Add_Tick({
        if($script:Remaining -gt 0){ $script:Remaining--; $Clock.Text=('剩余 ' + $script:Remaining + ' 秒') }
        $Err=$null
        while($script:ErrLines.TryDequeue([ref]$Err)){ if([string]$Err.Trim()){ $script:LastErr=[string]$Err.Trim() } }
        $Line=$null
        while($script:Lines.TryDequeue([ref]$Line)){
            try{$Msg=$Line|ConvertFrom-Json}catch{continue}
            if($Msg.event -eq 'code'){
                $Code.Text=[string]$Msg.user_code
                $script:Remaining=[int]$Msg.expires_in
                $Clock.Text=('剩余 ' + $script:Remaining + ' 秒')
                $Url=[string]$Msg.verify_url
                if(Test-SiteUrl $Url $script:WebOrigin){ Start-Process $Url }
            } elseif($Msg.event -eq 'result' -and $Msg.status -eq 'approved'){
                $script:GotResult=$true
                $script:Account=[string]$Msg.account
                $Connected.Text='已连接到 ' + $script:Account
                $Next1.Enabled=$true
            } elseif($Msg.event -eq 'result'){
                $script:GotResult=$true
                $Connected.Text=[string]$Msg.message
                $Refresh.Enabled=$true
            }
        }
        if($script:Pair -and $script:Pair.HasExited -and -not $script:GotResult -and -not $script:ExitShown){
            if($script:LastErr -or $script:ExitSeen){
                $script:ExitShown=$true
                $Connected.Text = if($script:LastErr){ $script:LastErr } else { '连接没有完成，请重新获取。' }
                $Refresh.Enabled=$true
            } else { $script:ExitSeen=$true }
        }
    })
    function Stop-Pair { if($script:Pair -and -not $script:Pair.HasExited){ try{$script:Pair.StandardInput.WriteLine('cancel')}catch{} } }
    $Connect.Add_Click({
        Stop-Pair
        $script:GotResult=$false; $script:ExitSeen=$false; $script:ExitShown=$false; $script:LastErr=$null
        $Drop=$null
        while($script:Lines.TryDequeue([ref]$Drop)){}
        while($script:ErrLines.TryDequeue([ref]$Drop)){}
        $script:Pair=New-AgentProcess @('pair')
        $script:Pair.add_OutputDataReceived({ if($_.Data){ $script:Lines.Enqueue([string]$_.Data) } })
        $script:Pair.add_ErrorDataReceived({ if($_.Data){ $script:ErrLines.Enqueue([string]$_.Data) } })
        $script:Pair.BeginOutputReadLine()
        $script:Pair.BeginErrorReadLine()
    })
    $CancelPair.Add_Click({ Stop-Pair; $Connected.Text='已取消连接。' })
    $Refresh.Add_Click({ $Connect.PerformClick() })
    $Add.Add_Click({ $Picker=New-Object System.Windows.Forms.FolderBrowserDialog; try { if($Picker.ShowDialog() -eq 'OK' -and -not $Roots.Items.Contains($Picker.SelectedPath)){$Roots.Items.Add($Picker.SelectedPath,$false)|Out-Null} } finally{$Picker.Dispose()} })
    $Remove.Add_Click({ if($Roots.SelectedIndex -ge 0){$Roots.Items.RemoveAt($Roots.SelectedIndex)} })
    function Show-Step([int]$Step) {
        $first=$Step -eq 1; $second=$Step -eq 2; $third=$Step -eq 3; $fourth=$Step -eq 4
        foreach($Item in @($Intro,$Connect,$Code,$Clock,$Connected,$CancelPair,$Refresh,$Next1)){ $Item.Visible=$first }
        foreach($Item in @($FolderNote,$Roots,$Add,$Remove,$Next2)){ $Item.Visible=$second }
        foreach($Item in @($Auto,$Next3)){ $Item.Visible=$third }
        foreach($Item in @($Online,$Finish,$Retry)){ $Item.Visible=$fourth }
    }
    $Next1.Add_Click({ Show-Step 2 })
    $Next2.Add_Click({ Show-Step 3 })
    $Next3.Add_Click({ Show-Step 4 })
    function Complete-Setup {
        $Chosen=@($Roots.CheckedItems | ForEach-Object{[string]$_})
        $All=@($Roots.Items | ForEach-Object{[string]$_})
        $Prefs=Invoke-Agent @('settings','show')
        Invoke-Agent @('settings','set') @{machineName=$Prefs.machineName; roots=$Chosen; rootChoices=$(if($All.Count){$All}else{$Chosen}); ceiling=$Prefs.ceiling} | Out-Null
        if($Auto.Checked){ Invoke-Agent @('autostart','enable') | Out-Null } else { Invoke-Agent @('autostart','disable') | Out-Null }
        try { Invoke-Agent @('start','--background') | Out-Null } catch {}
        $Deadline=(Get-Date).AddSeconds(30)
        do {
            Start-Sleep -Seconds 1
            $Current=Invoke-Agent @('status')
            if($Current.running -and $Current.relay.status -eq 'connected'){ $Online.Text='已在线'; return }
            if($Current.relay.lastError){ $Online.Text=[string]$Current.relay.lastError }
        } while((Get-Date) -lt $Deadline)
        if(-not $Online.Text){ $Online.Text='还没有连上。' }
    }
    $Finish.Add_Click({ try{ Complete-Setup }catch{ $Online.Text=$_.Exception.Message } })
    $Retry.Add_Click({ $Finish.PerformClick() })
    $Form.Controls.AddRange(@($Intro,$Connect,$Code,$Clock,$Connected,$CancelPair,$Refresh,$Next1,$FolderNote,$Roots,$Add,$Remove,$Next2,$Auto,$Next3,$Online,$Finish,$Retry))
    Show-Step 1
    $Timer.Start()
    Signal-DesktopReady
    try{$Form.ShowDialog()|Out-Null}finally{ $Timer.Stop(); $Timer.Dispose(); Stop-Pair; $Form.Dispose() }
}

if ($Action -eq 'onboard') { Show-Onboard; exit 0 }
if ($InputData.instance -notmatch '^[a-f0-9]{24}$') { throw 'Invalid instance' }
$Mutex = New-Object System.Threading.Mutex($false,('Local\SunMoonAgentTray-' + $InputData.instance))
if (-not $Mutex.WaitOne(0,$false)) { $Mutex.Dispose(); exit 0 }

$Tray=New-Object System.Windows.Forms.NotifyIcon; $Tray.Icon=[System.Drawing.SystemIcons]::Application; $Tray.Text='SunMoon Agent'; $Tray.Visible=$true
$Menu=New-Object System.Windows.Forms.ContextMenuStrip
$Connection=$Menu.Items.Add('状态：正在读取'); $Connection.Enabled=$false
$Status=$Menu.Items.Add('查看状态与原因'); $Status.Add_Click({ Show-Status })
$Tray.Add_DoubleClick({Show-Status})
$Start=$Menu.Items.Add('启动代理'); $Start.Add_Click({ Show-Result { Invoke-Agent @('start','--background') } })
$Stop=$Menu.Items.Add('停止代理'); $Stop.Add_Click({ Show-Result { Invoke-Agent @('stop') } })
$Preferences=$Menu.Items.Add('白名单与上限设置'); $Preferences.Add_Click({ try{Show-Preferences}catch{[System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'SunMoon')|Out-Null} })
$Reconnect=$Menu.Items.Add('重新连接账号'); $Reconnect.Add_Click({
    $Ps=Join-Path $PSHOME 'powershell.exe'
    $Info=New-Object System.Diagnostics.ProcessStartInfo
    $Info.FileName=$Ps
    $Info.Arguments='-NoLogo -NoProfile -NonInteractive -File "'+$PSCommandPath+'" -Action onboard'
    $Info.UseShellExecute=$false; $Info.RedirectStandardInput=$true; $Info.CreateNoWindow=$true
    $Child=New-Object System.Diagnostics.Process; $Child.StartInfo=$Info
    $Child.Start()|Out-Null
    $Child.StandardInput.Write((@{node=$Node;cli=$Cli;state=$State;instance=$InputData.instance}|ConvertTo-Json -Compress))
    $Child.StandardInput.Close()
})
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
Signal-DesktopReady
try {[System.Windows.Forms.Application]::Run()}
finally {$Timer.Dispose(); $Tray.Visible=$false; $Tray.Dispose(); $Menu.Dispose(); Remove-Item -LiteralPath $TrayStatus -ErrorAction SilentlyContinue; $Mutex.ReleaseMutex(); $Mutex.Dispose()}
