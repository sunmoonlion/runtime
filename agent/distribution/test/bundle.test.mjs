import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MANIFEST, relativeFile, digest, inventory, firstInstall, verifyBundle, validateManifest, removeVerifiedBundle } from '../bundle.mjs';
import { decideUpgrade, inspectInstalled } from '../upgrade.mjs';
import { clearStaleTray } from '../uninstall.mjs';
import { certificateDerSha256, siteDocument, writeSite } from '../launch.mjs';

const samplePaths = [
  'node/node.exe', 'licenses/node-LICENSE', 'licenses/codex-LICENSE', 'licenses/codex-NOTICE',
  'app/package.json', 'app/dist/cli.js', 'app/native/helper.mjs',
  'app/dist/resident.js', 'app/dist/windowsDesktop.js', 'app/native/desktop.ps1', 'app/native/run-hidden.vbs',
  'app/node_modules/@openai/codex/package.json',
  'app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
  'app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex-resources/codex-command-runner.exe',
  'app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe',
  'app/node_modules/smol-toml/package.json', 'app/node_modules/ws/package.json',
  'sunmoon-agent.cmd', 'install.cmd', 'installer/install.mjs', 'installer/bundle.mjs',
  'uninstall.cmd', 'installer/uninstall.mjs', 'installer/launch.mjs', 'installer/upgrade.mjs',
  'app/native/elevated-setup.ps1',
];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sunmoon-dist-test-'));
  // Only this test's unique temporary directory is removed. No actual installation/user state.
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'candidate'), localAppData = path.join(root, 'Local');
  fs.mkdirSync(source); fs.mkdirSync(localAppData);
  for (const file of samplePaths) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), `synthetic: ${file}\n`);
  }
  const manifest = { schema: 1, platform: 'win32', architecture: 'x64', agentVersion: '0.2.0', codexVersion: '0.155.1',
    nodeVersion: '24.19.0', relayProtocol: 1, sourceRevision: 'a'.repeat(40), dependencyLockSha256: 'b'.repeat(64), files: inventory(source) };
  const save = () => { fs.writeFileSync(path.join(source, MANIFEST), JSON.stringify(manifest)); return digest(path.join(source, MANIFEST)).sha256; };
  return { root, source, localAppData, manifest, expectedManifestHash: save(), save };
}

test('uninstall preview keeps all files; apply removes only exact verified program inventory', t => {
  const f=fixture(t); const installed=firstInstall({...f,apply:true});
  const before=inventory(installed.destination);
  removeVerifiedBundle(installed.destination,f.expectedManifestHash);
  assert.deepEqual(inventory(installed.destination),before);
  removeVerifiedBundle(installed.destination,f.expectedManifestHash,true);
  assert.equal(fs.existsSync(installed.destination),false);assert.equal(fs.existsSync(f.source),true);
});
test('uninstall refuses unknown file and modified byte without partial deletion',t=>{
  const f=fixture(t);const installed=firstInstall({...f,apply:true});
  const unknown=path.join(installed.destination,'user-data.txt');fs.writeFileSync(unknown,'keep');
  assert.throws(()=>removeVerifiedBundle(installed.destination,f.expectedManifestHash,true),/mismatch/);
  assert.equal(fs.readFileSync(unknown,'utf8'),'keep');
  fs.unlinkSync(unknown);fs.appendFileSync(path.join(installed.destination,'app/dist/cli.js'),'tamper');
  assert.throws(()=>removeVerifiedBundle(installed.destination,f.expectedManifestHash,true),/mismatch/);
  assert.equal(fs.existsSync(path.join(installed.destination,MANIFEST)),true);
});

