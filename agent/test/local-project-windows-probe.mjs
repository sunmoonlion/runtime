// 0024 Windows acceptance: new-project folder through the writable sandboxed helper, and git clone.
// Isolated source and synthetic roots; the installed agent, live account and login tasks are never modified.
// node test/local-project-windows-probe.mjs <isolated app dir> [public https repo] [private https repo]
// A token for the private repo comes only from env SUNMOON_PROBE_TOKEN and is never printed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (process.platform !== 'win32') throw new Error('Windows required');
const app = path.resolve(process.argv[2]);
const publicRepo = process.argv[3] ?? 'https://github.com/octocat/Hello-World.git';
const privateRepo = process.argv[4] ?? null;
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sunmoon-project-041-'));
const root = path.join(fixture, 'allowed'), library = path.join(fixture, 'library'), home = path.join(fixture, 'state', 'codex-home');
for (const dir of [root, library, home]) fs.mkdirSync(dir, { recursive: true });
process.env.SUNMOON_AGENT_HOME = path.dirname(home);
const load = name => import(pathToFileURL(path.join(app, 'dist', name + '.js')).href);
const { setLevel } = await load('log'); setLevel('error');
const { locateCodex } = await load('paths');
const { ExecServer } = await load('execServer');
const { WindowsTemporary, pinWindowsDirectories, runSandboxProbe, WindowsFiles, killWindowsTree } = await load('windowsRuntime');
const { LocalProjects } = await load('localProjects');
const helper = { node: process.execPath, script: path.join(app, 'native', 'helper.mjs') }, codex = locateCodex();
assert.equal(codex.version, '0.155.1');
const temp = await WindowsTemporary.create(home, [root], helper), release = await pinWindowsDirectories(helper, [root, home], home);
const es = new ExecServer({ codexBin: codex.codexBin, bwrap: null, outerSandbox: false, roots: [root], codexHome: home, port: 0, windowsMode: 'unelevated', windowsTemporary: temp });
const code = promise => promise.then(() => 'ok', error => error.code ?? String(error.message));
const result = { stage: '0024-1', platform: 'win32', agent: JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version, codex: codex.version, sandbox: 'unelevated' };
let worker;
try {
  await es.start(); assert(await runSandboxProbe(es.url, home, root, 'unelevated', temp.directory));
  worker = new WindowsFiles({ url: () => es.url, home, roots: [root], mode: 'unelevated', writable: true, helper, temporary: temp.directory });
  const make = (extra = {}) => new LocalProjects({ roots: () => [root], denied: () => [library, home], ceiling: () => ({ sandbox: 'workspace-write', network: false }), platform: 'win32', files: worker, kill: killWindowsTree, ...extra });
  const projects = make();

  const nested = path.join(root, '桌面项目', 'MyProject 财务预测');
  assert.deepEqual(await projects.folder(nested), { path: nested, created: true });
  assert(fs.statSync(nested).isDirectory()); assert(fs.readdirSync(path.join(root, '桌面项目')).includes('MyProject 财务预测'));
  result.chinese_nested_folder = true; result.case_kept = true;
  assert.equal((await projects.folder(nested)).created, false); result.existing_folder_not_created = true;
  assert.equal((await projects.folder(root)).created, false); result.root_as_project = true;
  assert.equal(await code(projects.folder(path.join(fixture, 'outside'))), 'outside_whitelist'); assert(!fs.existsSync(path.join(fixture, 'outside')));
  assert.equal(await code(projects.folder(path.join(library, 'x'))), 'outside_whitelist'); result.outside_and_library_denied = true;
  fs.writeFileSync(path.join(root, 'a-file'), 'x');
  assert.equal(await code(projects.folder(path.join(root, 'a-file'))), 'not_a_directory'); result.file_in_the_way_409 = true;
  fs.symlinkSync(fixture, path.join(root, 'junction'), 'junction');
  assert.equal(await code(projects.folder(path.join(root, 'junction', 'escaped'))), 'outside_whitelist');
  assert(!fs.existsSync(path.join(fixture, 'escaped'))); result.junction_denied = true;
  const readOnly = make({ ceiling: () => ({ sandbox: 'read-only', network: true }) });
  assert.equal(await code(readOnly.folder(path.join(root, 'ro'))), 'local_read_only'); result.read_only_denied = true;

  const cloned = path.join(root, 'hello');
  const made = await projects.clone({ url: publicRepo, path: cloned });
  assert(fs.existsSync(path.join(cloned, '.git'))); result.public_clone = true; result.public_branch = made.branch;
  fs.mkdirSync(path.join(root, 'busy')); fs.writeFileSync(path.join(root, 'busy', 'x'), '1');
  assert.equal(await code(projects.clone({ url: publicRepo, path: path.join(root, 'busy') })), 'target_not_empty'); result.non_empty_denied = true;
  assert.equal(await code(projects.clone({ url: 'file:///C:/Windows', path: path.join(root, 'f') })), 'invalid_url'); result.file_transport_denied = true;
  assert.equal(await code(make({ timeoutMs: 1 }).clone({ url: publicRepo, path: path.join(root, 'timeout') })), 'clone_timeout');
  assert(!fs.existsSync(path.join(root, 'timeout'))); result.timeout_removes_folder = true;

  if (privateRepo) {
    const target = path.join(root, 'private');
    result.private_without_token = await code(projects.clone({ url: privateRepo, path: target }));
    assert(!fs.existsSync(target));
    if (process.env.SUNMOON_PROBE_TOKEN) {
      await projects.clone({ url: privateRepo, path: target, auth: { token: process.env.SUNMOON_PROBE_TOKEN } });
      assert(fs.existsSync(path.join(target, '.git'))); result.private_with_token = true;
    }
  }
  console.log(JSON.stringify(result));
} finally {
  await worker?.close(); await es.stop(); await release.close(); await temp.close();
  try { fs.unlinkSync(path.join(root, 'junction')); } catch {}
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
