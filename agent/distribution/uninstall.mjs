// Run from an independently verified distribution, never from the installed executable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { plainDirectory, verifyBundle, removeVerifiedBundle } from './bundle.mjs';

try {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, 'remove-config': { type: 'boolean', default: false },
    'manifest-sha256': { type: 'string' }, 'installed-manifest-sha256': { type: 'string' },
  }, allowPositionals: false, strict: true });
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('Windows is required');
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  verifyBundle(source, values['manifest-sha256']);
  const target = path.join(plainDirectory(process.env.LOCALAPPDATA), 'Programs', 'sunmoon-agent');
  if (path.relative(target, source) === '' || !path.relative(target, source).startsWith('..')) throw new Error('Use the external distribution to uninstall');
  const expected = values['installed-manifest-sha256'] ?? values['manifest-sha256'];
  verifyBundle(target, expected);
  const state = process.env.SUNMOON_AGENT_HOME ?? path.join(os.homedir(), '.sunmoon-agent');
  const plan = { action: values.apply ? 'uninstall' : 'preview', target, preserveConfig: !values['remove-config'], stopsOnlyThisAgent: true };
  // Config deletion is intentionally narrower than configurable runtime homes.
  // It can only remove the standard dedicated home, never an arbitrary supplied directory.
  const configEntries = [];
  const logs = path.join(process.env.LOCALAPPDATA,'sunmoon-agent','logs');
  const ownedLogs = () => {
    if(!fs.existsSync(logs))return [];
    plainDirectory(logs);
    return ['agent.log','agent.log.1','agent.log.2','agent.log.3','agent.log.4'].map(n=>path.join(logs,n)).filter(file=>{
      if(!fs.existsSync(file))return false;
      const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw new Error('Linked log refused');return true;
    });
  };
  const inspectConfig = () => {
    if (!fs.existsSync(state)) return;
    if (path.resolve(state).toLowerCase() !== path.join(os.homedir(), '.sunmoon-agent').toLowerCase()) throw new Error('Config removal only supports the dedicated default home; custom test homes are preserved');
    plainDirectory(state);
    const allowed = new Set(['config.json','mcp.json','status.json','codex-home','logs','tray.json','tray-stop.json','stop-request.json']);
    for (const name of fs.readdirSync(state)) if (!allowed.has(name)) throw new Error('Unexpected user data in config home; refusing deletion');
    const walk = dir => { plainDirectory(dir); for (const name of fs.readdirSync(dir)) { const file=path.join(dir,name), st=fs.lstatSync(file); if(st.isSymbolicLink())throw new Error('Linked config data; refusing deletion');if(st.isDirectory())walk(file);else if(st.isFile())configEntries.push(file);else throw new Error('Unsupported config entry');} configEntries.push(dir); };
    walk(state);
  };
  if (values['remove-config']) { inspectConfig(); ownedLogs(); }
  if (!values.apply) { console.log(JSON.stringify(plan)); process.exit(0); }
  if (fs.existsSync(path.join(state, 'config.json'))) {
    const invoke = args => { const r=spawnSync(path.join(source,'node/node.exe'),[path.join(target,'app/dist/cli.js'),...args],{env:{...process.env,SUNMOON_AGENT_HOME:state},windowsHide:true,encoding:'utf8',timeout:45000}); if(r.status!==0)throw new Error(`Cannot complete ${args[0]}; installation and config kept`); };
    // Remove restart policy before stopping. A failed step keeps program files.
    invoke(['autostart','disable']); invoke(['tray','stop']); invoke(['stop']);
  }
  removeVerifiedBundle(target,expected,true);
  if(values['remove-config']) {
    configEntries.length=0; inspectConfig();
    for(const file of configEntries){const st=fs.lstatSync(file);if(st.isSymbolicLink())throw new Error('Config changed during removal');if(st.isDirectory())fs.rmdirSync(file);else fs.unlinkSync(file);}
    for(const file of ownedLogs())fs.unlinkSync(file);
    if(fs.existsSync(logs)&&fs.readdirSync(logs).length===0)fs.rmdirSync(logs);
  }
  console.log(JSON.stringify({...plan,result:'removed'}));
} catch(error){console.error(`Uninstall stopped: ${error.message}`);process.exitCode=1;}
