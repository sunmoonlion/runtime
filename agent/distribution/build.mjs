// Developer entry: assemble a Windows directory from frozen, already installed materials.
// No downloader, npm lifecycle hook, credential import, system install or executable compilation.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { MANIFEST, copyFile, digest, exists, inventory, makeSubdirectory, plainDirectory, verifyBundle } from './bundle.mjs';
import { writeSite } from './launch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const agent = path.dirname(here), repo = path.dirname(agent);
const settings = JSON.parse(fs.readFileSync(path.join(here, 'windows-x64.json'), 'utf8'));
function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, shell: false });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.error?.code ?? result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  return result.stdout.trim();
}
function checkedPackage(directory, spec) {
  plainDirectory(directory);
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (pkg.name !== spec.name || pkg.version !== spec.version || Object.keys(pkg.dependencies ?? {}).length) {
    throw new Error(`Package version or dependency graph changed: ${spec.installName}`);
  }
  return directory;
}
function packageDirectory(dependencies, spec) {
  // Only this package root is resolved through pnpm's links; all files within must be plain.
  if (!spec.resolveFrom) return checkedPackage(fs.realpathSync(path.join(dependencies, 'node_modules', spec.installName)), spec);
  const parent = path.join(dependencies, 'node_modules', spec.resolveFrom, 'package.json');
  const req = createRequire(fs.realpathSync(parent));
  return checkedPackage(path.dirname(req.resolve(`${spec.installName}/package.json`)), spec);
}
function copyTree(source, destination) {
  const files = inventory(source);
  for (const file of files) {
    if (/(^|\/)(?:auth\.json|config\.toml|\.npmrc|\.env(?:\..*)?|.*\.pem|.*\.key)$/i.test(file.path)) {
      throw new Error('Private/config material found in a production package');
    }
    makeSubdirectory(destination, path.posix.dirname(file.path));
    copyFile(path.join(source, file.path), path.join(destination, file.path));
  }
}

