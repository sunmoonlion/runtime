// Fixed-version native observations for the 1b follow-up. No real credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { locateCodex } from '../agent/dist/paths.js';
import { freeLoopbackPort, waitForPort } from '../agent/dist/execServer.js';
import { windowsEnvironment, windowsProfile, killWindowsTree } from '../agent/dist/windowsRuntime.js';
const require=createRequire(new URL('../agent/package.json',import.meta.url));
const WebSocket=require('ws');
if(process.platform!=='win32'||!process.env.SUNMOON_PROBE_OUTPUT)throw new Error('Native Windows and owned output required');
const output=process.env.SUNMOON_PROBE_OUTPUT,base=fs.mkdtempSync(path.join(os.homedir(),'sunmoon-contract-1c-'));
const root=path.join(base,'workspace'),home=path.join(base,'home'),temp=path.join(base,'temp');
for(const p of [root,home,temp])fs.mkdirSync(p);
fs.writeFileSync(path.join(home,'config.toml'),'sandbox_mode="read-only"\napproval_policy="never"\n[windows]\nsandbox="unelevated"\n[mcp_servers.home_canary]\nurl="https://home-canary.invalid/mcp"\n');
fs.mkdirSync(path.join(root,'.codex'));fs.writeFileSync(path.join(root,'.codex','config.toml'),'[mcp_servers.project_canary]\nurl="https://project-canary.invalid/mcp"\n');
const codex=locateCodex();if(codex.version!=='0.155.1')throw new Error('Pinned version required');
const port=await freeLoopbackPort(),url=`ws://127.0.0.1:${port}`;
const env={...windowsEnvironment(home),TEMP:temp,TMP:temp,TMPDIR:temp};
const executor=spawn(codex.codexBin,['exec-server','--listen',url],{cwd:home,env,windowsHide:true,stdio:['pipe','ignore','ignore']});
const frames=[],results=[];let ws,seq=0;const pending=new Map();
const uri=p=>pathToFileURL(p).href,sleep=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params){return new Promise((resolve,reject)=>{const id=++seq,frame={id,method,params},safe=structuredClone(frame);if(safe.params?.env)safe.params.env=Object.fromEntries(Object.keys(safe.params.env).map(k=>[k,'[REDACTED]']));frames.push({direction:'request',frame:safe});const timer=setTimeout(()=>reject(new Error(`Timeout ${method}`)),15000);pending.set(id,{resolve,timer});ws.send(JSON.stringify(frame));});}
try {
 if(!await waitForPort(port,10000,()=>executor.exitCode===null))throw new Error('executor unavailable');
 ws=new WebSocket(url);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
 ws.on('message',raw=>{const f=JSON.parse(String(raw));frames.push({direction:'response',frame:f});const p=pending.get(f.id);if(p){clearTimeout(p.timer);pending.delete(f.id);p.resolve(f);}});
 await call('initialize',{clientName:'sunmoon-1c-native',resumeSessionId:null});ws.send(JSON.stringify({method:'initialized',params:{}}));
 for(const method of ['fs/getMetadata','fs/readFile'])for(const name of ['missing.txt','absent/child.txt'])results.push({case:`${method}:${name}`,response:await call(method,{path:uri(path.join(root,name)),sandbox:null})});
 for(const cwd of [root,home])results.push({case:'environmentConfig/read',cwd,response:await call('environmentConfig/read',{cwd:uri(cwd),configPaths:[['mcp_servers']],requirementsPaths:[['mcp_servers']]})});
 fs.writeFileSync(path.join(home,'config.toml'),'sandbox_mode="read-only"\napproval_policy="never"\n[windows]\nsandbox="unelevated"\n');
 results.push({case:'environmentConfig/empty-owned',response:await call('environmentConfig/read',{cwd:uri(root),configPaths:[['mcp_servers']],requirementsPaths:[['mcp_servers']]})});
 for(const special of ['project-only','tmpdir','slash_tmp','both']){
  const processId=`special-${special}`,sandbox=windowsProfile(root,[root],'unelevated',true);
  for(const kind of special==='both'?['tmpdir','slash_tmp']:special==='project-only'?[]:[special])sandbox.permissions.file_system.entries.push({path:{type:'special',value:{kind}},access:'write'});
  const targets=[path.join(temp,`${special}.txt`),path.join(root,`${special}.txt`),path.join(base,`${special}-outside.txt`),path.join(os.tmpdir(),`sunmoon-1c-${path.basename(base)}-${special}.txt`)];
  const script=`const fs=require('fs');for(const p of ${JSON.stringify(targets)}){try{fs.writeFileSync(p,'owned');console.log(JSON.stringify({path:p,written:true}))}catch(e){console.log(JSON.stringify({path:p,code:e.code}))}}`;
  const response=await call('process/start',{processId,argv:[process.execPath,'-e',script],cwd:uri(root),env,tty:false,sandbox});
  if(!response.error){for(let i=0;i<150&&!frames.some(r=>r.frame.method==='process/closed'&&r.frame.params.processId===processId);i++)await sleep(100);}
  results.push({case:special,response,files:targets.map(p=>({path:p,exists:fs.existsSync(p)})),exited:frames.find(r=>r.frame.method==='process/exited'&&r.frame.params.processId===processId)?.frame});
  results.push({case:'terminate-after-close',processId,response:await call('process/terminate',{processId})});
  if(fs.existsSync(targets[3]))fs.unlinkSync(targets[3]);
 }
 results.push({case:'terminate-unknown',response:await call('process/terminate',{processId:'never-started'})});
}finally{
 for(const p of pending.values())clearTimeout(p.timer);ws?.terminate();await killWindowsTree(executor);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'native-contract.json'),JSON.stringify({version:codex.version,results,frames},null,2)+'\n');
 fs.rmSync(base,{recursive:true,force:true});
}
console.log(JSON.stringify(results));
