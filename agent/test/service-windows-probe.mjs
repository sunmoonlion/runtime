// Manual stage-1 acceptance against the unmodified local relay, never the live account.
// node service-windows-probe.mjs <isolated-source-app> <local-relay-url>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
if (process.platform !== 'win32') throw new Error('Windows required');
const app = path.resolve(process.argv[2]), relayUrl = process.argv[3];
if (!/^ws:\/\/(127\.0\.0\.1|localhost|172\.[0-9.]+):\d+$/.test(relayUrl)) throw new Error('Local test relay required');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sunmoon-service-040-'));
const root = path.join(fixture, 'allowed'), home = path.join(fixture, 'state', 'codex-home');
fs.mkdirSync(root); fs.mkdirSync(home, { recursive: true });
process.env.SUNMOON_AGENT_HOME = path.dirname(home);
const load = name => import(pathToFileURL(path.join(app, 'dist', name+'.js')).href);
const { setLevel } = await load('log'); setLevel('error');
const { locateCodex } = await load('paths');
const { ExecServer } = await load('execServer');
const { WindowsTemporary, pinWindowsDirectories, runSandboxProbe } = await load('windowsRuntime');
const { RelayClient } = await load('relayClient');
const WebSocket = createRequire(path.join(app, 'package.json'))('ws');
const helper = { node: process.execPath, script: path.join(app, 'native', 'helper.mjs') };
const codex = locateCodex(); assert.equal(codex.version, '0.155.1');
const textFile = path.join(root, '中文测试.txt'), largeFile = path.join(root, 'large.bin');
fs.writeFileSync(textFile, 'Windows service 中文 OK'); const original = Buffer.alloc(5*1024*1024, 211); fs.writeFileSync(largeFile, original);
const temp = await WindowsTemporary.create(home, [root], helper);
const release = await pinWindowsDirectories(helper, [root, home], home);
const es = new ExecServer({ codexBin: codex.codexBin, bwrap: null, outerSandbox: false, roots: [root], codexHome: home, port: 0, windowsMode: 'unelevated', windowsTemporary: temp });
let client, wb;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let id = 0;
const pending = new Map();
const call = (method, params) => new Promise((resolve, reject) => {
  const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(new Error('service probe timeout')); }, 20000);
  pending.set(requestId, value => { clearTimeout(timer); resolve(value); });
  wb.send(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, ...(params ? { params } : {}) }));
});
try {
  await es.start();
  assert(await runSandboxProbe(es.url, home, root, 'unelevated', temp.directory));
  client = new RelayClient({ relayUrl, userId: 'probe', token: 'test-agent', codexVersion: codex.version, softwareVersion: '0.4.0',
    roots: () => [root], ceiling: () => ({ sandbox: 'read-only', network: false }), localUrl: () => es.url, codexHome: home,
    windows: { home, helper, mode: 'unelevated', temporary: temp, executorEnvironment: () => es.windowsEnv } });
  client.start();
  for (let i=0;i<100 && client.status!=='connected';i++) await sleep(100);
  assert.equal(client.status, 'connected');
  wb = new WebSocket(relayUrl+'/service', { maxPayload: 1024*1024 });
  await new Promise((resolve,reject) => { wb.once('open',resolve); wb.once('error',reject); });
  const welcome = new Promise(resolve => wb.once('message', raw => resolve(JSON.parse(String(raw)))));
  wb.send(JSON.stringify({ type:'hello',proto:1,role:'workbench',user:'probe',token:'test-workbench',software:'stage1-probe' }));
  assert.equal((await welcome).kind, 'service');
  wb.on('message', raw => { const value=JSON.parse(String(raw)); pending.get(value.id)?.(value); pending.delete(value.id); });
  assert.deepEqual((await call('service/hello')).result.roots,[root]);
  const text = await call('fs/readFile',{path:textFile}); assert.equal(Buffer.from(text.result.content,'base64').toString('utf8'),'Windows service 中文 OK');
  assert.equal((await call('fs/getMetadata',{path:textFile})).result.type,'file');
  assert((await call('fs/readDirectory',{path:root})).result.entries.some(e=>e.name==='中文测试.txt'));
  const chunks=[]; let maxFrame=0;
  for(let i=0;i<10;i++) {
    const reply=await call('fs/readFile',{path:largeFile,offset:i*524288,length:524288});
    assert(reply.result); assert.equal(reply.result.eof,i===9); chunks.push(Buffer.from(reply.result.content,'base64')); maxFrame=Math.max(maxFrame,Buffer.byteLength(JSON.stringify(reply)));
  }
  assert(Buffer.concat(chunks).equals(original)); assert(maxFrame<1024*1024);
  for(const outside of [path.join(os.homedir(),'.codex','config.toml'), path.join(fixture,'outside.txt'), path.join(home,'config.toml')]) assert.equal((await call('fs/readFile',{path:outside})).error.code,-32010);
  assert.equal((await call('fs/readFile',{path:path.join(root,'missing')})).error.code,-32012);
  assert.equal((await call('fs/readFile',{path:largeFile,length:524289})).error.code,-32602);
  assert((await call('fs/readFile',{path:textFile.toUpperCase()})).result);
  const outsideDir = path.join(fixture,'outside'); fs.mkdirSync(outsideDir); fs.writeFileSync(path.join(outsideDir,'private'),'do not read');
  const junction = path.join(root,'junction'); fs.symlinkSync(outsideDir,junction,'junction');
  assert.equal((await call('fs/readFile',{path:path.join(junction,'private')})).error.code,-32010);
  const hardlink = path.join(root,'hardlink'); fs.linkSync(path.join(outsideDir,'private'),hardlink);
  assert.equal((await call('fs/readFile',{path:hardlink})).error.code,-32010);
  for (const alias of [textFile+':stream',root+'\\CON',root+'\\NAME~1.txt','\\\\?\\'+textFile]) assert.equal((await call('fs/readFile',{path:alias})).error.code,-32010);
  const huge = path.join(root,'huge'); fs.closeSync(fs.openSync(huge,'w')); fs.truncateSync(huge,64*1024*1024+1);
  assert.equal((await call('fs/readFile',{path:huge})).error.code,-32011);
  const many = path.join(root,'many'); fs.mkdirSync(many);
  for(let i=0;i<2001;i++) fs.writeFileSync(path.join(many,'文件'+String(i).padStart(4,'0')), '');
  const listing = await call('fs/readDirectory',{path:many});
  assert.equal(listing.result.entries.length,2000); assert.equal(listing.result.truncated,true);
  assert(listing.result.entries.every(entry=>/^文件[0-9]{4}$/.test(entry.name)));
  const reject = new WebSocket(relayUrl+'/service');
  await new Promise((resolve,rejectError) => { reject.once('open',resolve); reject.once('error',rejectError); });
  const rejected = new Promise(resolve => reject.once('message',raw=>resolve(JSON.parse(String(raw)))));
  reject.send(JSON.stringify({type:'hello',proto:1,role:'workbench',user:'probe',software:'stage1-probe'}));
  assert.equal((await rejected).type,'reject'); reject.close();
  console.log(JSON.stringify({stage:1,platform:'win32',agent:'0.4.0',codex:codex.version,sandbox:'unelevated',hello:true,chinese_read:true,metadata:true,directory:true,directory_limit:true,utf8_directory_names:true,segments:10,reassembled:true,max_response_bytes:maxFrame,protected_codex_denied:true,outside_denied:true,agent_home_denied:true,not_found:true,oversized_length_denied:true,case_insensitive:true,junction_denied:true,hardlink_denied:true,aliases_denied:true,too_large_denied:true,no_token_rejected:true,sandbox_streams:client.stats.connections}));
} finally {
  wb?.close(); client?.stop(); await es.stop();
  await sleep(500); await release.close(); await temp.close();
  fs.rmSync(fixture,{recursive:true,force:true,maxRetries:20,retryDelay:200});
}
