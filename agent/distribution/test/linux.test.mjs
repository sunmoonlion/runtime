// Linux 包（分身测试的测试电脑用，SDD 0027 §3.4）：清单按平台核，Windows 安装器不会接受它。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MANIFEST, digest, inventory, validateManifest, verifyBundle } from '../bundle.mjs';

const linuxPaths = [
  'licenses/codex-LICENSE', 'licenses/codex-NOTICE',
  'app/package.json', 'app/dist/cli.js',
  'app/node_modules/@openai/codex/package.json',
  'app/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex',
  'app/node_modules/smol-toml/package.json', 'app/node_modules/ws/package.json',
  'installer/bundle.mjs', 'installer/launch.mjs',
];

function linuxFixture(t, paths = linuxPaths) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sunmoon-linux-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of paths) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `synthetic: ${file}\n`);
  }
  const manifest = { schema: 1, platform: 'linux', architecture: 'x64', agentVersion: '0.4.1', codexVersion: '0.155.1',
    nodeVersion: '24.21.0', relayProtocol: 1, sourceRevision: 'a'.repeat(40), dependencyLockSha256: 'b'.repeat(64), files: inventory(root) };
  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify(manifest));
  return { root, manifest, sha: digest(path.join(root, MANIFEST)).sha256 };
}

test('a Linux bundle verifies only when the caller asks for Linux', t => {
  const f = linuxFixture(t);
  assert.equal(verifyBundle(f.root, f.sha, { platform: 'linux' }).platform, 'linux');
  // 默认是 Windows：安装器、升级、卸载不会把 Linux 包当成 Windows 包装进去
  assert.throws(() => verifyBundle(f.root, f.sha), /Unsupported/);
  assert.throws(() => validateManifest({ ...f.manifest, platform: 'darwin' }, { platform: 'darwin' }), /Unsupported/);
});

test('a Linux bundle without the Linux codex binary is incomplete', t => {
  const f = linuxFixture(t, linuxPaths.filter(p => !p.endsWith('/bin/codex')));
  assert.throws(() => verifyBundle(f.root, f.sha, { platform: 'linux' }), /Incomplete/);
});

test('verify-linux.mjs checks an unpacked bundle and reports its versions', t => {
  const f = linuxFixture(t);
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'verify-linux.mjs');
  const ok = spawnSync(process.execPath, [script, f.root, f.sha], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).verified, true);
  fs.appendFileSync(path.join(f.root, 'app/dist/cli.js'), 'tamper');
  const bad = spawnSync(process.execPath, [script, f.root, f.sha], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /content mismatch/);
});
