// Pack-time site files and the one Node launch used by uninstall. No network.
import fs from 'node:fs';
import path from 'node:path';
import { X509Certificate, createHash } from 'node:crypto';

const HOST = /^[A-Za-z0-9.-]{1,253}$/;

export function certificateDerSha256(pem) {
  if (typeof pem !== 'string' || pem.includes('PRIVATE KEY')) throw new Error('Site CA must be a certificate, not a private key');
  return createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');
}

export function siteDocument(profile, caPem) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Site profile is not an object');
  const trust = profile.trust;
  if (!trust || typeof trust !== 'object' || profile.trust.ca_sha256) throw new Error('ca_sha256 is computed when the package is built');
  if (typeof profile.site !== 'string' || typeof profile.web_origin !== 'string' || typeof profile.relay_url !== 'string') {
    throw new Error('Site profile is missing site, web_origin, or relay_url');
  }
  if (trust.mode === 'bundled-ca') {
    if (trust.ca_file !== 'site/ca.pem' || typeof caPem !== 'string') throw new Error('bundled-ca packages require site/ca.pem');
    const pem = fs.readFileSync(caPem, 'utf8');
    return {
      site: profile.site, web_origin: profile.web_origin, relay_url: profile.relay_url,
      trust: { mode: 'bundled-ca', ca_file: 'site/ca.pem', ca_sha256: certificateDerSha256(pem) },
      pem,
    };
  }
  if (trust.mode === 'system') {
    if (caPem || trust.ca_file) throw new Error('system trust does not bundle a CA');
    return { site: profile.site, web_origin: profile.web_origin, relay_url: profile.relay_url, trust: { mode: 'system' }, pem: null };
  }
  throw new Error('Unsupported site trust mode');
}

export function writeSite(directory, profile, caPem) {
  const site = siteDocument(profile, caPem);
  const dir = path.join(directory, 'site');
  fs.mkdirSync(dir);
  const body = { site: site.site, web_origin: site.web_origin, relay_url: site.relay_url, trust: site.trust };
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(body, null, 2) + '\n', { flag: 'wx' });
  if (site.pem) fs.writeFileSync(path.join(dir, 'ca.pem'), site.pem, { flag: 'wx' });
  return body;
}

export function readInstalledSite(root) {
  const file = path.join(root, 'site', 'site.json');
  if (!fs.existsSync(file)) return null;
  const site = JSON.parse(fs.readFileSync(file, 'utf8'));
  const trust = site.trust ?? {};
  if (trust.mode === 'bundled-ca') {
    if (trust.ca_file !== 'site/ca.pem' || !/^[a-f0-9]{64}$/.test(trust.ca_sha256)) throw new Error('Bundled site CA record is incomplete');
    const pem = fs.readFileSync(path.join(root, 'site', 'ca.pem'), 'utf8');
    if (certificateDerSha256(pem) !== trust.ca_sha256) throw new Error('Site CA digest mismatch');
    return site;
  }
  if (trust.mode === 'system' && !trust.ca_file && !trust.ca_sha256) return site;
  throw new Error('Unsupported installed site trust');
}

export function nodeLaunch(root) {
  const site = readInstalledSite(root);
  if (!site) return { execArgv: [], extraCa: null };
  return {
    execArgv: ['--use-system-ca'],
    extraCa: site.trust.mode === 'bundled-ca' ? path.join(root, 'site', 'ca.pem') : null,
  };
}

export function applyLaunchEnv(base, launch) {
  const env = { ...base };
  if (!launch.execArgv.length && !launch.extraCa) return env;
  delete env.NODE_OPTIONS;
  delete env.NODE_EXTRA_CA_CERTS;
  if (launch.extraCa) env.NODE_EXTRA_CA_CERTS = launch.extraCa;
  return env;
}

export function relayHost(url) {
  try {
    const host = new URL(url).hostname;
    return HOST.test(host) ? host : '会合点';
  } catch { return '会合点'; }
}
