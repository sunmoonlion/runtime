import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { firstInstall } from './bundle.mjs';

try {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false },
    'manifest-sha256': { type: 'string' },
  }, allowPositionals: false, strict: true });
  if (process.platform !== 'win32' || process.arch !== 'x64' || !process.env.LOCALAPPDATA) {
    throw new Error('First installation requires Windows x64 and LOCALAPPDATA');
  }
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(JSON.stringify(firstInstall({ source, localAppData: process.env.LOCALAPPDATA,
    expectedManifestHash: values['manifest-sha256'], apply: values.apply }), null, 2));
} catch (error) { console.error(`Installation stopped: ${error.message}`); process.exitCode = 1; }
