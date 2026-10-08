// Read/execute only this candidate; first install goes to a unique synthetic LocalAppData.
// No init/start, real config reads, registry/task changes, UAC or application-control changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyBundle } from '../bundle.mjs';

assert.equal(process.platform, 'win32');
const [bundlePath, expectedManifestHash] = process.argv.slice(2);
assert.ok(bundlePath && expectedManifestHash, 'candidate path and trusted manifest SHA256 required');
const bundle = path.resolve(bundlePath);
const manifest = verifyBundle(bundle, expectedManifestHash);
const temp = fs.mkdtempSync(path.join(path.dirname(bundle), 'candidate-install-check-'));
const localAppData = path.join(temp, 'Local'); fs.mkdirSync(localAppData);
const privateHome = path.join(temp, '.sunmoon-agent'); fs.mkdirSync(privateHome);
fs.writeFileSync(path.join(privateHome, 'config.json'), 'synthetic-preserve-marker');
const env = { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32'),
  LOCALAPPDATA: localAppData, SUNMOON_AGENT_HOME: privateHome, CODEX_HOME: path.join(temp, 'codex-home') };
delete env.NODE_OPTIONS; delete env.NODE_PATH;
function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: temp, env, encoding: 'utf8', timeout: 60000, shell: false,
    windowsHide: true, windowsVerbatimArguments: path.basename(exe).toLowerCase() === 'cmd.exe' });
  if (result.error || result.status !== 0) throw new Error(`Candidate command failed: ${result.error?.code ?? result.status}: ${result.stderr}`);
  return result.stdout.trim();
}
const node = path.join(bundle, 'node/node.exe');
assert.equal(run(node, ['--version']), `v${manifest.nodeVersion}`);
assert.equal(run(node, [path.join(bundle, 'app/dist/cli.js'), '--version']), manifest.agentVersion);
assert.match(run(node, [path.join(bundle, 'app/dist/cli.js'), '--help']), /sunmoon-agent/);
// This check itself runs on bundled Node, so helper.node is also the bundled executable.
assert.equal(process.execPath.toLowerCase(), node.toLowerCase());
const { locateCodex } = await import(pathToFileURL(path.join(bundle, 'app/dist/paths.js')));
const { locateWindowsHelper } = await import(pathToFileURL(path.join(bundle, 'app/dist/windowsRuntime.js')));
const codex = locateCodex(), helper = locateWindowsHelper();
assert.equal(codex.version, manifest.codexVersion);
assert.equal(helper.node.toLowerCase(), node.toLowerCase());
assert.ok(helper.script.startsWith(bundle));
assert.match(run(codex.codexBin, ['--version']), new RegExp(manifest.codexVersion.replaceAll('.', '\\.')));
const req = createRequire(path.join(bundle, 'app/package.json'));
assert.equal(typeof req('ws'), 'function');
assert.equal(req('smol-toml').parse('ok = true').ok, true);
const installer = path.join(bundle, 'installer/install.mjs');
const preview = JSON.parse(run(node, [installer, '--manifest-sha256', expectedManifestHash]));
assert.equal(preview.action, 'preview'); assert.equal(fs.existsSync(preview.destination), false);
const installed = JSON.parse(run(node, [installer, '--manifest-sha256', expectedManifestHash, '--apply']));
verifyBundle(installed.destination, expectedManifestHash);
assert.equal(installed.action, 'installed');
assert.equal(run(path.join(installed.destination, 'node/node.exe'), [path.join(installed.destination, 'app/dist/cli.js'), '--version']), manifest.agentVersion);
// Exercise the actual .cmd with no separately installed Node available through PATH.
assert.doesNotMatch(installed.destination, /[%!\r\n&|<>^]/);
assert.equal(run(path.join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/s', '/c',
  `""${path.join(installed.destination, 'sunmoon-agent.cmd')}" --version"`]), manifest.agentVersion);
assert.equal(fs.readFileSync(path.join(privateHome, 'config.json'), 'utf8'), 'synthetic-preserve-marker');
assert.equal(fs.existsSync(path.join(privateHome, 'status.json')), false);
fs.rmSync(temp, { recursive: true }); // This check's own unique fixture; all child commands have exited.
console.log(JSON.stringify({ result: 'pass', node: manifest.nodeVersion, codex: manifest.codexVersion,
  agent: manifest.agentVersion, manifestSha256: expectedManifestHash, files: manifest.files.length + 1,
  withoutNodeOnPath: true, launchedAgent: false, realUserInstall: false, isolatedInstall: installed.destination, isolatedInstallRemoved: true,
  note: 'Fresh Windows without Node, tray, lifecycle, UAC and logon task acceptance are still pending' }, null, 2));
