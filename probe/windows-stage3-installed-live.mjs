// Installed-package real relay probe. Owner authorization required.
// No permission prompt, model turn or MCP network request. No token on argv/logs.
// Keep source config and CA outside the package; they are read, never changed.
// node ...mjs BUNDLE MANIFEST_SHA SOURCE_CONFIG SOURCE_CA
// Prints a safe ready record. Create <base>/stop to end early; max 120s online.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(process.platform, 'win32');
const [bundle, manifestHash, sourceConfig, sourceCa] = process.argv.slice(2);
assert.match(manifestHash ?? '', /^[a-f0-9]{64}$/);
for (const p of [bundle, sourceConfig, sourceCa]) assert.ok(path.isAbsolute(p));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceSha = sha(sourceConfig);
const base = fs.mkdtempSync(path.join(os.homedir(), 'sunmoon-installed-live-'));
const profile = path.join(base, 'Profile'), local = path.join(base, 'Local'), root = path.join(base, 'workspace');
for (const dir of [profile, local, root]) fs.mkdirSync(dir);
const home = path.join(profile, '.sunmoon-agent'), target = path.join(local, 'Programs', 'sunmoon-agent');
const ca = path.join(base, 'relay-ca.crt'); fs.copyFileSync(sourceCa, ca);
const env = { ...process.env, USERPROFILE: profile, LOCALAPPDATA: local, SUNMOON_AGENT_HOME: home,
  NODE_EXTRA_CA_CERTS: ca, PATH: path.join(process.env.SystemRoot, 'System32') };
const externalNode = path.join(bundle, 'node/node.exe'), node = path.join(target, 'node/node.exe'), cli = path.join(target, 'app/dist/cli.js');
const machineName = 'luna-windows-installed-20261009';
function run(bin, args) {
  const r = spawnSync(bin, args, { env, windowsHide: true, encoding: 'utf8', timeout: 90000 });
  // Do not copy arbitrary process output on failure (the config holds a token).
  assert.equal(r.status, 0, `${path.basename(bin)} ${args[0]} exit=${r.status} error=${r.error?.code ?? 'none'}`);
  return r.stdout.trim();
}
const json = (bin, args) => JSON.parse(run(bin, args));
const status = () => json(node, [cli, 'status']);
let completed = false, installed = false;
try {
  assert.equal(json(externalNode, [path.join(bundle, 'installer/install.mjs'), '--manifest-sha256', manifestHash]).action, 'preview');
  json(externalNode, [path.join(bundle, 'installer/install.mjs'), '--manifest-sha256', manifestHash, '--apply']); installed = true;
  // Reuse only connection identity in an isolated config, then run the installed
  // package's real bootstrap. The synthetic full-package probe covers CLI init.
  process.env.SUNMOON_AGENT_HOME = home;
  const mod = name => import(pathToFileURL(path.join(target, 'app/dist', `${name}.js`)).href);
  const { defaultConfig, saveConfig } = await mod('config');
  const { detectWindowsSandbox } = await mod('windowsBootstrap');
  const original = JSON.parse(fs.readFileSync(sourceConfig, 'utf8'));
  assert.equal(typeof original.token, 'string'); assert.ok(original.token.length > 10);
  const cfg = { ...defaultConfig(), relayUrl: original.relayUrl, userId: original.userId, token: original.token,
    roots: [root], machineName, ceiling: { sandbox: 'read-only', network: false } };
  cfg.windowsSandbox = await detectWindowsSandbox(cfg.codexHome, cfg.roots);
  saveConfig(cfg);
  fs.writeFileSync(path.join(root, 'installed-check.txt'), 'installed package fixture\n');
  run(node, [cli, 'start', '--background']);
  let current;
  for (let n = 0; n < 120; n++) {
    current = status();
    if (current.running && current.relay?.status === 'connected') break;
    if (!current.running || current.relay?.status === 'rejected') throw new Error('Installed agent stopped or was rejected');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(current.relay?.status, 'connected');
  const logs = path.join(local, 'sunmoon-agent/logs');
  const assertNoToken = requireStatus => {
    const files = fs.readdirSync(logs).filter(name => /^agent\.log(?:\.[0-4])?$/.test(name)).map(name => path.join(logs, name));
    assert.ok(files.length > 0, 'No actual agent logs captured');
    const statusPath = path.join(home, 'status.json');
    if (requireStatus) { assert.ok(fs.existsSync(statusPath)); files.push(statusPath); }
    for (const file of files) assert.equal(fs.readFileSync(file).includes(Buffer.from(cfg.token)), false, 'Credential emitted into agent status/log');
    return files.length;
  };
  const credentialScannedFiles = assertNoToken(true);
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  assert.ok(Number.isSafeInteger(current.pid));
  const native = json(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter "ProcessId=${current.pid}";$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);$policy=Get-ItemProperty -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy' -Name VerifiedAndReputablePolicyState -ErrorAction SilentlyContinue;@{pid=$p.ProcessId;executable=$p.ExecutablePath;administrator=$admin;applicationControlState=$policy.VerifiedAndReputablePolicyState}|ConvertTo-Json -Compress`]);
  assert.equal(native.executable.toLowerCase(), node.toLowerCase()); assert.equal(native.administrator, false);
  console.log(JSON.stringify({ event: 'installed-online', base, machineName, manifestHash, sourceSha,
    pid: current.pid, executable: native.executable, administrator: native.administrator,
    applicationControlState: native.applicationControlState, sandbox: current.execServer?.windowsSandbox?.mode,
    network: false, credentialScannedFiles, actualTokenInStatusOrLogs: false, maximumOnlineSeconds: 120 }));
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !fs.existsSync(path.join(base, 'stop'))) await new Promise(resolve => setTimeout(resolve, 500));
  run(node, [cli, 'stop']); assert.equal(status().running, false);
  assertNoToken(false);
  json(externalNode, [path.join(bundle, 'installer/uninstall.mjs'), '--manifest-sha256', manifestHash, '--apply', '--remove-config']);
  assert.equal(fs.existsSync(target), false); assert.equal(fs.existsSync(home), false);
  assert.equal(fs.readFileSync(path.join(root, 'installed-check.txt'), 'utf8'), 'installed package fixture\n');
  assert.equal(sha(sourceConfig), sourceSha);
  completed = true;
  console.log(JSON.stringify({ event: 'installed-cleanup', pass: true, base, sourceConfigUnchanged: true,
    programRemoved: true, temporaryConfigRemoved: true, realUserConfigTouched: false,
    actualTokenInStatusOrLogs: false, humanWebpageCheck: false }));
} finally {
  if (completed) fs.rmSync(base, { recursive: true, force: true });
  else {
    // Stop only this isolated instance on any failure. Keep diagnostics for repair.
    if (installed && fs.existsSync(path.join(home, 'config.json'))) {
      const stop = spawnSync(node, [cli, 'stop'], { env, windowsHide: true, stdio: 'ignore', timeout: 30000 });
      console.error(`Isolated stop exit=${stop.status}`);
    }
    console.error('Private isolated fixture retained for recovery: ' + base);
  }
}
