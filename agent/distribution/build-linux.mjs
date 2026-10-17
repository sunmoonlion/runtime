// Developer entry: assemble the Linux x64 agent directory for the knowbot test computer
// (SDD 0027 §3.4). Same sources and checks as the Windows builder; no Node, no Windows UI or
// installer — the test computer runs it with the Node of its runtime image. Produces a directory
// and a deterministic .tar.gz next to it. No download, npm lifecycle hook or credential import.
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
const settings = JSON.parse(fs.readFileSync(path.join(here, 'linux-x64.json'), 'utf8'));
function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 600000, shell: false });
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
  if (!spec.resolveFrom) return checkedPackage(fs.realpathSync(path.join(dependencies, 'node_modules', spec.installName)), spec);
  const parent = path.join(dependencies, 'node_modules', spec.resolveFrom, 'package.json');
  const req = createRequire(fs.realpathSync(parent));
  return checkedPackage(path.dirname(req.resolve(`${spec.installName}/package.json`)), spec);
}
function copyTree(source, destination) {
  for (const file of inventory(source)) {
    if (/(^|\/)(?:auth\.json|config\.toml|\.npmrc|\.env(?:\..*)?|.*\.pem|.*\.key)$/i.test(file.path)) {
      throw new Error('Private/config material found in a production package');
    }
    makeSubdirectory(destination, path.posix.dirname(file.path));
    copyFile(path.join(source, file.path), path.join(destination, file.path));
    // 平台包里的原生程序要能执行（copyFile 不带权限位）
    const mode = fs.statSync(path.join(source, file.path)).mode & 0o111;
    if (mode) fs.chmodSync(path.join(destination, file.path), 0o755);
  }
}

try {
  const { values } = parseArgs({ options: {
    dependencies: { type: 'string' }, output: { type: 'string' }, site: { type: 'string' }, 'ca-pem': { type: 'string' },
  }, allowPositionals: false, strict: true });
  if (!values.dependencies || !values.output || !values.site) {
    throw new Error('Usage: node build-linux.mjs --dependencies <Linux agent directory> --site <profile.json> --output <new directory> [--ca-pem <certificate>]');
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build the Linux package on Linux x64');
  const profile = JSON.parse(fs.readFileSync(values.site, 'utf8'));
  const output = path.resolve(values.output), deps = plainDirectory(values.dependencies);
  const tarball = `${output}.tar.gz`;
  plainDirectory(path.dirname(output));
  if (exists(output) || exists(tarball)) throw new Error('Output already exists; choose a new directory');
  const tracked = ['agent/src', 'agent/package.json', 'agent/tsconfig.json', 'agent/pnpm-lock.yaml', 'agent/distribution'];
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
  if (!lock.equals(fs.readFileSync(path.join(deps, 'pnpm-lock.yaml')))) throw new Error('Linux dependency lock differs from source');
  const roots = settings.packages.map(spec => [spec, packageDirectory(deps, spec)]);
  const staging = fs.mkdtempSync(path.join(path.dirname(output), '.sunmoon-linux-package-'));
  console.log(`Staging: ${staging}`);
  for (const subdir of ['app/dist', 'app/node_modules', 'licenses', 'installer']) makeSubdirectory(staging, subdir);
  run(process.execPath, [path.join(agent, 'node_modules/typescript/bin/tsc'), '-p', path.join(agent, 'tsconfig.json'),
    '--outDir', path.join(staging, 'app/dist'), '--sourceMap', 'false', '--incremental', 'false']);
  const compiled = inventory(path.join(staging, 'app/dist'));
  if (!compiled.length || compiled.some(file => !file.path.endsWith('.js'))) throw new Error('Unexpected compiler output');
  fs.writeFileSync(path.join(staging, 'app/package.json'), JSON.stringify({ name: sourcePackage.name,
    version: sourcePackage.version, private: true, type: 'module', engines: sourcePackage.engines,
    dependencies: Object.fromEntries(settings.packages.filter(p => !p.resolveFrom).map(p => [p.installName, p.version])),
  }, null, 2) + '\n', { flag: 'wx' });
  for (const [spec, directory] of roots) {
    const target = `app/node_modules/${spec.installName}`;
    makeSubdirectory(staging, target);
    copyTree(directory, path.join(staging, target));
  }
  for (const file of ['codex-LICENSE', 'codex-NOTICE']) copyFile(path.join(here, 'licenses', file), path.join(staging, 'licenses', file));
  for (const file of ['bundle.mjs', 'launch.mjs', 'verify-linux.mjs']) copyFile(path.join(here, file), path.join(staging, 'installer', file));
  writeSite(staging, profile, values['ca-pem']);
  const manifest = { schema: 1, platform: settings.platform, architecture: settings.architecture,
    agentVersion: settings.agentVersion, codexVersion: settings.codexVersion, nodeVersion: settings.node.version,
    relayProtocol: settings.relayProtocol, sourceRevision: revision, dependencyLockSha256: digest(path.join(agent, 'pnpm-lock.yaml')).sha256,
    files: inventory(staging) };
  fs.writeFileSync(path.join(staging, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const sha = digest(path.join(staging, MANIFEST)).sha256;
  verifyBundle(staging, sha, { platform: 'linux' });
  if (run('git', ['rev-parse', 'HEAD']) !== revision || run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...tracked])) {
    throw new Error('Source changed during assembly');
  }
  if (exists(output) || exists(tarball)) throw new Error('Output appeared during assembly');
  fs.renameSync(staging, output);
  // 可复现的归档：文件按名字排序、时间与属主固定、权限归一（umask 不同的机器打出同一个摘要，0028 R5.3），
  // 同一份目录打出同一个摘要
  run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--format=gnu',
    '--mode=u=rwX,go=rX',
    '-C', output, '-cf', `${output}.tar`, '.'], path.dirname(output));
  run('gzip', ['-n', '-9', `${output}.tar`], path.dirname(output));
  const archive = digest(tarball);
  console.log(JSON.stringify({ output, tarball, tarballSha256: archive.sha256, tarballBytes: archive.size,
    manifestSha256: sha, sourceRevision: revision, files: manifest.files.length + 1,
    status: 'candidate; no agent started and no installation performed' }, null, 2));
} catch (error) { console.error(`Assembly stopped: ${error.message}`); process.exitCode = 1; }
