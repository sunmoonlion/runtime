import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MANIFEST, relativeFile, digest, inventory, firstInstall, verifyBundle, validateManifest } from '../bundle.mjs';

const samplePaths = [
  'node/node.exe', 'licenses/node-LICENSE', 'licenses/codex-LICENSE', 'licenses/codex-NOTICE',
  'app/package.json', 'app/dist/cli.js', 'app/native/helper.mjs',
  'app/node_modules/@openai/codex/package.json',
  'app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
  'app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex-resources/codex-command-runner.exe',
  'app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe',
  'app/node_modules/smol-toml/package.json', 'app/node_modules/ws/package.json',
  'sunmoon-agent.cmd', 'install.cmd', 'installer/install.mjs', 'installer/bundle.mjs',
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
  for (const file of ['sunmoon-agent.cmd', 'install.cmd']) {
    const cmd = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(cmd, /%~dp0node\\node.exe/); assert.doesNotMatch(cmd, /\bnpm\b|\bpnpm\b|powershell|ExecutionPolicy/);
  }
});
