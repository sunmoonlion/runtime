// Windows Node helper, launched inside Codex's sandbox. No compilation or FFI.
// OS sandbox enforces writes; directory pins and file identity enforce reads.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (process.platform !== 'win32') throw new Error('Windows only');
const normal = p => {
  if (typeof p !== 'string' || !/^[a-z]:[\\/]/i.test(p) || /[\x00-\x1f]/.test(p)) throw new Error('local path required');
  for (const bit of p.replaceAll('/', '\\').slice(3).split('\\')) {
    if (bit === '.' || bit === '..') continue;
    if (/[. ]$|[<>:"|?*]|~[0-9]/.test(bit) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(bit)) throw new Error('path alias refused');
  }
  return path.normalize(p).toLowerCase();
};
const under = (p, r) => { const rel = path.relative(normal(r), normal(p)); return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !path.isAbsolute(rel)); };
// Windows holds its current directory AND ancestors against rename. Check after
// chdir, while that handle is held, not before a raceable realpath/open pair.
function inspectDirectory(p) {
  for (;;) {
    const s = fs.lstatSync(p);
    if (!s.isDirectory() || s.isSymbolicLink() || normal(fs.realpathSync(p)) !== normal(p)) throw new Error('directory alias refused');
    const parent = path.dirname(p); if (parent === p) break; p = parent;
  }
}
if (process.argv[2] === '--pin-directory') {
  inspectDirectory(process.cwd()); process.stdout.write('{"ready":true}\n');
  process.stdin.resume(); process.stdin.on('end', () => process.exit(0));
} else {
  const cfg = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
  const handles = new Map();
  const policy = (p, write = false) => {
    normal(p);
    if (!(write ? cfg.roots : cfg.reads).some(r => under(p, r)) || cfg.deniedReads.some(r => under(p, r))) throw new Error('outside roots');
    return p;
  };
  const local = (uri, write = false) => {
    const u = new URL(uri); if (u.protocol !== 'file:' || u.host || u.search || u.hash) throw new Error('local URI required');
    return policy(fileURLToPath(u), write);
  };
  function inDirectory(dir, fn) {
    const old = process.cwd();
    try { process.chdir(dir); inspectDirectory(dir); const a = fs.statSync('.', { bigint: true }), b = fs.statSync(dir, { bigint: true }); if (a.dev !== b.dev || a.ino !== b.ino) throw new Error('directory identity refused'); return fn(); }
    finally { process.chdir(old); }
  }
  function info(p) {
    const s = fs.lstatSync(p);
    if (s.isSymbolicLink() || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))) throw new Error('link or special file refused');
    return s;
  }
  function openRead(p) {
    policy(p);
    return inDirectory(path.dirname(p), () => {
      const fd = fs.openSync(p, 'r');
      try {
        const opened = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(p, { bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n || !named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || opened.dev !== named.dev || opened.ino !== named.ino || normal(fs.realpathSync(p)) !== normal(p)) throw new Error('file identity refused');
        return fd; // No bytes read until the opened file identity is checked.
      } catch (e) { fs.closeSync(fd); throw e; }
    });
  }
  function read(p) {
    const fd = openRead(p);
    try { const size = fs.fstatSync(fd).size; if (size > 8 * 1024 * 1024) throw new Error('use readBlock'); const b = Buffer.alloc(size); return b.subarray(0, fs.readSync(fd, b, 0, size, 0)); }
    finally { fs.closeSync(fd); }
  }
  function write(p, data) {
    policy(p, true);
    return inDirectory(path.dirname(p), () => {
      try { if (!info(p).isFile()) throw new Error('not file'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      fs.writeFileSync(p, data); // Ordinary write. OS sandbox is the authority.
    });
  }
  function mkdir(p, recursive) {
    policy(p, true); const parent = path.dirname(p);
    if (recursive && !fs.existsSync(parent)) mkdir(parent, true);
    return inDirectory(parent, () => { fs.mkdirSync(p, { recursive }); inDirectory(p, () => {}); });
  }
  function remove(p, recursive, force) {
    policy(p, true);
    return inDirectory(path.dirname(p), () => {
      try { info(p); } catch (e) { if (force && e.code === 'ENOENT') return; throw e; }
      fs.rmSync(p, { recursive, force });
    });
  }
  function copy(a, b, recursive) {
    policy(a); policy(b, true);
    return inDirectory(path.dirname(a), () => {
      if (info(a).isDirectory()) {
        if (!recursive || under(b, a)) throw new Error('unsafe recursive copy');
        return inDirectory(a, () => { mkdir(b, true); for (const name of fs.readdirSync(a)) copy(path.join(a, name), path.join(b, name), true); });
      }
      write(b, read(a));
    });
  }
  function metadata(p) {
    policy(p);
    return inDirectory(path.dirname(p), () => { const s = info(p); return { isDirectory: s.isDirectory(), isFile: s.isFile(), isSymlink: false, size: s.size, createdAtMs: Math.trunc(s.birthtimeMs), modifiedAtMs: Math.trunc(s.mtimeMs) }; });
  }
  function walk(p, o) {
    if (!o || ['maxDepth', 'maxDirectories', 'maxEntries'].some(k => !Number.isSafeInteger(o[k]) || o[k] < 0) || o.maxDepth > 128 || o.maxDirectories > 10000 || o.maxEntries > 10000 || o.followDirectorySymlinks) throw new Error('walk bounds refused');
    const result = { entries: [], errors: [], truncated: false }; let visited = 0;
    const queue = [{ dir: p, depth: 0 }];
    while (queue.length) {
      const { dir, depth } = queue.shift();
      policy(dir); if (visited++ >= o.maxDirectories) { result.truncated = true; break; }
      inDirectory(dir, () => { for (const name of fs.readdirSync(dir)) {
        if (result.entries.length >= o.maxEntries) { result.truncated = true; return; }
        const target = path.join(dir, name);
        try { const m = metadata(target); result.entries.push({ path: pathToFileURL(target).href, kind: m.isDirectory ? 'directory' : 'file' }); if (m.isDirectory && depth < o.maxDepth && !(o.pruneHiddenDirectories && name.startsWith('.'))) queue.push({ dir: target, depth: depth + 1 }); }
        catch { result.errors.push({ path: pathToFileURL(target).href, message: 'entry refused or unavailable' }); }
      } });
    }
    return result;
  }
  function dispatch(method, p) {
    const target = p.path ? local(p.path, ['fs/writeFile', 'fs/createDirectory', 'fs/remove'].includes(method)) : null;
    switch (method) {
      case 'fs/readFile': return { dataBase64: read(target).toString('base64') };
      case 'fs/writeFile': {
        if (typeof p.dataBase64 !== 'string') throw new Error('invalid base64');
        const data = Buffer.from(p.dataBase64, 'base64');
        if (data.toString('base64') !== p.dataBase64) throw new Error('invalid base64');
        write(target, data); return {};
      }
      case 'fs/createDirectory': mkdir(target, p.recursive === true); return {};
      case 'fs/remove': remove(target, p.recursive === true, p.force === true); return {};
      case 'fs/copy': copy(local(p.sourcePath), local(p.destinationPath, true), p.recursive === true); return {};
      case 'fs/getMetadata': return metadata(target);
      case 'fs/canonicalize': metadata(target); return { path: pathToFileURL(target).href };
      case 'fs/readDirectory': return inDirectory(target, () => ({ entries: fs.readdirSync(target).map(name => { const m = metadata(path.join(target, name)); return { fileName: name, isDirectory: m.isDirectory, isFile: m.isFile }; }) }));
      case 'fs/walk': return walk(target, p.options);
      case 'fs/open': {
        if (typeof p.handleId !== 'string' || !p.handleId || handles.has(p.handleId) || handles.size >= 64) throw new Error('invalid handle');
        handles.set(p.handleId, openRead(target)); return { handleId: p.handleId };
      }
      case 'fs/readBlock': {
        if (!Number.isSafeInteger(p.len) || p.len < 1 || p.len > 1024 * 1024) throw Object.assign(new Error('invalid block length'), { rpcCode: -32600, rpcMessage: 'file read block length must be between 1 and 1048576' });
        const fd = handles.get(p.handleId);
        if (fd === undefined || !Number.isSafeInteger(p.offset) || p.offset < 0) throw new Error('invalid block');
        const stat = fs.fstatSync(fd); if (stat.nlink !== 1) throw new Error('file links changed');
        const b = Buffer.alloc(p.len), n = fs.readSync(fd, b, 0, b.length, p.offset);
        return { chunk: b.subarray(0, n).toString('base64'), eof: n < p.len };
      }
      case 'fs/close': { const fd = handles.get(p.handleId); if (fd === undefined) throw new Error('unknown handle'); fs.closeSync(fd); handles.delete(p.handleId); return {}; }
      default: throw new Error('unknown method');
    }
  }
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => {
    let id = null;
    try { if (line.length > 12 * 1024 * 1024) throw new Error('frame too large'); const f = JSON.parse(line); id = f.id; process.stdout.write(JSON.stringify({ id, result: dispatch(f.method, f.params) }) + '\n'); }
    catch (e) { process.stdout.write(JSON.stringify({ id, error: e.rpcCode ? { code: e.rpcCode, message: e.rpcMessage } : { code: -32001, message: 'sunmoon-agent local ceiling: filesystem operation refused or unavailable', data: { reason: e.code ?? (e.message.includes('refused') ? e.message : 'invalid operation'), syscall: e.syscall } } }) + '\n'); }
  });
  lines.on('close', () => { for (const fd of handles.values()) fs.closeSync(fd); });
}
