// Isolated Edge profile; never reads the owner's cookies or changes browser policy.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

export async function browserProbe({app,fixture,origin,apiPort,ticket,target,expected,killTree}) {
  const WebSocket=createRequire(path.join(app,'package.json'))('ws');
  const candidates=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles].filter(Boolean).map(root=>path.join(root,'Microsoft','Edge','Application','msedge.exe'));
  const executable=candidates.find(value=>fs.existsSync(value)); if(!executable) throw new Error('Edge unavailable');
  const profile=path.join(fixture,'isolated-browser');
  const child=spawn(executable,['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
  let socket; const pending=new Map(); let id=0;
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const request=++id, timer=setTimeout(()=>{pending.delete(request);reject(new Error('Browser probe timed out'));},15000);
    pending.set(request,{resolve,reject,timer});socket.send(JSON.stringify({id:request,method,params}));
  });
  try {
    const file=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<150&&!fs.existsSync(file);i++) await new Promise(resolve=>setTimeout(resolve,100));
    if(!fs.existsSync(file)) throw new Error('Browser debugging unavailable');
    const port=Number(fs.readFileSync(file,'utf8').split(/\r?\n/)[0]);
    const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    const page=pages.find(page=>page.type==='page'); if(!page) throw new Error('Browser page unavailable');
    socket=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    socket.on('message',raw=>{const reply=JSON.parse(String(raw)),waiting=pending.get(reply.id);if(!waiting)return;clearTimeout(waiting.timer);pending.delete(reply.id);reply.error?waiting.reject(new Error('Browser protocol rejected operation')):waiting.resolve(reply.result);});
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate',{url:origin+'/api/workbench/token-keys'});
    const evaluate=async expression=>{
      const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails) throw new Error('Browser evaluation failed');return result.result.value;
    };
    let actualOrigin;
    for(let i=0;i<100;i++){actualOrigin=await evaluate('location.origin');if(actualOrigin===origin)break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(actualOrigin,origin);
    const permission=await evaluate('navigator.permissions.query({name:"local-network-access"}).then(p=>p.state).catch(()=>"unsupported")');
    if(permission==='prompt') await send('Browser.setPermission',{permission:{name:'local-network-access'},setting:'granted',origin});
    // Only synthetic bytes are read. The protocol result returns booleans, no ticket/path/content.
    const url='http://127.0.0.1:'+apiPort+'/local/v1/fs/file?path='+encodeURIComponent(target);
    const result=await evaluate('(async()=>{const response=await fetch('+JSON.stringify(url)+',{headers:{Authorization:'+JSON.stringify('Bearer '+ticket)+'},targetAddressSpace:"loopback"});const bytes=await response.arrayBuffer();return{status:response.status,textMatches:new TextDecoder().decode(bytes)==='+JSON.stringify(expected)+',size:response.headers.get("X-File-Size"),mtime:response.headers.get("X-File-Mtime"),eof:response.headers.get("X-File-Eof"),credentials:response.headers.get("Access-Control-Allow-Credentials")};})()');
    assert.equal(result.status,200);assert.equal(result.textMatches,true);assert(result.size);assert(result.mtime);assert.equal(result.eof,'true');assert.equal(result.credentials,null);
    return {edge_cross_origin_read:true,edge_metadata_headers:true,isolated_profile:true,test_profile_local_network_permission:permission==='prompt'?'granted-for-test':permission};
  } finally {
    if(socket?.readyState===WebSocket.OPEN) await send('Browser.close').catch(()=>{});
    socket?.terminate();for(const value of pending.values()){clearTimeout(value.timer);value.reject(new Error('Browser closed'));}pending.clear();
    await killTree(child); await new Promise(resolve=>setTimeout(resolve,300));
  }
}