try {
  const { values } = parseArgs({ options: {
    'node-exe': { type: 'string' }, dependencies: { type: 'string' }, output: { type: 'string' },
    site: { type: 'string' }, 'ca-pem': { type: 'string' },
  }, allowPositionals: false, strict: true });
  if (!values['node-exe'] || !values.dependencies || !values.output || !values.site) {
    throw new Error('Usage: node build.mjs --node-exe <official node.exe> --dependencies <Windows agent directory> --site <profile.json> --output <new directory> [--ca-pem <certificate>]');
  }
  const profile = JSON.parse(fs.readFileSync(values.site, 'utf8'));
  const output = path.resolve(values.output), deps = plainDirectory(values.dependencies);
  plainDirectory(path.dirname(output));
  if (exists(output)) throw new Error('Output already exists; choose a new directory');
  if (digest(values['node-exe']).sha256 !== settings.node.sha256) throw new Error('Official Node digest mismatch');
  if (digest(path.join(here, 'licenses/node-LICENSE')).sha256 !== settings.node.licenseSha256) throw new Error('Node license digest mismatch');
  const tracked = ['agent/src', 'agent/native', 'agent/package.json', 'agent/tsconfig.json', 'agent/pnpm-lock.yaml', 'agent/distribution'];
  if (run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...tracked])) {
    throw new Error('Commit source and distribution changes locally before building');
  }
  const revision = run('git', ['rev-parse', 'HEAD']);
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(agent, 'package.json'), 'utf8'));
  if (sourcePackage.version !== settings.agentVersion || sourcePackage.dependencies['@openai/codex'] !== settings.codexVersion ||
      Object.keys(sourcePackage.dependencies).sort().join(',') !== '@openai/codex,smol-toml,ws') {
    throw new Error('Agent/dependency versions need an explicit distribution update');
  }
  const lock = fs.readFileSync(path.join(agent, 'pnpm-lock.yaml'));
  if (!lock.equals(fs.readFileSync(path.join(deps, 'pnpm-lock.yaml')))) throw new Error('Windows dependency lock differs from source');
  const roots = settings.packages.map(spec => [spec, packageDirectory(deps, spec)]);
  const staging = fs.mkdtempSync(path.join(path.dirname(output), '.sunmoon-package-'));
  // Retain failed staging for diagnosis; never automatically delete unknown files or prior packages.
  console.log(`Staging: ${staging}`);
  for (const subdir of ['app/dist', 'app/native', 'app/node_modules', 'node', 'licenses', 'installer']) makeSubdirectory(staging, subdir);
  run(process.execPath, [path.join(agent, 'node_modules/typescript/bin/tsc'), '-p', path.join(agent, 'tsconfig.json'),
    '--outDir', path.join(staging, 'app/dist'), '--sourceMap', 'false', '--incremental', 'false']);
  const compiled = inventory(path.join(staging, 'app/dist'));
  if (!compiled.length || compiled.some(file => !file.path.endsWith('.js'))) throw new Error('Unexpected compiler output');
  fs.writeFileSync(path.join(staging, 'app/package.json'), JSON.stringify({ name: sourcePackage.name,
    version: sourcePackage.version, private: true, type: 'module', engines: sourcePackage.engines,
    dependencies: Object.fromEntries(settings.packages.filter(p => !p.resolveFrom).map(p => [p.installName, p.version])),
  }, null, 2) + '\n', { flag: 'wx' });
  for (const name of ['helper.mjs', 'desktop.ps1', 'run-hidden.vbs', 'elevated-setup.ps1']) copyFile(path.join(agent, 'native', name), path.join(staging, 'app/native', name));
  for (const [spec, directory] of roots) {
    const target = `app/node_modules/${spec.installName}`;
    makeSubdirectory(staging, target);
    copyTree(directory, path.join(staging, target));
  }
  copyFile(values['node-exe'], path.join(staging, 'node/node.exe'));
  for (const file of ['node-LICENSE', 'codex-LICENSE', 'codex-NOTICE']) {
    copyFile(path.join(here, 'licenses', file), path.join(staging, 'licenses', file));
  }
  for (const file of ['bundle.mjs', 'install.mjs', 'uninstall.mjs', 'launch.mjs', 'upgrade.mjs']) copyFile(path.join(here, file), path.join(staging, 'installer', file));
  for (const file of ['sunmoon-agent.cmd', 'install.cmd', 'uninstall.cmd']) {
    const content = fs.readFileSync(path.join(here, file), 'utf8').replace(/\r?\n/g, '\r\n');
    fs.writeFileSync(path.join(staging, file), content, { flag: 'wx' });
  }
  copyFile(path.join(here, 'PACKAGE-README.txt'), path.join(staging, 'README.txt'));
  writeSite(staging, profile, values['ca-pem']);
  const manifest = { schema: 1, platform: settings.platform, architecture: settings.architecture,
    agentVersion: settings.agentVersion, codexVersion: settings.codexVersion, nodeVersion: settings.node.version,
    relayProtocol: settings.relayProtocol, sourceRevision: revision, dependencyLockSha256: digest(path.join(agent, 'pnpm-lock.yaml')).sha256,
    files: inventory(staging) };
  fs.writeFileSync(path.join(staging, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const sha = digest(path.join(staging, MANIFEST)).sha256;
  verifyBundle(staging, sha);
  // Source must stay fixed throughout the compile/copy; stage-2 work in other repositories is independent.
  if (run('git', ['rev-parse', 'HEAD']) !== revision || run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...tracked])) {
    throw new Error('Source changed during assembly');
  }
  if (exists(output)) throw new Error('Output appeared during assembly');
  fs.renameSync(staging, output);
  console.log(JSON.stringify({ output, manifestSha256: sha, sourceRevision: revision,
    files: manifest.files.length + 1, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
    status: 'candidate; no agent started and no installation performed' }, null, 2));
} catch (error) { console.error(`Assembly stopped: ${error.message}`); process.exitCode = 1; }
