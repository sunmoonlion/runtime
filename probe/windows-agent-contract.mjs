// Real fixed-version response capture; run natively on Windows after agent build.
// Only creates owned temporary files. Does not read model/relay credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { locateCodex } from '../agent/dist/paths.js';
import { freeLoopbackPort, waitForPort } from '../agent/dist/execServer.js';
import { WindowsFiles, locateWindowsHelper, killWindowsTree, windowsEnvironment, windowsProfile } from '../agent/dist/windowsRuntime.js';
const require = createRequire(new URL('../agent/package.json', import.meta.url));
const WebSocket = require('ws');
if (process.platform !== 'win32') throw new Error('Run on native Windows');
const output = process.env.SUNMOON_PROBE_OUTPUT;
if (!output) throw new Error('Set SUNMOON_PROBE_OUTPUT to an owned result directory');
fs.mkdirSync(output, { recursive: true });
const base = fs.mkdtempSync(path.join(os.homedir(), 'sunmoon-contract-1b-'));
const root = path.join(base, 'workspace'), home = path.join(base, 'agent-home');
fs.mkdirSync(root); fs.mkdirSync(home);
fs.writeFileSync(path.join(home, 'config.toml'), 'sandbox_mode="read-only"\napproval_policy="never"\n[windows]\nsandbox="unelevated"\n');
const codex = locateCodex();
const version = spawnSync(codex.codexBin, ['--version'], { encoding: 'utf8', windowsHide: true });
if (codex.version !== '0.155.1' || version.stdout.trim() !== 'codex-cli 0.155.1') throw new Error('Version mismatch');
const port = await freeLoopbackPort(), url = `ws://127.0.0.1:${port}`;
const server = spawn(codex.codexBin, ['exec-server', '--listen', url], { cwd: home, env: windowsEnvironment(home), windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
const frames = [], comparisons = [], experiments = [];
const source = 'probe/windows-agent-contract.mjs';
let ws, files, seq = 0; const waiting = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uri = p => pathToFileURL(p).href;
const call = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq, frame = { id, method, params };
  const recorded = method === 'process/start' ? { ...frame, params: { ...params, env: Object.fromEntries(Object.keys(params.env).map(k => [k, '[REDACTED]'])) } } : frame;
  frames.push({ source, version: '0.155.1', direction: 'request', frame: recorded });
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`RPC timeout ${method}`)); }, 10000);
  waiting.set(id, { resolve, reject, timer }); ws.send(JSON.stringify(frame));
});
async function compare(name, method, params, beforeHelper) {
  const real = await call(method, params); if (beforeHelper) beforeHelper();
  const helper = await files.call(method, params);
  const equal = real.error || helper.error ? isDeepStrictEqual(real.error, helper.error) : isDeepStrictEqual(real.result, helper.result);
  comparisons.push({ name, method, request: params, real, helper, equal });
}
try {
  if (!await waitForPort(port, 10000, () => server.exitCode === null)) throw new Error('Executor unavailable');
  ws = new WebSocket(url, { maxPayload: 32 * 1024 * 1024 });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('message', data => { const frame = JSON.parse(String(data)); frames.push({ source, version: '0.155.1', direction: 'response', frame }); const pending = waiting.get(frame.id); if (pending) { clearTimeout(pending.timer); pending.resolve(frame); waiting.delete(frame.id); } });
  const init = await call('initialize', { clientName: 'sunmoon-1b-contract', resumeSessionId: null });
  if (init.result?.environmentInfo?.executorVersion !== '0.155.1') throw new Error('Executor response version mismatch');
  ws.send(JSON.stringify({ method: 'initialized', params: {} }));
  files = new WindowsFiles({ url: () => url, home, roots: [root], mode: 'unelevated', writable: true, helper: locateWindowsHelper() });
  const file = path.join(root, 'sample.txt'), dir = path.join(root, 'folder');
  const dataBase64 = Buffer.from('contract-中文\n').toString('base64');
  await compare('write', 'fs/writeFile', { path: uri(file), dataBase64, sandbox: null });
  await compare('read', 'fs/readFile', { path: uri(file), sandbox: null });
  await compare('metadata', 'fs/getMetadata', { path: uri(file), sandbox: null });
  await compare('canonical', 'fs/canonicalize', { path: uri(file), sandbox: null });
  await compare('mkdir', 'fs/createDirectory', { path: uri(dir), recursive: true, sandbox: null });
  await compare('copy', 'fs/copy', { sourcePath: uri(file), destinationPath: uri(path.join(dir, 'copy.txt')), recursive: false, sandbox: null });
  await compare('directory', 'fs/readDirectory', { path: uri(root), sandbox: null });
  await compare('walk', 'fs/walk', { path: uri(root), options: { maxDepth: 4, maxDirectories: 100, maxEntries: 100, followDirectorySymlinks: false, pruneHiddenDirectories: false }, sandbox: null });
  await compare('open', 'fs/open', { path: uri(file), handleId: 'contract-h1', sandbox: null });
  await compare('block', 'fs/readBlock', { handleId: 'contract-h1', offset: 0, len: 100 });
  await compare('block-exact', 'fs/readBlock', { handleId: 'contract-h1', offset: 0, len: Buffer.from(dataBase64, 'base64').length });
  await compare('block-zero', 'fs/readBlock', { handleId: 'contract-h1', offset: 0, len: 0 });
  await compare('close', 'fs/close', { handleId: 'contract-h1' });
  await compare('remove', 'fs/remove', { path: uri(dir), recursive: true, force: false, sandbox: null }, () => fs.mkdirSync(dir));
  // Successful optional calls are captured as guidance, not enabled by this probe.
  await call('capabilityRoots/discoverV1', { roots: [{ id: 'contract', path: uri(root), sandbox: null }] });
  const sandbox = windowsProfile(root, [root], 'unelevated', false);
  await call('fs/readFile', { path: uri(file), sandbox });
  for (const command of ['git', 'python', 'uv']) {
    const where = spawnSync(path.join(process.env.SystemRoot, 'System32', 'where.exe'), [command], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    experiments.push({ command, nativePathLookupExit: where.status, locations: where.stdout?.trim().split(/\r?\n/).filter(Boolean) });
    const processId = `path-${command}`;
    const started = await call('process/start', { processId, argv: [path.join(process.env.SystemRoot, 'System32', 'cmd.exe'), '/d', '/c', `${command} --version`], cwd: uri(root), env: windowsEnvironment(home), tty: false, sandbox: windowsProfile(root, [root], 'unelevated', false) });
    if (started.error) experiments.push({ command, processToolsStart: started.error });
    else for (let i = 0; i < 100 && !frames.some(f => f.frame.method === 'process/exited' && f.frame.params.processId === processId); i++) await sleep(100);
    const exited = frames.find(f => f.frame.method === 'process/exited' && f.frame.params.processId === processId)?.frame.params;
    experiments.push({ command, sandboxExit: exited ?? null, stdout: frames.filter(f => f.frame.method === 'process/output' && f.frame.params.processId === processId && f.frame.params.stream === 'stdout').map(f => Buffer.from(f.frame.params.chunk, 'base64').toString('utf8')).join('') });
  }
  for (const mode of ['opendir', 'cwd']) {
    const d = path.join(root, `pin-${mode}`); fs.mkdirSync(d); const original = process.cwd(); let handle;
    if (mode === 'opendir') handle = fs.opendirSync(d); else process.chdir(d);
    let renameBlocked = false, code;
    try { fs.renameSync(d, d + '-moved'); fs.renameSync(d + '-moved', d); } catch (e) { renameBlocked = true; code = e.code; }
    handle?.closeSync(); process.chdir(original);
    experiments.push({ mode, renameBlocked, code }); fs.rmSync(d, { recursive: true });
  }
} finally {
  for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('Probe closed')); } waiting.clear();
  ws?.terminate(); await files?.close(); await killWindowsTree(server);
  fs.writeFileSync(path.join(output, 'fs-frames.jsonl'), frames.map(f => JSON.stringify(f)).join('\n') + '\n');
  fs.writeFileSync(path.join(output, 'fs-comparison.json'), JSON.stringify({ version: '0.155.1', comparisons, experiments }, null, 2) + '\n');
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(JSON.stringify({ compared: comparisons.length, mismatches: comparisons.filter(c => !c.equal).map(c => c.name), experiments }));
if (comparisons.some(c => !c.equal)) process.exitCode = 1;
