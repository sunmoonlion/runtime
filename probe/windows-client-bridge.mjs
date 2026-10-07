// Native fixed-version app-server -> production WindowsBridge -> exec-server.
// A local deterministic model stub drives a real Codex tool turn.
// No external model, credentials, relay or user files. Not browser acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { locateCodex } from '../agent/dist/paths.js';
import { freeLoopbackPort, waitForPort } from '../agent/dist/execServer.js';
import { WindowsBridge } from '../agent/dist/windowsBridge.js';
import { locateWindowsHelper, killWindowsTree, windowsEnvironment } from '../agent/dist/windowsRuntime.js';
const require = createRequire(new URL('../agent/package.json', import.meta.url));
const { WebSocket, WebSocketServer } = require('ws');
if (process.platform !== 'win32' || !process.env.SUNMOON_PROBE_OUTPUT) throw new Error('Native Windows and SUNMOON_PROBE_OUTPUT required');
const output = process.env.SUNMOON_PROBE_OUTPUT;
const writable = process.env.SUNMOON_PROBE_WRITABLE === '1';
const excludeTemp = process.env.SUNMOON_PROBE_EXCLUDE_TEMP === '1';
const command = writable ? "Set-Content -LiteralPath client-created.txt -Value 'client probe OK' -NoNewline" : 'Get-ChildItem -Name';
const base = fs.mkdtempSync(path.join(os.homedir(), 'sunmoon-client-bridge-'));
const root = path.join(base, 'workspace'), home = path.join(base, 'executor-home'), clientHome = path.join(base, 'client-home');
for (const p of [root, home, clientHome]) fs.mkdirSync(p);
fs.writeFileSync(path.join(root, 'README.md'), 'Owned protocol probe\n');
fs.writeFileSync(path.join(home, 'config.toml'), 'sandbox_mode="read-only"\napproval_policy="never"\n[windows]\nsandbox="unelevated"\n');
let modelRequests = 0;
const model = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body); modelRequests++;
  const done = modelRequests > 1;
  const tools = request.tools?.flatMap(t => t.type === 'namespace' ? t.tools : [t]) ?? [];
  const tool = tools.find(t => t.name === 'exec_command') ?? tools.find(t => t.name === 'shell_command');
  const item = done || !tool
    ? { type: 'message', id: 'msg_probe', role: 'assistant', content: [{ type: 'output_text', text: 'Probe finished.', annotations: [] }] }
    : { type: 'function_call', id: 'fc_probe', call_id: 'call_probe', name: tool.name, arguments: JSON.stringify(tool.name === 'exec_command' ? { cmd: command, workdir: root, max_output_tokens: 1000 } : { command, workdir: root, timeout_ms: 5000 }) };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('response.created', { response: { id: `resp_${modelRequests}`, status: 'in_progress', output: [] } });
  event('response.output_item.added', { output_index: 0, item });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { id: `resp_${modelRequests}`, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  res.end();
});
await new Promise(r => model.listen(0, '127.0.0.1', r));
fs.writeFileSync(path.join(clientHome, 'config.toml'), `model="capture-only"\nmodel_provider="probe"\n${process.env.SUNMOON_PROBE_CLIENT_DEFAULT_WINDOWS === '1' ? '' : '[windows]\nsandbox="unelevated"\n'}[model_providers.probe]\nname="capture-only"\nbase_url="http://127.0.0.1:${model.address().port}/v1"\nwire_api="responses"\n`);
const codex = locateCodex();
if (codex.version !== '0.155.1') throw new Error('Fixed 0.155.1 required');
const port = await freeLoopbackPort(), url = `ws://127.0.0.1:${port}`;
const executor = spawn(codex.codexBin, ['exec-server', '--listen', url], { cwd: home, env: windowsEnvironment(home), windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
const frames = [], calls = [], notifications = [], bridges = new Set(), downstream = new Set();
let server, client, lines, seq = 0, createdFile = null;
const pending = new Map();
function record(direction, frame) {
  const safe = structuredClone(frame);
  if (safe.params?.env) safe.params.env = Object.fromEntries(Object.entries(safe.params.env).map(([k,v]) => [k, ['CODEX_VERSION','CODEX_THREAD_ID','CODEX_SESSION_ID','CODEX_CI','CODEX_SANDBOX_NETWORK_DISABLED'].includes(k) ? v : '[REDACTED]']));
  frames.push({ source: 'probe/windows-client-bridge.mjs', version: '0.155.1', clientPlatform: 'win32', writable, excludeTemp, direction, frame: safe });
}
async function call(method, params) {
  const id = ++seq;
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`client timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, timer }); client.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  calls.push({ method, response }); return response;
}
try {
  if (!await waitForPort(port, 10000, () => executor.exitCode === null)) throw new Error('executor unavailable');
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(r => server.once('listening', r));
  server.on('connection', up => {
    const bridge = new WindowsBridge({ roots: [root], home, mode: 'unelevated', helper: locateWindowsHelper(), ceiling: { sandbox: 'workspace-write', network: false }, url: () => url });
    bridges.add(bridge);
    const local = new WebSocket(url); downstream.add(local);
    const ready = new Promise(r => local.once('open', r));
    let chain = Promise.resolve();
    up.on('message', (raw, binary) => {
      chain = chain.then(async () => {
        const frame = JSON.parse(String(raw)); record('request', frame);
        const checked = await bridge.receive(String(raw), binary);
        if (checked.reason) frames.push({ direction: 'denial', method: checked.method, reason: checked.reason });
        if (checked.response && up.readyState === WebSocket.OPEN) { record('response', JSON.parse(checked.response)); up.send(checked.response); }
        if (checked.forward) { await ready; if (local.readyState === WebSocket.OPEN) local.send(checked.forward); }
      }).catch(e => frames.push({ direction: 'probe-error', type: e.name }));
    });
    local.on('message', raw => { bridge.observe(String(raw)); record('response', JSON.parse(String(raw))); if (up.readyState === WebSocket.OPEN) up.send(raw, { binary: false }); });
    up.on('close', () => { local.terminate(); void bridge.close(); });
    local.on('error', () => { up.close(); });
  });
  client = spawn(codex.codexBin, ['app-server'], { cwd: clientHome, env: windowsEnvironment(clientHome), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  lines = readline.createInterface({ input: client.stdout });
  lines.on('line', line => { try { const frame = JSON.parse(line); const p = pending.get(frame.id); if (p) { clearTimeout(p.timer); pending.delete(frame.id); p.resolve(frame); } else notifications.push(frame); } catch {} });
  await call('initialize', { clientInfo: { name: 'sunmoon-windows-client-bridge', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  client.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  await call('environment/add', { environmentId: 'native-probe', execServerUrl: `ws://127.0.0.1:${server.address().port}` });
  await call('environment/info', { environmentId: 'native-probe' });
  const thread = await call('thread/start', { cwd: root, environments: [{ environmentId: 'native-probe', cwd: root }], approvalPolicy: 'never', sandbox: writable ? 'workspace-write' : 'read-only' });
  if (thread.result?.thread?.id) {
    await call('turn/start', { threadId: thread.result.thread.id, ...(writable && excludeTemp ? { sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true } } : {}), input: [{ type: 'text', text: writable ? 'Create the owned probe file.' : 'List the owned probe directory.' }] });
    const until = Date.now() + 20000;
    while (Date.now() < until && !notifications.some(n => n.method === 'turn/completed')) await new Promise(r => setTimeout(r, 100));
  }
} finally {
  for (const p of pending.values()) clearTimeout(p.timer);
  if (client) await killWindowsTree(client);
  lines?.close();
  for (const c of server?.clients ?? []) c.terminate();
  for (const c of downstream) c.terminate();
  await Promise.all([...bridges].map(b => b.close()));
  server?.close(); model.closeAllConnections(); model.close(); await killWindowsTree(executor);
  fs.mkdirSync(output, { recursive: true });
  createdFile = fs.existsSync(path.join(root, 'client-created.txt')) ? fs.readFileSync(path.join(root, 'client-created.txt'), 'utf8').trim() : null;
  fs.writeFileSync(path.join(output, 'client-bridge.json'), JSON.stringify({ version: codex.version, calls, frames, modelRequests, writable, excludeTemp, createdFile, notifications }, null, 2) + '\n');
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(JSON.stringify({ calls: calls.map(c => ({ method: c.method, error: c.response.error })), denied: frames.filter(f => f.direction === 'denial'), methods: [...new Set(frames.filter(f => f.direction === 'request').map(f => f.frame.method))] }));
const commandResult = notifications.find(n => n.method === 'item/completed' && n.params?.item?.type === 'commandExecution')?.params.item;
if (calls.length !== 5 || calls.some(c => c.response.error) || commandResult?.exitCode !== 0 || (writable && createdFile !== 'client probe OK') || !notifications.some(n => n.method === 'turn/completed' && n.params.turn.status === 'completed')) process.exitCode = 1;
