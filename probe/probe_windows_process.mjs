// Native Windows process/start probe. No model calls, credentials or packages.
// Starting shape comes from the pinned protocol fixture; retain actual responses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(base, 'user-ws');
const mode = process.env.SANDBOX_MODE;
if (process.platform !== 'win32' || !['unelevated', 'elevated'].includes(mode)) throw new Error('Native Windows sandbox mode required');
const outerOnlyControl = process.env.PROBE_PROCESS_POLICY === 'outer-only-control';
if (outerOnlyControl && process.env.PROBE_OUTER_SANDBOX !== '1') throw new Error('Outer-only diagnostic requires the OS outer sandbox');
console.log(JSON.stringify({ diagnostic: outerOnlyControl ? 'outer-only-control' : 'nested-or-inner', innerPolicy: outerOnlyControl ? null : 'workspace-write/network-restricted' }));
const outside = path.resolve(process.env.L2_OUTSIDE_ROOT || '');
const relative = path.relative(process.env.USERPROFILE, outside);
if (!process.env.L2_OUTSIDE_ROOT || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
  throw new Error('Dedicated outside-profile directory required');
}
const marker = `sunmoon-process-${process.pid}-${Date.now()}`;
const targets = [
  ['outside-cwd', path.join(process.env.USERPROFILE, `${marker}.txt`), false],
  ['outside-profile', path.join(outside, `${marker}.txt`), false],
  ['inside', path.join(cwd, `${marker}.txt`), true],
];
const pending = new Map();
const notifications = [];
let socket;
function send(frame) {
  console.log(JSON.stringify({ direction: 'request', frame }));
  socket.send(JSON.stringify(frame));
}
function call(frame) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(frame.id); reject(new Error('RPC timeout')); }, 15000);
    pending.set(frame.id, msg => { clearTimeout(timer); resolve(msg); });
    send(frame);
  });
}
try {
  for (const [name, target] of targets) {
    fs.writeFileSync(target, marker, { flag: 'wx' }); fs.unlinkSync(target);
    console.log(JSON.stringify({ control: name, ordinaryUserWrite: true, target }));
  }
  socket = new WebSocket(process.env.EXEC_URL);
  socket.addEventListener('message', ({ data }) => {
    const frame = JSON.parse(data);
    console.log(JSON.stringify({ direction: 'response', frame }));
    if (pending.has(frame.id)) { const resolve = pending.get(frame.id); pending.delete(frame.id); resolve(frame); }
    else notifications.push(frame);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connect timeout')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Connect failed')); }, { once: true });
  });
  const init = await call({ id: 1, method: 'initialize', params: { clientName: 'sunmoon-process-probe' } });
  if (init.error) throw new Error('Initialize rejected');
  send({ method: 'initialized', params: {} });
  const results = [];
  for (const [index, [name, target, shouldWrite]] of targets.entries()) {
    const processId = `${marker}-${index}`;
    const quote = text => `'${text.replaceAll("'", "''")}'`;
    const identity = path.join(process.env.SystemRoot, 'System32', 'whoami.exe');
    const command = `$ErrorActionPreference='Stop'; & ${quote(identity)} /user; Set-Content -LiteralPath ${quote(target)} -Value ${quote(marker)} -NoNewline; Write-Output ${quote(marker)}`;
    const start = notifications.length;
    const response = await call({ id: index + 2, method: 'process/start', params: {
      processId, tty: false,
      env: Object.fromEntries(['SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'CODEX_HOME']
        .filter(key => process.env[key]).map(key => [key, process.env[key]])),
      enforceManagedNetwork: false, managedNetwork: null,
      argv: [path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), '-NoProfile', '-NonInteractive', '-Command', command],
      cwd: pathToFileURL(cwd).href,
      sandbox: outerOnlyControl ? null : {
        permissions: { type: 'managed', file_system: { type: 'restricted', entries: [
          { path: { type: 'special', value: { kind: 'root' } }, access: 'read' },
          { path: { type: 'special', value: { kind: 'project_roots' } }, access: 'write' },
        ] }, network: 'restricted' },
        cwd: pathToFileURL(cwd).href, workspaceRoots: [pathToFileURL(cwd).href],
        // 0.155.1 wire enum differs from config.toml's "unelevated" spelling.
        windowsSandboxLevel: mode === 'unelevated' ? 'restricted-token' : 'elevated', useLegacyLandlock: false,
      },
    } });
    if (!response.error) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !notifications.slice(start).some(n => n.method === 'process/exited' && n.params?.processId === processId)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const events = notifications.slice(start).filter(n => n.params?.processId === processId);
    const exists = fs.existsSync(target);
    const exited = events.find(n => n.method === 'process/exited')?.params;
    const output = ['stdout', 'stderr'].map(stream => new TextDecoder('gb18030').decode(Buffer.concat(
      events.filter(n => n.method === 'process/output' && n.params.stream === stream)
        .map(n => Buffer.from(n.params.chunk, 'base64'))))).join('\n');
    const started = response.result?.processId === processId;
    const wroteMarker = exists && fs.readFileSync(target, 'utf8') === marker;
    const denied = exited && exited.exitCode !== 0 && (exited.sandboxDenied || /PermissionDenied|UnauthorizedAccess|AccessDenied|access.+denied/i.test(output));
    let verdict = 'undecidable';
    if (!shouldWrite && exists) verdict = 'fail';
    else if (started && exited) verdict = shouldWrite ? (exited.exitCode === 0 && wroteMarker ? 'pass' : 'fail') : (denied ? 'pass' : 'undecidable');
    const result = { name, shouldWrite, exists, response, events, output, verdict };
    results.push(result); console.log(JSON.stringify({ case: result }));
  }
  const verdict = results.every(r => r.verdict === 'pass') ? 'pass' : results.some(r => r.verdict === 'fail') ? 'fail' : 'undecidable';
  console.log(JSON.stringify({ verdict, mode, outerOnlyControl, cases: results.map(({ name, verdict }) => ({ name, verdict })) }));
  process.exitCode = verdict === 'pass' ? 0 : 2;
} catch (error) {
  console.log(JSON.stringify({ verdict: 'undecidable', error: error.message })); process.exitCode = 2;
} finally {
  socket?.close();
  // A wedged executor may never complete the close handshake. Let the wrapper's
  // finally run so it can terminate its owned native process tree.
  setTimeout(() => process.exit(process.exitCode ?? 2), 1000).unref();
  for (const [, target] of targets) {
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === marker) fs.unlinkSync(target);
  }
}
