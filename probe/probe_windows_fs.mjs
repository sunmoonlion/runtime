// Deterministic exec-server filesystem probe. Node >=22; no packages or credentials.
// Field spelling verified against the 0.155.1 Windows executor's actual response:
// dataBase64 (the older filter unit fixture's data_base64 is not a wire field).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
if (process.platform !== 'win32' || !process.env.USERPROFILE || !process.env.L2_OUTSIDE_ROOT) {
  throw new Error('Run on native Windows with USERPROFILE and a dedicated L2_OUTSIDE_ROOT');
}
const outside = path.resolve(process.env.L2_OUTSIDE_ROOT);
const relative = path.relative(process.env.USERPROFILE, outside);
if (!path.isAbsolute(process.env.L2_OUTSIDE_ROOT) ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
  throw new Error('L2_OUTSIDE_ROOT must be an absolute directory outside USERPROFILE');
}
const outer = process.env.PROBE_OUTER_SANDBOX === '1';
console.log(JSON.stringify({ mode: outer ? 'outer-boundary' : 'unwrapped-control' }));
const tag = `sunmoon-probe-${process.pid}-${Date.now()}`;
const targets = [
  ['inside', path.join(base, 'user-ws', `${tag}.txt`), true],
  ['outside-cwd', path.join(process.env.USERPROFILE, `${tag}.txt`), !outer],
  ['outside-profile', path.join(outside, `${tag}.txt`), !outer],
];
let socket;
const pending = new Map();
const results = [];
async function call(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(request.id); reject(new Error('RPC timeout')); }, 10000);
    pending.set(request.id, (frame) => { clearTimeout(timer); resolve(frame); });
    console.log(JSON.stringify({ direction: 'request', frame: request }));
    socket.send(JSON.stringify(request));
  });
}
try {
  for (const [name, target] of targets) {
    fs.writeFileSync(target, tag, { flag: 'wx' });
    fs.unlinkSync(target);
    console.log(JSON.stringify({ control: name, writableByOrdinaryUser: true, target }));
  }
  socket = new WebSocket(process.env.EXEC_URL);
  socket.addEventListener('message', ({ data }) => {
    const frame = JSON.parse(data);
    const waiter = pending.get(frame.id);
    if (waiter) { pending.delete(frame.id); waiter(frame); }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket error')); }, { once: true });
  });
  const initialized = await call({ id: 0, method: 'initialize', params: { clientName: 'sunmoon-windows-probe' } });
  console.log(JSON.stringify({ direction: 'response', frame: initialized }));
  if (initialized.error) throw new Error('Executor initialization rejected');
  const notification = { method: 'initialized', params: {} };
  console.log(JSON.stringify({ direction: 'request', frame: notification }));
  socket.send(JSON.stringify(notification));
  for (const [index, [name, target, shouldWrite]] of targets.entries()) {
    const request = { id: index + 1, method: 'fs/writeFile', params: {
      path: pathToFileURL(target).href, dataBase64: Buffer.from(tag).toString('base64'), sandbox: null,
    } };
    const response = await call(request);
    console.log(JSON.stringify({ direction: 'response', frame: response }));
    const exists = fs.existsSync(target);
    const denial = response.error && /PermissionDenied|permission.denied|access.denied|拒绝访问|os error 5/i.test(JSON.stringify(response.error));
    const verdict = shouldWrite
      ? (!response.error && exists && fs.readFileSync(target, 'utf8') === tag ? 'pass' : denial ? 'fail' : 'undecidable')
      : (exists ? 'fail' : denial ? 'pass' : 'undecidable');
    results.push({ name, exists, verdict });
    console.log(JSON.stringify({ case: name, shouldWrite, exists, verdict }));
  }
  process.exitCode = results.some(r => r.verdict === 'fail') ? 1 : results.every(r => r.verdict === 'pass') ? 0 : 2;
} catch (error) {
  console.log(JSON.stringify({ verdict: 'undecidable', error: error.message }));
  process.exitCode = 2;
} finally {
  socket?.close();
  for (const [, target] of targets) {
    try {
      if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === tag) fs.unlinkSync(target);
    } catch (error) {
      console.log(JSON.stringify({ cleanup: target, error: error.message }));
      process.exitCode = 2;
    }
  }
}
