// Native Windows integration harness: production CLI and human TTY confirmation.
// No automatic approval; no command arguments, credentials or file bodies in traces.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.platform !== 'win32') throw new Error('Run natively on Windows');
const [mode, agent, state] = process.argv.slice(2);
if (!['prepare', 'run', 'import-fixture'].includes(mode) || !path.isAbsolute(agent) || !path.isAbsolute(state)) throw new Error('prepare|run|import-fixture AGENT STATE');
process.env.SUNMOON_AGENT_HOME = state;
const mod = name => import(pathToFileURL(path.join(agent, 'dist', `${name}.js`)).href);
if (mode === 'prepare') {
  const { detectWindowsSandbox } = await mod('windowsBootstrap');
  const { loadConfig, saveConfig } = await mod('config');
  const cfg = loadConfig();
  cfg.windowsSandbox = await detectWindowsSandbox(cfg.codexHome, cfg.roots);
  saveConfig(cfg);
  console.log(JSON.stringify({ prepared: true, mode: cfg.windowsSandbox.mode }));
} else if (mode === 'import-fixture') {
  // The real user's Codex profile is untouched. Exercise the genuine import
  // CLI using a disposable profile containing one public, credential-free URL.
  process.env.USERPROFILE = path.join(state, 'import-profile');
  console.log('TEST PROFILE ONLY: import the temporary cloud-loopback MCP fixture.');
  process.argv = [process.execPath, path.join(agent, 'dist', 'cli.js'), 'mcp', 'import'];
  await mod('cli');
} else {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('A real local console is required');
  const traceFile = path.join(state, 'trace.jsonl');
  if (fs.existsSync(traceFile)) throw new Error('Trace already exists; preserve previous evidence');
  const trace = value => fs.appendFileSync(traceFile, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
  const { WindowsBridge } = await mod('windowsBridge');
  const receive = WindowsBridge.prototype.receive;
  WindowsBridge.prototype.receive = async function(raw, binary) {
    let frame;
    try { frame = JSON.parse(raw); } catch {}
    if (frame?.method === 'environmentConfig/read') {
      const p = frame.params ?? {};
      const projection = value => Array.isArray(value) && value.length < 16
        ? value.map(v => Array.isArray(v) ? v.map(x => typeof x === 'string' && /^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/.test(x) ? x : '<redacted>') : '<invalid>') : '<invalid>';
      // Paths are useful to distinguish cloud fallback from the actual local
      // root. Record only this public fixture path and the known /data path.
      const known = typeof p.cwd === 'string' && (p.cwd === '/data' || p.cwd === 'file:///data' || p.cwd.replaceAll('\\', '/').includes('/sunmoon-probe-runs/windows-agent-1b-20261007/workspace'));
      trace({ event: 'projection', keys: Object.keys(p), configPaths: projection(p.configPaths), requirementsPaths: projection(p.requirementsPaths), cwd: known ? p.cwd : '<other-path>' });
    }
    const result = await receive.call(this, raw, binary);
    if (result.reason) trace({ event: 'denied', method: result.method, reason: result.reason,
      ...(result.method === 'unsupported-method' ? {
        wireMethod: typeof frame?.method === 'string' && /^[A-Za-z0-9_/-]{1,80}$/.test(frame.method) ? frame.method : '<redacted>',
        paramKeys: Object.keys(frame?.params ?? {}),
      } : {}),
    });
    else if (result.method === 'process/start') trace({ event: 'process-forwarded' });
    return result;
  };
  const { RelayClient } = await mod('relayClient');
  const start = RelayClient.prototype.start;
  RelayClient.prototype.start = function(...args) {
    const confirm = this.opts.confirmPermission;
    this.opts.confirmPermission = async (...params) => {
      trace({ event: 'local-prompt-open' });
      const yes = await confirm(...params);
      trace({ event: 'local-prompt-result', approved: yes });
      return yes;
    };
    return start.apply(this, args);
  };
  const report = RelayClient.prototype.reportPermission;
  RelayClient.prototype.reportPermission = async function(value, ...args) {
    trace({ event: 'permission-report', id: value.id, conn: value.conn, threadId: value.threadId, requestDigest: value.requestDigest, permissionDigest: value.permissionDigest, decision: value.decision, scope: value.scope, expiresAt: value.expiresAt });
    const recorded = await report.call(this, value, ...args);
    trace({ event: 'permission-receipt', id: value.id, recorded });
    return recorded;
  };
  const stop = path.join(state, 'stop');
  const deadline = Date.now() + 45 * 60 * 1000;
  const timer = setInterval(() => {
    if (fs.existsSync(stop) || Date.now() >= deadline) { clearInterval(timer); process.emit('SIGINT'); }
  }, 1000);
  timer.unref();
  trace({ event: 'native-console', pid: process.pid, tty: true, ceiling: 'read-only', lifetimeMinutes: 45 });
  process.on('exit', code => trace({ event: 'exit', code }));
  console.log('SunMoon Stage 2: LOCAL HUMAN APPROVAL TEST. Keep this window open.');
  console.log('Only type an allow code when you have requested the test operation.');
  process.argv = [process.execPath, path.join(agent, 'dist', 'cli.js'), 'start'];
  await mod('cli');
}
