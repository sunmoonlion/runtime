// Run from an independently verified distribution, never from the installed executable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { plainDirectory, verifyBundle, removeVerifiedBundle } from './bundle.mjs';
import { applyLaunchEnv, nodeLaunch } from './launch.mjs';

function readTrayControl(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 1024) throw new Error('Unsafe tray status');
  const current = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!Number.isInteger(current.pid) || current.pid <= 0 || !/^[a-f0-9-]{36}$/.test(current.runId)) throw new Error('Invalid tray status');
  return current;
}

function removePlainControl(file) {
  if (!fs.existsSync(file)) return;
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new Error('Unsafe tray status');
  fs.unlinkSync(file);
}

// Same rule as the resident tray stop: a leftover file whose recorded process is
// gone is removed here, because the installed CLI may be too old to do it.
export function clearStaleTray(directory, alive) {
  const file = path.join(directory, 'tray.json'), stop = path.join(directory, 'tray-stop.json');
  if (fs.existsSync(stop)) {
    const current = readTrayControl(stop);
    if (!alive(current.pid)) { removePlainControl(stop); removePlainControl(file); return 'cleared'; }
    return 'pending';
  }
  if (fs.existsSync(file)) {
    const current = readTrayControl(file);
    if (!alive(current.pid)) { removePlainControl(file); return 'cleared'; }
  }
  return 'continue';
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

const winPath = value => path.win32.normalize(value ?? '').toLowerCase();
function commandHasPath(command, file) {
  const escaped = winPath(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s"])${escaped}(?=$|[\\s"])`).test((command ?? '').replaceAll('/', '\\').toLowerCase());
}
/** Identity classifier, separately tested without terminating processes. */
export function installationProcesses(records, directory, userSid) {
  const root = winPath(directory), cli = path.win32.join(root, 'app','dist','cli.js');
  const desktop = path.win32.join(root, 'app','native','desktop.ps1');
  const owned = [], blocked = [];
  for (const record of records) {
    const executable = winPath(record.executable);
    const inside = executable.startsWith(root + '\\');
    const desktopCommand = /^(powershell|pwsh)\.exe$/.test(path.win32.basename(executable)) && commandHasPath(record.command, desktop);
    if (!inside && !desktopCommand) continue;
    if (!record.sid) throw new Error(`Cannot establish owner for process ${record.pid}; no process terminated`);
    if (record.sid !== userSid) continue;
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || !record.created) throw new Error('Invalid process identity');
    const ownNode = inside && path.win32.basename(executable) === 'node.exe' && commandHasPath(record.command, cli);
    (ownNode || desktopCommand ? owned : blocked).push(record);
  }
  return { owned, blocked };
}
function windowsProcessRequest(directory, expected = null) {
  const script = `
$ErrorActionPreference='Stop'
$Sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$Expected=$env:SUNMOON_UNINSTALL_EXPECTED | ConvertFrom-Json
if ($Expected) {
  foreach ($Record in @($Expected)) {
    $P=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$Record.pid)
    if (-not $P) { continue }
    $Owner=Invoke-CimMethod -InputObject $P -MethodName GetOwnerSid
    if ($Owner.ReturnValue -ne 0 -or $Owner.Sid -ne $Sid -or $P.CreationDate.ToUniversalTime().ToString('o') -ne $Record.created -or $P.ExecutablePath -ne $Record.executable -or $P.CommandLine -cne $Record.command) { throw 'Process identity changed; refusing termination' }
    Stop-Process -Id $P.ProcessId -ErrorAction Stop
  }
}
$Records=@(foreach ($P in Get-CimInstance Win32_Process) {
  if (-not ($P.ExecutablePath -and $P.ExecutablePath.StartsWith($env:SUNMOON_UNINSTALL_ROOT+'\\',[StringComparison]::OrdinalIgnoreCase)) -and -not ($P.CommandLine -and $P.CommandLine.IndexOf($env:SUNMOON_UNINSTALL_ROOT,[StringComparison]::OrdinalIgnoreCase) -ge 0)) { continue }
  $Owner=Invoke-CimMethod -InputObject $P -MethodName GetOwnerSid
  [pscustomobject]@{pid=[int]$P.ProcessId; executable=$P.ExecutablePath; command=$P.CommandLine; created=$P.CreationDate.ToUniversalTime().ToString('o'); sid=$(if($Owner.ReturnValue -eq 0){$Owner.Sid}else{$null})}
})
@{sid=$Sid;records=$Records} | ConvertTo-Json -Depth 5 -Compress
`;
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const result = spawnSync(executable, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], {
    env: {...process.env, SUNMOON_UNINSTALL_ROOT:directory, SUNMOON_UNINSTALL_EXPECTED:JSON.stringify(expected)}, windowsHide:true, encoding:'utf8', timeout:30000,
  });
  if (result.status !== 0) throw new Error('Cannot enumerate/stop installation processes; files kept');
  return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
}
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function safeCommand(command) {
  return String(command ?? '').replace(/(--?(?:token|secret|password|device-secret)(?:=|\s+))\S+/gi,'$1[redacted]');
}
export function stopInstallationProcesses(directory, request = windowsProcessRequest, wait = pause) {
  plainDirectory(directory);
  const before = request(directory);
  const selected = installationProcesses(before.records,directory,before.sid);
  const refuse = records => { if(records.length) throw new Error('有进程占着安装目录: '+records.map(p=>`PID ${p.pid} ${safeCommand(p.command)}`).join('; ')); };
  refuse(selected.blocked);
  if (selected.owned.length) request(directory, selected.owned);
  for (let attempt=0; attempt<=20; attempt++) {
    const current = request(directory), remaining = installationProcesses(current.records,directory,current.sid);
    refuse(remaining.blocked);
    if (!remaining.owned.length) return {stoppedPids:selected.owned.map(p=>p.pid)};
    if (attempt === 20) throw new Error('Installation processes did not exit; files kept');
    wait(500);
  }
}

function main() {
try {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, 'remove-config': { type: 'boolean', default: false }, 'stop-only': { type:'boolean',default:false },
    'manifest-sha256': { type: 'string' }, 'installed-manifest-sha256': { type: 'string' },
  }, allowPositionals: false, strict: true });
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('Windows is required');
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  verifyBundle(source, values['manifest-sha256']);
  const target = path.join(plainDirectory(process.env.LOCALAPPDATA), 'Programs', 'sunmoon-agent');
  if (path.relative(target, source) === '' || !path.relative(target, source).startsWith('..')) throw new Error('Use the external distribution to uninstall');
  if (values['stop-only']) {
    if (values['remove-config']) throw new Error('Repair must preserve config');
    plainDirectory(target);
    // A broken install is untrusted: never run its executable/CLI. The verified
    // external package performs identity collection, without deleting files.
    const result = values.apply ? stopInstallationProcesses(target) : {stoppedPids:[]};
    console.log(JSON.stringify({action:'stop-only',preserveConfig:true,...result})); return;
  }
  const expected = values['installed-manifest-sha256'] ?? values['manifest-sha256'];
  verifyBundle(target, expected, { requireLayout: false });
  const state = process.env.SUNMOON_AGENT_HOME ?? path.join(os.homedir(), '.sunmoon-agent');
  const plan = { action: values.apply ? 'uninstall' : 'preview', target, preserveConfig: !values['remove-config'], stopsOnlyThisAgent: true };
  // Config deletion is intentionally narrower than configurable runtime homes.
  // It can only remove the standard dedicated home, never an arbitrary supplied directory.
  const configEntries = [];
  const logs = path.join(process.env.LOCALAPPDATA,'sunmoon-agent','logs');
  const ownedLogs = () => {
    if(!fs.existsSync(logs))return [];
    plainDirectory(logs);
    return ['agent.log','agent.log.1','agent.log.2','agent.log.3','agent.log.4'].map(n=>path.join(logs,n)).filter(file=>{
      if(!fs.existsSync(file))return false;
      const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw new Error('Linked log refused');return true;
    });
  };
  const inspectConfig = () => {
    if (!fs.existsSync(state)) return;
    if (path.resolve(state).toLowerCase() !== path.join(os.homedir(), '.sunmoon-agent').toLowerCase()) throw new Error('Config removal only supports the dedicated default home; custom test homes are preserved');
    plainDirectory(state);
    const allowed = new Set(['config.json','mcp.json','status.json','codex-home','logs','tray.json','tray-stop.json','stop-request.json','pair-status.json','onboard-ready.json']);
    for (const name of fs.readdirSync(state)) if (!allowed.has(name)) throw new Error('Unexpected user data in config home; refusing deletion');
    const walk = dir => { plainDirectory(dir); for (const name of fs.readdirSync(dir)) { const file=path.join(dir,name), st=fs.lstatSync(file); if(st.isSymbolicLink())throw new Error('Linked config data; refusing deletion');if(st.isDirectory())walk(file);else if(st.isFile())configEntries.push(file);else throw new Error('Unsupported config entry');} configEntries.push(dir); };
    walk(state);
  };
  if (values['remove-config']) { inspectConfig(); ownedLogs(); }
  if (!values.apply) { console.log(JSON.stringify(plan)); process.exit(0); }
  if (fs.existsSync(path.join(state, 'config.json'))) {
    // Task identity contains the installed executable path. These short-lived
    // children must use that exact node.exe, then exit before file removal.
    // This uninstaller itself continues running from the external bundle.
    const invoke = args => {
      const launch = nodeLaunch(target);
      const r = spawnSync(path.join(target, 'node/node.exe'), [...launch.execArgv, path.join(target, 'app/dist/cli.js'), ...args], {
        env: { ...applyLaunchEnv(process.env, launch), SUNMOON_AGENT_HOME: state }, windowsHide: true, encoding: 'utf8', timeout: 45000,
      });
      if (r.status !== 0) throw new Error(`Cannot complete ${args[0]}; installation and config kept`);
    };
    // Remove restart policy before stopping. A failed step keeps program files.
    invoke(['autostart','disable']); clearStaleTray(state, pidAlive);
    // Older desktop workers may no longer respond to graceful requests. The
    // exact-identity collector below is the authorized fallback for these only.
    for (const args of [['tray','stop'],['stop']]) {
      try { invoke(args); } catch { console.error(`${args[0]} graceful stop unavailable; checking exact owned PIDs`); }
    }
  }
  stopInstallationProcesses(target);
  removeVerifiedBundle(target,expected,true);
  if(values['remove-config']) {
    configEntries.length=0; inspectConfig();
    for(const file of configEntries){const st=fs.lstatSync(file);if(st.isSymbolicLink())throw new Error('Config changed during removal');if(st.isDirectory())fs.rmdirSync(file);else fs.unlinkSync(file);}
    for(const file of ownedLogs())fs.unlinkSync(file);
    if(fs.existsSync(logs)&&fs.readdirSync(logs).length===0)fs.rmdirSync(logs);
  }
  console.log(JSON.stringify({...plan,result:'removed'}));
} catch(error){console.error(`Uninstall stopped: ${error.message}`);process.exitCode=1;}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