test('complete inventory is deterministic and requires independent expected checksum', t => {
  const f = fixture(t);
  assert.deepEqual(verifyBundle(f.source, f.expectedManifestHash), f.manifest);
  assert.throws(() => verifyBundle(f.source), /required/);
  assert.throws(() => verifyBundle(f.source, '0'.repeat(64)), /digest mismatch/);
});
for (const bad of ['../outside', '/absolute', 'a/../outside', 'C:/outside', 'a\\b', 'file:stream',
  'dir/NUL.txt', 'dir/COM1', 'file.', 'dir//file', './file', 'file ', 'dir/..']) {
  test(`reject Windows/path alias: ${bad}`, () => assert.throws(() => relativeFile(bad), /Unsafe/));
}
test('tampered, missing and additional files all stop before creating a destination', t => {
  const f = fixture(t), file = path.join(f.source, 'app/dist/cli.js'), original = fs.readFileSync(file);
  fs.appendFileSync(file, 'tamper');
  assert.throws(() => firstInstall({ ...f, apply: true }), /content mismatch/);
  fs.unlinkSync(file);
  assert.throws(() => verifyBundle(f.source, f.expectedManifestHash), /content mismatch/);
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(f.source, 'auth.json'), 'synthetic extra');
  assert.throws(() => firstInstall({ ...f, apply: true }), /content mismatch/);
  assert.equal(fs.existsSync(path.join(f.localAppData, 'Programs')), false);
});
test('manifest rejects duplicate, case aliases, private extra fields and missing helper', t => {
  const f = fixture(t);
  for (const item of [{ ...f.manifest.files[0] }, { ...f.manifest.files[0], path: f.manifest.files[0].path.toUpperCase() }]) {
    assert.throws(() => validateManifest({ ...f.manifest, files: [...f.manifest.files, item] }), /Invalid/);
  }
  assert.throws(() => validateManifest({ ...f.manifest, token: 'synthetic' }), /Unexpected/);
  assert.throws(() => validateManifest({ ...f.manifest, nodeVersion: ['24.19.0'] }), /Unsupported/);
  assert.throws(() => validateManifest({ ...f.manifest, files: f.manifest.files.filter(f => f.path !== 'app/native/helper.mjs') }), /Incomplete/);
});
test('manifest rejects negative sizes, manifest-self entries and traversal', t => {
  const f = fixture(t);
  for (const patch of [{ size: -1 }, { path: MANIFEST }, { path: '../../outside' }, { sha256: ['a'.repeat(64)] }]) {
    assert.throws(() => validateManifest({ ...f.manifest, files: [{ ...f.manifest.files[0], ...patch }, ...f.manifest.files.slice(1)] }));
  }
});
test('preview is read-only and first install copies exact bytes without modifying separate user config', t => {
  const f = fixture(t);
  const userConfig = path.join(f.root, '.sunmoon-agent'); fs.mkdirSync(userConfig);
  fs.writeFileSync(path.join(userConfig, 'config.json'), 'synthetic-config-keep');
  const before = inventory(f.root);
  const preview = firstInstall(f);
  assert.equal(preview.action, 'preview');
  assert.deepEqual(inventory(f.root), before);
  assert.equal(preview.startsAgent, false); assert.equal(preview.registersLogonTask, false);
  assert.equal(preview.needsAdministrator, false); assert.equal(preview.changesUserConfig, false);
  const installed = firstInstall({ ...f, apply: true });
  assert.equal(installed.action, 'installed');
  assert.deepEqual(inventory(installed.destination), inventory(f.source));
  assert.equal(fs.readFileSync(path.join(userConfig, 'config.json'), 'utf8'), 'synthetic-config-keep');
  assert.throws(() => firstInstall({ ...f, apply: true }), /already exists/);
});
test('existing empty directory is not replaced or removed', t => {
  const f = fixture(t), target = path.join(f.localAppData, 'Programs/sunmoon-agent');
  fs.mkdirSync(target, { recursive: true });
  assert.throws(() => firstInstall({ ...f, apply: true }), /already exists/);
  assert.deepEqual(fs.readdirSync(target), []);
});
test('copy interruption keeps an incomplete marker and refuses a blind second install', t => {
  const f = fixture(t), originalCopy = fs.copyFileSync;
  let copies = 0;
  fs.copyFileSync = (...args) => { if (++copies === 3) throw new Error('synthetic copy interruption'); return originalCopy(...args); };
  try { assert.throws(() => firstInstall({ ...f, apply: true }), /synthetic copy interruption/); }
  finally { fs.copyFileSync = originalCopy; }
  const target = path.join(f.localAppData, 'Programs/sunmoon-agent');
  assert.equal(fs.existsSync(path.join(target, '.install-incomplete')), true);
  assert.equal(fs.existsSync(path.join(target, 'sunmoon-agent.cmd')), false);
  assert.throws(() => firstInstall({ ...f, apply: true }), /already exists/);
});
test('source-destination nesting is refused', t => {
  const f = fixture(t);
  assert.throws(() => firstInstall({ ...f, localAppData: f.source }), /overlap/);
});
test('junction/directory-link in Programs is refused, target untouched', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.localAppData, 'Programs'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => firstInstall({ ...f, apply: true }), /link/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test('bundle directory links are rejected', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.source, 'untrusted'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyBundle(f.source, f.expectedManifestHash), /links/);
});
test('installer refuses unsupported switches rather than accidentally applying', () => {
  const entry = fileURLToPath(new URL('../install.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [entry, '--apply-now'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Unknown option/);
});
test('only explicit source inputs are included by builder; launcher uses bundled node', () => {
  const builder = fs.readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(builder, /os\.homedir|process\.env\.USERPROFILE|execSync|shell: true/);
  assert.match(builder, /writeSite/); assert.match(builder, /--site/);
  for (const file of ['sunmoon-agent.cmd', 'install.cmd', 'uninstall.cmd']) {
    const cmd = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(cmd, /%~dp0node\\node.exe/); assert.match(cmd, /--use-system-ca/);
    assert.match(cmd, /NODE_OPTIONS=/); assert.match(cmd, /bundled-ca/);
    assert.doesNotMatch(cmd, /call :launch|\bnpm\b|\bpnpm\b|powershell|ExecutionPolicy/);
  }
  const ps1 = fs.readFileSync(new URL('../../native/desktop.ps1', import.meta.url), 'utf8');
  const vbs = fs.readFileSync(new URL('../../native/run-hidden.vbs', import.meta.url), 'utf8');
  for (const source of [ps1, vbs]) {
    assert.match(source, /--use-system-ca/); assert.match(source, /NODE_OPTIONS/); assert.match(source, /bundled-ca/);
  }
  assert.match(ps1, /lastError/); assert.match(ps1, /63/);
  assert.match(ps1, /'\/\/B \/\/Nologo "' \+ \$InputData\.hiddenScript \+ '" "' \+ \$InputData\.node \+ '" "' \+ \$InputData\.cli \+ '" "' \+ \$InputData\.state \+ '"'/);
});

const devCa = fs.readFileSync(new URL('../sites/dev-kind-ca.pem', import.meta.url), 'utf8');
const devProfile = JSON.parse(fs.readFileSync(new URL('../sites/dev-kind.json', import.meta.url), 'utf8'));
test('dev site CA is the registry local CA and its DER hash is written only at pack time', t => {
  assert.equal(devCa.includes('PRIVATE KEY'), false);
  assert.equal(certificateDerSha256(devCa), '76f9012886262cf6974039de8baf16ecd5e79e780237349fdcb95a2ac1aa1b3c');
  assert.equal(devProfile.trust.ca_sha256, undefined);
  assert.throws(() => siteDocument({ ...devProfile, trust: { ...devProfile.trust, ca_sha256: 'a'.repeat(64) } }, 'unused'), /computed/);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sunmoon-site-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pem = path.join(root, 'ca.pem'); fs.writeFileSync(pem, devCa);
  const written = writeSite(root, devProfile, pem);
  assert.equal(written.trust.ca_sha256, certificateDerSha256(devCa));
  assert.match(fs.readFileSync(path.join(root, 'site', 'site.json'), 'utf8'), /"mode": "bundled-ca"/);
  const f = fixture(t);
  fs.cpSync(path.join(root, 'site'), path.join(f.source, 'site'), { recursive: true });
  const reseal = () => { fs.rmSync(path.join(f.source, MANIFEST)); f.manifest.files = inventory(f.source); return f.save(); };
  assert.equal(verifyBundle(f.source, reseal()).agentVersion, '0.2.0');
  const siteFile = path.join(f.source, 'site', 'site.json');
  const site = JSON.parse(fs.readFileSync(siteFile, 'utf8')); site.trust.ca_sha256 = '0'.repeat(64);
  fs.writeFileSync(siteFile, JSON.stringify(site));
  assert.throws(() => verifyBundle(f.source, reseal()), /Site CA digest mismatch/);
});

function shaped(t, agentVersion, omit) {
  const f = fixture(t);
  for (const name of omit) fs.rmSync(path.join(f.source, name), { force: true });
  fs.rmSync(path.join(f.source, MANIFEST));
  f.manifest.agentVersion = agentVersion;
  f.manifest.files = inventory(f.source);
  f.expectedManifestHash = f.save();
  return f;
}

test('an installed 0.2.1-shaped tree is removed from its own manifest and a new package still requires the current layout', t => {
  const old = shaped(t, '0.2.1', ['installer/launch.mjs', 'installer/upgrade.mjs']);
  assert.equal(fs.existsSync(path.join(old.source, 'site')), false);
  assert.throws(() => verifyBundle(old.source, old.expectedManifestHash), /Incomplete or oversized bundle/);
  assert.throws(() => firstInstall({ ...old, apply: true }), /Incomplete or oversized bundle/);
  assert.equal(fs.existsSync(path.join(old.localAppData, 'Programs')), false);
  const installed = path.join(old.root, 'installed-021');
  fs.cpSync(old.source, installed, { recursive: true });
  const outside = path.join(old.root, 'kept-config.json');
  fs.writeFileSync(outside, 'synthetic-config-keep');
  const found = inspectInstalled(installed);
  assert.equal(found.installedVersion, '0.2.1');
  assert.equal(found.installedManifestSha256, old.expectedManifestHash);
  assert.deepEqual(decideUpgrade(found.installedVersion, '0.2.2'), { action: 'upgrade', preserveConfig: true, installedVersion: '0.2.1' });
  removeVerifiedBundle(installed, found.installedManifestSha256, true);
  assert.equal(fs.existsSync(installed), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'synthetic-config-keep');
});

test('uninstall clears a dead leftover tray stop on a 0.2.1 tree before the old CLI and keeps config', t => {
  const old = shaped(t, '0.2.1', ['installer/launch.mjs', 'installer/upgrade.mjs']);
  const installed = path.join(old.root, 'installed-021-tray');
  fs.cpSync(old.source, installed, { recursive: true });
  const state = path.join(old.root, 'state');
  fs.mkdirSync(state);
  const run = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const stop = path.join(state, 'tray-stop.json');
  const tray = path.join(state, 'tray.json');
  fs.writeFileSync(path.join(state, 'config.json'), 'synthetic-config-keep');
  fs.writeFileSync(stop, JSON.stringify({ pid: 424242, runId: run }));
  fs.writeFileSync(tray, JSON.stringify({ pid: 424242, runId: run }));
  assert.equal(clearStaleTray(state, () => true), 'pending');
  assert.equal(fs.existsSync(stop), true);
  assert.equal(clearStaleTray(state, () => false), 'cleared');
  assert.equal(fs.existsSync(stop), false);
  assert.equal(fs.existsSync(tray), false);
  removeVerifiedBundle(installed, inspectInstalled(installed).installedManifestSha256, true);
  assert.equal(fs.existsSync(installed), false);
  assert.equal(fs.readFileSync(path.join(state, 'config.json'), 'utf8'), 'synthetic-config-keep');
  const linked = path.join(old.root, 'linked');
  fs.mkdirSync(linked);
  const target = path.join(linked, 'target.json');
  fs.writeFileSync(target, JSON.stringify({ pid: 1, runId: run }));
  fs.symlinkSync(target, path.join(linked, 'tray-stop.json'));
  assert.throws(() => clearStaleTray(linked, () => false), /Unsafe tray status/);
  assert.equal(fs.readFileSync(path.join(linked, 'tray-stop.json'), 'utf8'), fs.readFileSync(target, 'utf8'));
  const script = fs.readFileSync(fileURLToPath(new URL('../uninstall.mjs', import.meta.url)), 'utf8');
  const clearAt = script.indexOf('clearStaleTray(state, pidAlive)');
  const trayAt = script.indexOf("invoke(['tray','stop'])");
  assert.equal(clearAt > 0 && clearAt < trayAt, true);
});

test('0.2.2 and same-version decisions keep config and never replace a newer install', t => {
  const current = shaped(t, '0.2.2', []);
  const found = inspectInstalled(current.source);
  assert.equal(found.installedVersion, '0.2.2');
  assert.deepEqual(decideUpgrade('0.2.2', '0.2.2'), { action: 'open', preserveConfig: true, installedVersion: '0.2.2' });
  assert.deepEqual(decideUpgrade('0.2.1', '0.2.2'), { action: 'upgrade', preserveConfig: true, installedVersion: '0.2.1' });
  assert.deepEqual(decideUpgrade('0.2.2', '0.2.3'), { action: 'upgrade', preserveConfig: true, installedVersion: '0.2.2' });
  assert.deepEqual(decideUpgrade('0.2.3', '0.2.2'), { action: 'refuse', preserveConfig: true, installedVersion: '0.2.3' });
  assert.deepEqual(decideUpgrade(null, '0.2.2'), { action: 'install', preserveConfig: true });
  assert.equal(fs.existsSync(path.join(current.source, 'installer/launch.mjs')), true);
});

test('install script upgrades either installed shape without an overwrite switch', () => {
  const text = fs.readFileSync(fileURLToPath(new URL('../install.ps1.tmpl', import.meta.url)), 'utf8');
  const names = ['PACKAGE_URL', 'VERSION', 'SIZE_BYTES', 'ZIP_SHA256', 'MANIFEST_SHA256', 'CODEX_VERSION'];
  for (const name of names) assert.equal(text.split(`{{${name}}}`).length - 1, 1, name);
  const leftover = text.replace(/\{\{(?:PACKAGE_URL|VERSION|SIZE_BYTES|ZIP_SHA256|MANIFEST_SHA256|CODEX_VERSION)\}\}/g, '');
  assert.equal(/\{\{[A-Z0-9_]+\}\}/.test(leftover), false);
  assert.match(text, /installer\\upgrade\.mjs/);
  assert.match(text, /installer\\uninstall\.mjs/);
  assert.match(text, /installer\\install\.mjs/);
  assert.equal(text.includes('--remove-config'), false);
  assert.equal(text.includes('ExecutionPolicy'), false);
  assert.match(text, /安装目录还在，没有覆盖已有安装/);
  assert.match(text, /SunMoon 代理/);
  assert.match(text, /autostart enable/);
  assert.match(text, /请在弹出的窗口里继续/);
  const desktop = fs.readFileSync(fileURLToPath(new URL('../../native/desktop.ps1', import.meta.url)), 'utf8');
  for (const label of ['连接我的账号', '不选的话工作和专家碰不到你的文件', '开机自动运行', '重新连接账号', '已在线', '重新获取连接码', '连接没有完成，请重新获取。', 'BeginErrorReadLine', 'web_origin']) {
    assert.equal(desktop.includes(label), true, label);
  }
});
