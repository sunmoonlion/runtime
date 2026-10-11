import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installationProcesses, stopInstallationProcesses} from '../uninstall.mjs';
const root='C:\\Users\\owner\\Programs\\sunmoon-agent', sid='S-1-test';
const record=(pid,executable,command,user=sid)=>({pid,executable,command,sid:user,created:'2026-10-11T00:00:00Z'});
test('only exact installation scripts of this user qualify',()=>{
  const records=[
    record(1,root+'\\node\\node.exe',`"${root}\\node\\node.exe" "${root}\\app\\dist\\cli.js" onboard-window`),
    record(2,'C:\\Windows\\powershell.exe',`powershell -File "${root}\\app\\native\\desktop.ps1" -Action onboard`),
    record(3,root+'\\node\\node.exe',`node "${root}\\app\\dist\\cli.js.evil"`),
    record(4,root+'-other\\node\\node.exe',`node "${root}-other\\app\\dist\\cli.js"`),
    record(5,root+'\\node\\node.exe',`node "${root}\\app\\dist\\cli.js"`,'other-user'),
  ];
  const selected=installationProcesses(records,root,sid);
  assert.deepEqual(selected.owned.map(p=>p.pid),[1,2]);
  assert.deepEqual(selected.blocked.map(p=>p.pid),[3]);
});
test('spaces, case and slash normalization do not widen script boundary',()=>{
  const dir='C:\\With Space\\sunmoon-agent';
  assert.equal(installationProcesses([record(6,dir+'\\node\\NODE.EXE',`node "${dir.toUpperCase()}\\app\\dist\\cli.js"`) ],dir,sid).owned.length,1);
  assert.equal(installationProcesses([record(7,dir+'\\node\\node.exe',`node "${dir}\\app\\dist\\cli.js\\extra"`)],dir,sid).blocked.length,1);
});
test('unidentified ownership fails closed',()=>{
  assert.throws(()=>installationProcesses([record(8,root+'\\node\\node.exe','node',null)],root,sid),/owner/);
});
test('blockers are reported without killing and secrets are redacted',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sunmoon-proc-test-'));
  t.after(()=>fs.rmdirSync(dir));let calls=0;
  const item=record(9,dir+'\\node.exe','node --token synthetic-private');
  assert.throws(()=>stopInstallationProcesses(dir,()=>{calls++;return{sid,records:[item]};},()=>{}),e=>/PID 9/.test(e.message)&&!e.message.includes('synthetic-private'));
  assert.equal(calls,1);
});
test('waits for exact selected processes and reports their IDs',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sunmoon-proc-test-'));
  t.after(()=>fs.rmdirSync(dir));const item=record(10,dir+'\\node.exe',`node "${path.win32.join(dir,'app','dist','cli.js')}"`);
  let calls=0, killed;
  const result=stopInstallationProcesses(dir,(_,expected)=>{calls++;if(expected){killed=expected;return{sid,records:[]};}return{sid,records:calls===1?[item]:[]};},()=>{});
  assert.deepEqual(killed,[item]);assert.deepEqual(result.stoppedPids,[10]);
});
