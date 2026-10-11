import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

for (const action of ['onboard','tray']) test(`real Windows ${action} exits and clears readiness after UI disposal`, {skip:process.platform!=='win32',timeout:20000}, async t=>{
  const base=fs.mkdtempSync(path.join(process.env.SUNMOON_PROBE_ROOT ?? os.tmpdir(),'sunmoon-watchdog-'));
  let passed=false;
  t.after(()=>{if(passed)fs.rmSync(base,{recursive:true,force:true});else console.log(`Failed watchdog fixture retained: ${base}`);});
  const source=fs.readFileSync(new URL('../../native/desktop.ps1',import.meta.url),'utf8');
  const disposed=path.join(base,'disposed-at.txt');
  const injection=`
$TestDispose=New-Object System.Windows.Forms.Timer; $TestDispose.Interval=300
$TestDispose.Add_Tick({
  $TestDispose.Stop()
  [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() | Set-Content -LiteralPath '${disposed.replaceAll("'","''")}'
  ${action==='onboard'?'$Form':'$TrayForm'}.Dispose()
})
$TestDispose.Start()
`;
  const needle=action==='onboard'?'try{$Watch.Start(); $Timer.Start(); $Form.ShowDialog()':'\n$Watch.Start(); $Timer.Start()\n';
  assert.ok(source.includes(needle));
  assert.equal(source.split(needle).length,2,'exactly one lifecycle injection point');
  const trace=path.join(base,'watchdog-ticks.txt').replaceAll("'","''");
  const debug=source.replace('if ($Window.IsDisposed -or -not $Window.IsHandleCreated)',`@{disposed=$Window.IsDisposed;handle=$Window.IsHandleCreated} | ConvertTo-Json -Compress | Add-Content -LiteralPath '${trace}'\n        if ($Window.IsDisposed -or -not $Window.IsHandleCreated)`);
  const file=path.join(base,'desktop.ps1');fs.writeFileSync(file,debug.replace(needle,injection+needle));
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',file,'-Action',action],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
  child.stdin.end(JSON.stringify({node:process.execPath,cli:path.join(base,'unused-cli.js'),state:base,instance:'0'.repeat(24)}));
  t.after(()=>{if(child.exitCode===null)child.kill();});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,stderr);
  const elapsed=Date.now()-Number(fs.readFileSync(disposed,'utf8').trim());
  assert.ok(elapsed<2000,`exit after disposal ${elapsed}ms`);
  for(const marker of ['onboard-ready.json','tray.json'])assert.equal(fs.existsSync(path.join(base,marker)),false);
  console.log(JSON.stringify({action,exitCode:code,elapsedAfterDisposeMs:elapsed,readyCleared:true}));
  passed=true;
});
