// Native, isolated installation acceptance. Never uses a real relay/account.
// node windows-stage3-package.mjs <external bundle> <trusted manifest hash>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
if(process.platform!=='win32')throw new Error('Native Windows only');
const [bundle,hash]=process.argv.slice(2);
assert.match(hash??'',/^[a-f0-9]{64}$/);
const base=fs.mkdtempSync(path.join(os.homedir(),'sunmoon-package-test-'));
const profile=path.join(base,'Profile'),local=path.join(base,'Local'),root=path.join(base,'workspace');
for(const d of [profile,local,root])fs.mkdirSync(d);
const home=path.join(profile,'.sunmoon-agent'),target=path.join(local,'Programs','sunmoon-agent');
const env={...process.env,USERPROFILE:profile,LOCALAPPDATA:local,SUNMOON_AGENT_HOME:home,PATH:path.join(process.env.SystemRoot,'System32')};
const node=path.join(bundle,'node/node.exe'),installedNode=path.join(target,'node/node.exe'),cli=path.join(target,'app/dist/cli.js');
const checks=[];
const run=(bin,args,options={})=>{const r=spawnSync(bin,args,{env,windowsHide:true,encoding:'utf8',timeout:90000,...options});if(r.status!==0)throw new Error(`isolated ${path.basename(bin)} ${args[0]} failed: ${r.error?.code??r.status}\n${r.stderr??''}`);return r.stdout.trim();};
const json=(bin,args)=>JSON.parse(run(bin,args));
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const install=apply=>json(node,[path.join(bundle,'installer/install.mjs'),'--manifest-sha256',hash,...(apply?['--apply']:[])]);
const uninstall=(apply,purge=false)=>json(node,[path.join(bundle,'installer/uninstall.mjs'),'--manifest-sha256',hash,...(apply?['--apply']:[]),...(purge?['--remove-config']:[])]);
let completed=false;
try{
  assert.equal(run(node,['-p','require("os").homedir()']),profile);
  assert.equal(install(false).action,'preview');assert.equal(fs.existsSync(target),false);install(true);
  assert.equal(run(installedNode,['--version']),'v24.19.0');assert.equal(run(installedNode,[cli,'--version']),'0.2.0');checks.push('install + bundled Node/CLI versions without Node PATH');
  run(installedNode,[cli,'init','--relay','ws://127.0.0.1:1','--user','isolated-package-test','--token','synthetic-package-not-a-credential','--root',root]);
  const configSha=sha(path.join(home,'config.json'));
  run(installedNode,[cli,'start','--background']);assert.equal(json(installedNode,[cli,'status']).running,true);
  const tray=spawn(installedNode,[cli,'tray'],{env,windowsHide:true,stdio:'ignore'});tray.unref();
  for(let n=0;n<100&&!fs.existsSync(path.join(home,'tray.json'));n++)await new Promise(r=>setTimeout(r,100));
  assert.equal(fs.existsSync(path.join(home,'tray.json')),true);
  const task=json(installedNode,[cli,'autostart','enable']);assert.equal(task.installed,true);
  assert.equal(uninstall(false).action,'preview');assert.equal(json(installedNode,[cli,'status']).running,true);
  uninstall(true);assert.equal(fs.existsSync(target),false);assert.equal(sha(path.join(home,'config.json')),configSha);
  assert.equal(fs.existsSync(path.join(home,'tray.json')),false);checks.push('uninstall preview read-only; running agent + tray + matching task removed; config preserved');
  // Reinstall the same verified package: manual-upgrade/config-preservation path.
  install(true);assert.equal(sha(path.join(home,'config.json')),configSha);run(installedNode,[cli,'start','--background']);run(installedNode,[cli,'stop']);
  uninstall(true,true);assert.equal(fs.existsSync(target),false);assert.equal(fs.existsSync(home),false);
  assert.equal(fs.existsSync(root),true);checks.push('reinstall uses retained config; explicit default-home purge; project retained');
  // Query exactly our prior task; do not enumerate command lines or other users.
  const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  assert.equal(run(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',`if(Get-ScheduledTask -TaskName '${task.name}' -ErrorAction SilentlyContinue){exit 1}`]),'');
  checks.push('no matching login task remains');completed=true;
  console.log(JSON.stringify({pass:true,manifestSha256:hash,checks,base,realAccountUsed:false,realUserConfigTouched:false,administrator:false},null,2));
}finally{
  // Only remove the owned fixture after successful uninstall. Failure preserves diagnostics.
  if(completed)fs.rmSync(base,{recursive:true,force:true});
  else console.error(`Isolated fixture retained for recovery: ${base}`);
}
