// Windows acceptance with an isolated source, synthetic files and local P-256 JWKS.
// The installed agent, live account and login tasks are never modified.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { browserProbe } from './local-browser-probe.mjs';
if (process.platform !== 'win32') throw new Error('Windows required');
const app = path.resolve(process.argv[2]);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sunmoon-local-040-'));
const root = path.join(fixture,'allowed'), home = path.join(fixture,'state','codex-home');
fs.mkdirSync(root); fs.mkdirSync(home,{recursive:true}); process.env.SUNMOON_AGENT_HOME=path.dirname(home);
const load = name => import(pathToFileURL(path.join(app,'dist',name+'.js')).href);
const { setLevel } = await load('log'); setLevel('error');
const { defaultConfig } = await load('config');
const { locateCodex } = await load('paths');
const { ExecServer } = await load('execServer');
const { WindowsTemporary, pinWindowsDirectories, runSandboxProbe, WindowsFiles, killWindowsTree } = await load('windowsRuntime');
const { LocalFiles } = await load('localFiles');
const { TicketVerifier } = await load('ticket');
const { startLocalApi } = await load('localApi');
const helper={node:process.execPath,script:path.join(app,'native','helper.mjs')}, codex=locateCodex();
assert.equal(codex.version,'0.155.1');
const temp=await WindowsTemporary.create(home,[root],helper), release=await pinWindowsDirectories(helper,[root,home],home);
const es=new ExecServer({codexBin:codex.codexBin,bwrap:null,outerSandbox:false,roots:[root],codexHome:home,port:0,windowsMode:'unelevated',windowsTemporary:temp});
const cfg={...defaultConfig(),userId:'local-api-probe',roots:[root],codexHome:home};
const webOrigin='https://investment.sunmoonai.com:30443';
const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
let keyRequests=0, keyReceivedTicket=false;
const jwks=http.createServer((req,res)=>{
  keyRequests++; keyReceivedTicket ||= !!req.headers.authorization;
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'probe-key',alg:'ES256',use:'sig'}]}));
});
await new Promise(resolve=>jwks.listen(0,'127.0.0.1',resolve));
const keyPort=jwks.address().port;
const issue=(claims={})=>{
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:'ES256',kid:'probe-key',typ:'JWT'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:'local-test-workbench',sub:cfg.userId,aud:'local-agent',iat:now,exp:now+600,jti:'test-only',...claims})).toString('base64url');
  return header+'.'+body+'.'+sign('sha256',Buffer.from(header+'.'+body),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
};
const ticket=issue(); let api, requests=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const get=async(route,headers={Origin:webOrigin,Authorization:'Bearer '+ticket},method='GET')=>{
  if(++requests%18===0) await pause(1100);
  return fetch('http://127.0.0.1:'+api.port+route,{headers,method});
};
const file=(p,extra='')=>'/local/v1/fs/file?path='+encodeURIComponent(p)+extra;
try {
  await es.start(); assert(await runSandboxProbe(es.url,home,root,'unelevated',temp.directory));
  const worker=new WindowsFiles({url:()=>es.url,home,roots:[root],mode:'unelevated',writable:false,helper,temporary:temp.directory});
  api=await startLocalApi({webOrigin,version:'0.4.0',machineName:'probe-pc',connected:()=>true,config:()=>cfg,
    files:new LocalFiles({roots:()=>cfg.roots,configDir:path.dirname(home),codexHome:home,files:worker}),
    ports:[0], // The installed agents keep their fixed ports; this test owns a random loopback listener.
    ticket:new TicketVerifier({webOrigin,userId:()=>cfg.userId,fetch:(url,init)=>{
      assert.equal(url,webOrigin+'/api/workbench/token-keys'); return fetch('http://127.0.0.1:'+keyPort+'/keys',init);
    }})});
  assert(api);
  const presence=await get('/presence',{Origin:webOrigin}); assert.equal(presence.status,200);
  assert.deepEqual(Object.keys(await presence.json()).sort(),['agent','connected','machine_name','version']); assert.equal(keyRequests,0);
  assert.equal((await get('/local/v1/info',{Origin:webOrigin})).status,401);
  assert.equal((await get('/local/v1/info',{})).status,403);
  const wrongOrigin=await get('/local/v1/info',{Origin:'https://example.com',Authorization:'Bearer '+ticket});
  assert.equal(wrongOrigin.status,403); assert.equal(wrongOrigin.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal((await (await get('/local/v1/info')).json()).userId,cfg.userId);
  const preflight=await get('/local/v1/fs/file',{Origin:webOrigin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization,content-type'},'OPTIONS');
  assert.equal(preflight.status,204); assert.equal(preflight.headers.get('Access-Control-Allow-Methods'),'GET, POST, PUT');
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'),'Authorization, Content-Type'); assert.equal(preflight.headers.get('Access-Control-Allow-Private-Network'),'true'); assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
  const text=path.join(root,'中文文件.md'); fs.writeFileSync(text,'# 本机回环读取成功\n');
  assert.equal(await (await get(file(text))).text(),'# 本机回环读取成功\n');
  assert.equal((await (await get('/local/v1/fs/meta?path='+encodeURIComponent(text))).json()).type,'file');
  assert((await (await get('/local/v1/fs/dir?path='+encodeURIComponent(root))).json()).entries.some(e=>e.name==='中文文件.md'));
  const target=path.join(root,'large'), original=Buffer.alloc(5*1024*1024,191), chunks=[]; fs.writeFileSync(target,original);
  for(let i=0;i<5;i++){
    const response=await get(file(target,'&offset='+i*1048576)); assert.equal(response.status,200);
    assert.equal(response.headers.get('Content-Type'),'application/octet-stream'); assert.equal(response.headers.get('X-File-Size'),String(original.length));
    assert.equal(response.headers.get('X-File-Eof'),String(i===4)); assert(response.headers.get('X-File-Mtime')); assert(response.headers.get('Access-Control-Expose-Headers').includes('X-File-Eof'));
    chunks.push(Buffer.from(await response.arrayBuffer()));
  }
  assert(Buffer.concat(chunks).equals(original));
  for(const outside of [path.join(os.homedir(),'.codex','config.toml'),path.join(fixture,'outside'),path.join(home,'config.toml')]) assert.equal((await get(file(outside))).status,403);
  for(const claims of [{sub:'another-user'},{aud:'relay'},{exp:1}]) assert.equal((await get('/local/v1/info',{Origin:webOrigin,Authorization:'Bearer '+issue(claims)})).status,401);
  assert.equal((await get(file(target,'&length=1048577'))).status,400);
  assert.equal((await get(file(path.join(root,'missing')))).status,404);
  const outsideDir=path.join(fixture,'outside-dir'); fs.mkdirSync(outsideDir); fs.writeFileSync(path.join(outsideDir,'private'),'private');
  const junction=path.join(root,'junction'); fs.symlinkSync(outsideDir,junction,'junction'); assert.equal((await get(file(path.join(junction,'private')))).status,403);
  const hardlink=path.join(root,'hardlink'); fs.linkSync(path.join(outsideDir,'private'),hardlink); assert.equal((await get(file(hardlink))).status,403);
  for(const alias of [text+':stream',root+'\\NAME~1.md',root+'\\CON','\\\\?\\'+text]) assert.equal((await get(file(alias))).status,403);
  const huge=path.join(root,'huge'); fs.closeSync(fs.openSync(huge,'w')); fs.truncateSync(huge,64*1024*1024+1); assert.equal((await get(file(huge))).status,413);
  const many=path.join(root,'many'); fs.mkdirSync(many); for(let i=0;i<2001;i++)fs.writeFileSync(path.join(many,'文件'+i),'');
  const listing=await (await get('/local/v1/fs/dir?path='+encodeURIComponent(many))).json(); assert.equal(listing.entries.length,2000); assert.equal(listing.truncated,true); assert(listing.entries.every(e=>e.name.startsWith('文件')));
  assert.equal(keyRequests,1); assert.equal(keyReceivedTicket,false);
  let browser={browser_checked:false};
  if(process.argv.includes('--browser')){await pause(1100);browser=await browserProbe({app,fixture,origin:webOrigin,apiPort:api.port,ticket,target:text,expected:'# 本机回环读取成功\n',killTree:killWindowsTree});}
  console.log(JSON.stringify({stage:'local-1',platform:'win32',agent:'0.4.0',codex:codex.version,sandbox:'unelevated',port:api.port,jwks:'local-self-signed',presence_without_ticket:true,missing_ticket_401:true,missing_origin_403:true,wrong_origin_no_cors:true,invalid_tickets_401:true,preflight:true,chinese_read:true,metadata:true,directory:true,raw_segments:5,reassembled:true,file_headers:true,directory_limit:true,junction_denied:true,hardlink_denied:true,aliases_denied:true,too_large_413:true,oversized_length_400:true,not_found_404:true,jwks_requests:keyRequests,ticket_sent_to_jwks:false,production_ticket:false,...browser}));
} finally {
  await api?.close(); await es.stop(); await release.close(); await temp.close();
  await new Promise(resolve=>{jwks.close(()=>resolve());jwks.closeAllConnections();});
  fs.rmSync(fixture,{recursive:true,force:true,maxRetries:20,retryDelay:200});
}
