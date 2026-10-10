// Decides whether a downloaded package may install. It never deletes or copies files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MANIFEST, digest, exists, verifyBundle } from './bundle.mjs';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function compareVersions(left, right) {
  const a = VERSION.exec(left), b = VERSION.exec(right);
  if (!a || !b) throw new Error('版本号无法识别');
  for (let i = 1; i <= 3; i++) {
    const delta = Number(a[i]) - Number(b[i]);
    if (delta) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function decideUpgrade(installedVersion, incomingVersion) {
  if (installedVersion == null) return { action: 'install', preserveConfig: true };
  const order = compareVersions(installedVersion, incomingVersion);
  if (order === 0) return { action: 'open', preserveConfig: true, installedVersion };
  if (order < 0) return { action: 'upgrade', preserveConfig: true, installedVersion };
  return { action: 'refuse', preserveConfig: true, installedVersion };
}

// The installed directory is accepted on its own manifest. The current REQUIRED
// list is not applied, so a 0.2.1 tree without launch.mjs or site/ still resolves.
export function inspectInstalled(directory) {
  if (!exists(directory)) return null;
  const manifestFile = path.join(directory, MANIFEST);
  const manifestSha256 = digest(manifestFile).sha256;
  const manifest = verifyBundle(directory, manifestSha256, { requireLayout: false });
  return { installedVersion: manifest.agentVersion, installedManifestSha256: manifestSha256 };
}

function main() {
  const { values } = parseArgs({ options: {
    installed: { type: 'string' }, 'incoming-version': { type: 'string' },
  }, allowPositionals: false, strict: true });
  if (!values.installed || !values['incoming-version']) throw new Error('installed directory and incoming version are required');
  const found = inspectInstalled(path.resolve(values.installed));
  const decision = decideUpgrade(found?.installedVersion ?? null, values['incoming-version']);
  console.log(JSON.stringify({ ...decision, installedManifestSha256: found?.installedManifestSha256 ?? null }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
