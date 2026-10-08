import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { windowsConfirm, powershell, nativeDirectory } from "../src/windowsDesktop.js";
const CLI = path.resolve(__dirname, "../dist/cli.js");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
describe.skipIf(process.platform !== "win32")("Windows background + tray lifecycle (no real account)", () => {
  it("one resident, closing tray keeps it alive, settings remain local, exact stop and restart", async () => {
    const base = fs.mkdtempSync(path.join(os.homedir(), "sunmoon-resident-test-"));
    const home = path.join(base, "agent"), root = path.join(base, "workspace"); fs.mkdirSync(root);
    const env = { ...process.env, SUNMOON_AGENT_HOME: home };
    const run = (...args: string[]) => { const r = spawnSync(process.execPath, [CLI, ...args], { env, windowsHide: true, encoding: "utf8", timeout: 40000 }); expect(r.status, r.stderr).toBe(0); return r.stdout.trim(); };
    let tray: ReturnType<typeof spawn> | undefined;
    try {
      run("init", "--relay", "ws://127.0.0.1:1", "--user", "isolated-resident-test", "--token", "synthetic-not-a-credential", "--root", root);
      run("start", "--background"); const first = JSON.parse(run("status"));
      expect(first.running).toBe(true); expect(first.background).toBe(true);
      run("start", "--background"); expect(JSON.parse(run("status")).pid).toBe(first.pid);
      // A stale request cannot stop this run; replacing config while running is refused.
      fs.writeFileSync(path.join(home,"stop-request.json"),JSON.stringify({pid:first.pid,runId:"00000000-0000-0000-0000-000000000000"}));
      await sleep(700);expect(JSON.parse(run("status")).running).toBe(true);fs.unlinkSync(path.join(home,"stop-request.json"));
      const reinit=spawnSync(process.execPath,[CLI,"init"],{env,windowsHide:true,encoding:"utf8",timeout:10000});expect(reinit.status).toBe(1);
      tray = spawn(process.execPath, [CLI, "tray"], { env, windowsHide: true, stdio: "ignore" });
      for (let n=0;n<100&&!fs.existsSync(path.join(home,"tray.json"));n++) await sleep(100);
      expect(fs.existsSync(path.join(home,"tray.json"))).toBe(true);
      run("tray", "stop"); await sleep(300);
      expect(JSON.parse(run("status")).pid).toBe(first.pid); expect(JSON.parse(run("status")).running).toBe(true);
      const prefs = JSON.parse(run("settings", "show")); expect(prefs.roots).toEqual([root]); expect(JSON.stringify(prefs)).not.toContain("synthetic-not-a-credential");
      const input = JSON.stringify({ ...prefs, machineName: "本机后台测试" });
      const changed = spawnSync(process.execPath, [CLI,"settings","set"], { env, windowsHide:true,encoding:"utf8",input,timeout:10000 }); expect(changed.status,changed.stderr).toBe(0);
      expect(JSON.parse(run("settings","show")).machineName).toBe("本机后台测试");
      const invalid=spawnSync(process.execPath,[CLI,"settings","set"],{env,windowsHide:true,encoding:"utf8",input:JSON.stringify({...prefs,roots:[base]}),timeout:10000});expect(invalid.status).toBe(1);
      expect(JSON.parse(run("settings","show")).roots).toEqual([root]);
      run("stop"); expect(JSON.parse(run("status")).running).toBe(false);
      run("start","--background"); const second=JSON.parse(run("status")); expect(second.running).toBe(true);expect(second.runId).not.toBe(first.runId);
      run("stop"); run("stop"); expect(JSON.parse(run("status")).running).toBe(false);
      const task=JSON.parse(run("autostart","enable")); expect(task.installed).toBe(true);expect(task.runLevel).toBe("Limited");
      expect(JSON.parse(run("autostart","status")).installed).toBe(true);
      // Manually invoke exactly this test's login task; a real reboot remains owner acceptance.
      const launch=spawnSync(powershell(),["-NoLogo","-NoProfile","-NonInteractive","-Command",`Start-ScheduledTask -TaskName '${task.name}'`],{windowsHide:true,encoding:"utf8",timeout:10000});expect(launch.status,launch.stderr).toBe(0);
      let started=false;for(let n=0;n<100;n++){if(JSON.parse(run("status")).running){started=true;break;}await sleep(200);}expect(started).toBe(true);
      expect(JSON.parse(run("autostart","disable")).installed).toBe(false);
      run("tray","stop");run("stop");
    } finally {
      if(fs.existsSync(path.join(home,"config.json"))){spawnSync(process.execPath,[CLI,"autostart","disable"],{env,windowsHide:true,stdio:"ignore",timeout:35000});spawnSync(process.execPath,[CLI,"tray","stop"],{env,windowsHide:true,stdio:"ignore",timeout:12000});spawnSync(process.execPath,[CLI,"stop"],{env,windowsHide:true,stdio:"ignore",timeout:25000});}
      if(tray&&tray.exitCode===null)tray.kill();
      fs.rmSync(base,{recursive:true,force:true});
    }
  },180000);
  it("closes an aborted local GUI prompt without granting permission",async()=>{
    const controller=new AbortController();const pending=windowsConfirm("隔离测试：此窗口会自动取消，不需要输入或批准。",controller.signal);
    setTimeout(()=>controller.abort(),2000);expect(await pending).toBe(false);
    expect(await windowsConfirm("never shown",controller.signal)).toBe(false);
  },10000);
  it("all shipped PowerShell scripts parse without altering execution policy",()=>{
    for(const name of ["desktop.ps1","elevated-setup.ps1"]){
      const file=path.join(nativeDirectory,name).replace(/'/g,"''");
      const r=spawnSync(powershell(),["-NoLogo","-NoProfile","-NonInteractive","-Command",`$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}`],{windowsHide:true,encoding:"utf8",timeout:10000});expect(r.status,r.stderr).toBe(0);
    }
  });
});
