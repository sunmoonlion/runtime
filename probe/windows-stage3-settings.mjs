// Native WinForms regression, synthetic local configuration only.
// Executes the shipped settings/status functions unchanged, not the tray loop.
// Never opens or answers the permission/UAC dialogs. No real token or relay.
// node windows-stage3-settings.mjs <agent source or packaged app directory>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const [agent] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.ok(path.isAbsolute(agent));
const base = fs.mkdtempSync(path.join(os.homedir(), 'sunmoon-settings-test-'));
const home = path.join(base, 'agent'), roots = ['selected', 'unchecked'].map(n => path.join(base, n));
roots.forEach(r => fs.mkdirSync(r));
const cli = path.join(agent, 'dist/cli.js');
const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const env = { ...process.env, SUNMOON_AGENT_HOME: home };
function run(args, input) {
  const r = spawnSync(process.execPath, [cli, ...args], { env, input, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
const fixture = path.join(base, 'settings.ps1'), closeNotice = path.join(base, 'notice.ps1');
// PowerShell parses UTF-8 Chinese correctly with a BOM. Load only the three
// named production functions by AST; no copy of their implementation here.
fs.writeFileSync(fixture, '\uFEFF' + String.raw`
param([string]$Node,[string]$Cli,[string]$State,[string]$Desktop,[int]$Round)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Tokens=$null;$Errors=$null
$Ast=[Management.Automation.Language.Parser]::ParseFile($Desktop,[ref]$Tokens,[ref]$Errors)
if($Errors.Count){throw 'Production script parse failed'}
foreach($Name in @('Invoke-Agent','Show-Preferences','Get-ConnectionText')){
  $Definition=@($Ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name},$false))
  if($Definition.Count -ne 1){throw 'Function missing or ambiguous'}
  . ([ScriptBlock]::Create($Definition[0].Extent.Text))
}
$Cases=@(
  @{Input=$null;Text='已停止'},
  @{Input=@{running=$true;relay=@{status='connected'}};Text='在线'},
  @{Input=@{running=$true;relay=@{status='connecting'}};Text='正在连接'},
  @{Input=@{running=$true;relay=@{status='disconnected'}};Text='离线，等待重连'},
  @{Input=@{running=$false;relay=@{status='connected'}};Text='已停止或状态过期'},
  @{Input=@{running=$false;relay=@{status='rejected'}};Text='连接被拒绝，代理已停止'}
)
foreach($Case in $Cases){if((Get-ConnectionText $Case.Input) -cne $Case.Text){throw 'Status text mismatch'}}
$script:Failure=$null;$script:Visited=$false
$Timer=New-Object System.Windows.Forms.Timer;$Timer.Interval=300
$Timer.Add_Tick({
  $Window=@([System.Windows.Forms.Application]::OpenForms|Where-Object {$_.Text -eq 'SunMoon - 本机设置'})
  if($Window.Count -ne 1){return}
  $Timer.Stop();$script:Visited=$true;$Dialog=$Window[0]
  try{
    $List=$Dialog.Controls['DirectoryChoices']
    if($List -isnot [System.Windows.Forms.CheckedListBox] -or $List.Items.Count -ne 2){throw 'Expected two real checkbox rows'}
    $Expected=if($Round -eq 1){@(0)}elseif($Round -eq 2){@(1)}else{@()}
    if(($List.CheckedIndices -join ',') -cne ($Expected -join ',')){throw 'Saved selection did not reopen correctly'}
    if($Round -eq 3){$Dialog.Close();return}
    $List.SetItemChecked(0,$false);$List.SetItemChecked(1,($Round -eq 1))
    $Dialog.Controls['SaveSettings'].PerformClick()
  }catch{$script:Failure=$_.Exception.Message;$Dialog.Close()}
})
$Timer.Start()
try{Show-Preferences}finally{$Timer.Dispose()}
if($script:Failure){throw $script:Failure}
if(-not $script:Visited){throw 'Settings dialog not exercised'}
@{pass=$true;round=$Round;statusCases=$Cases.Count}|ConvertTo-Json -Compress
`);
// Close ONLY the harmless save-result message box in our exact fixture PID.
// This never interacts with a permission prompt or another process's window.
fs.writeFileSync(closeNotice, '\uFEFF' + String.raw`
param([int]$FixturePid)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$Condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$FixturePid)
$Deadline=(Get-Date).AddSeconds(20)
while((Get-Date) -lt $Deadline){
  if(-not (Get-Process -Id $FixturePid -ErrorAction SilentlyContinue)){exit 0}
  $Windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$Condition)
  foreach($Window in $Windows){
    if($Window.Current.Name -cne 'SunMoon'){continue}
    # This informational dialog may not expose its native IDOK child to UIA.
    # Closing the exact fixture window is sufficient; the settings are saved.
    $Window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
    exit 0
  }
  Start-Sleep -Milliseconds 100
}
throw 'Save notice did not appear'
`);
let success = false;
try {
  run(['init', '--relay', 'ws://127.0.0.1:1', '--user', 'settings-fixture', '--token', 'synthetic-not-a-credential', '--root', roots[0]]);
  const prefs = JSON.parse(run(['settings', 'show']));
  run(['settings', 'set'], JSON.stringify({ ...prefs, rootChoices: roots }));
  const rounds = [];
  for (const round of [1, 2, 3]) {
    const child = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture,
      '-Node', process.execPath, '-Cli', cli, '-State', home, '-Desktop', path.join(agent, 'native/desktop.ps1'), '-Round', String(round)],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
    const timer = setTimeout(() => child.kill(), 30000);
    let closer, closerError='';
    if (round < 3) {
      closer = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', closeNotice, '-FixturePid', String(child.pid)], { env, windowsHide: true, stdio: ['ignore','ignore','pipe'] });
      closer.stderr.on('data',d=>closerError+=d);
    }
    const closed = closer && new Promise(resolve => closer.on('close', code => resolve(code)));
    try {
      assert.equal(await done, 0, err+'\nSave notice helper: '+closerError);
      if (closed) assert.equal(await closed, 0, 'Exact save notice close failed: '+closerError);
      rounds.push(JSON.parse(out.trim()));
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill(); if (closer?.exitCode === null) closer.kill(); }
    const saved = JSON.parse(run(['settings', 'show']));
    assert.deepEqual(saved.roots, round === 1 ? [roots[1]] : []);
    assert.deepEqual(saved.rootChoices, roots);
  }
  success = true;
  console.log(JSON.stringify({ pass: true, rounds, settingsSource: 'unchanged production AST functions',
    realCliPersistence: true, permissionDialogUsed: false, realAccountUsed: false, base }, null, 2));
} finally {
  if (success) fs.rmSync(base, { recursive: true, force: true });
  else console.error('Isolated settings fixture retained: ' + base);
}
