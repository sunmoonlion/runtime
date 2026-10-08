// Stage 1b follow-up: native 0.155.1 contracts and malicious temp/config paths.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { locateCodex } from "../src/paths.js";
import { freeLoopbackPort, waitForPort } from "../src/execServer.js";
import { WindowsBridge } from "../src/windowsBridge.js";
import { parse } from "smol-toml";
import { ownedConfig } from "../src/mcp.js";
import { WindowsTemporary, LocalRpc, locateWindowsHelper, windowsEnvironment, windowsProfile, killWindowsTree } from "../src/windowsRuntime.js";
const uri = (p: string) => pathToFileURL(p).href;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
describe.skipIf(process.platform !== "win32")("native Windows stage 1b follow-up", () => {
  let base: string, root: string, home: string, url: string, temporary: WindowsTemporary, env: Record<string, string>, child: ChildProcess, rpc: LocalRpc, bridge: WindowsBridge;
  const helper = locateWindowsHelper(), ceiling = { sandbox: "workspace-write", network: false } as const;
  const config = 'sandbox_mode = "read-only"\napproval_policy = "never"\n[windows]\nsandbox = "unelevated"\n';
  const events: any[] = []; let seq = 0;
  const send = (method: string, params: any) => bridge.receive(JSON.stringify({ id: ++seq, method, params }), false);
  const request = (processId: string) => {
    const sandbox = windowsProfile(root, [root], "unelevated");
    for (const kind of ["tmpdir", "slash_tmp"]) sandbox.permissions.file_system.entries.push({ path: { type: "special", value: { kind } }, access: "write" });
    return { processId, argv: [process.execPath, "-e", "process.stdout.write('ok')"], env: {}, cwd: uri(root), tty: false, sandbox };
  };
  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.homedir(), "sunmoon-native-followup-"));
    root = path.join(base, "workspace"); home = path.join(base, "home");
    for (const d of [root, home]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(home, "config.toml"), config);
    temporary = await WindowsTemporary.create(home, [root], helper);
    env = windowsEnvironment(home, {}, process.env, temporary.directory);
    const port = await freeLoopbackPort(); url = `ws://127.0.0.1:${port}`;
    child = spawn(locateCodex().codexBin, ["exec-server", "--listen", url], { cwd: home, env, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    expect(await waitForPort(port, 10000, () => child.exitCode === null)).toBe(true);
    rpc = await LocalRpc.connect(url);
    bridge = new WindowsBridge({ roots: [root], home, helper, mode: "unelevated", ceiling, url: () => url, temporary, executorEnvironment: () => env });
    rpc.listeners.add(f => { events.push(f); bridge.observe(JSON.stringify(f)); });
  }, 30000);
  afterAll(async () => { await bridge?.close(); rpc?.close(); if (child) await killWindowsTree(child); if (temporary) { await temporary.close(); expect(fs.existsSync(temporary.directory)).toBe(false); } if (base) fs.rmSync(base, { recursive: true, force: true }); }, 30000);
  it("matches native missing file and missing parent replies without denied counts", async () => {
    for (const method of ["fs/getMetadata", "fs/readFile"]) for (const name of ["missing", "absent/child", "absent/deep/child"]) {
      const params = { path: uri(path.join(root, name)), sandbox: null };
      const native = await rpc.call(method, params), answer = await send(method, params);
      expect(native.error.code).toBe(-32004); expect(JSON.parse(answer.response!).error).toEqual(native.error); expect(answer.reason).toBeUndefined();
    }
    expect((await send("fs/getMetadata", { path: uri(path.join(base, "outside-missing")) })).reason).toContain("outside");
  }, 30000);
  it("does not disguise absent targets behind a junction as benign not-found", async () => {
    const junction = path.join(root, "missing-alias"); fs.symlinkSync(path.join(base, "absent-outside"), junction, "junction");
    try { for (const method of ["fs/getMetadata", "fs/readFile"]) {
      const answer = await send(method, { path: uri(path.join(junction, "absent.txt")) }); expect(answer.reason).toBeTruthy(); expect(JSON.parse(answer.response!).error.code).toBe(-32001);
    } } finally { fs.unlinkSync(junction); }
  });
  it("reads only the generated home config, matches native projection and rejects swapped config", async () => {
    fs.mkdirSync(path.join(root, ".codex")); fs.writeFileSync(path.join(root, ".codex", "config.toml"), '[mcp_servers.project_canary]\nurl="https://project-canary.invalid/mcp"\n');
    const params = { cwd: uri(root), configPaths: [["mcp_servers"]], requirementsPaths: [["mcp_servers"]] };
    const native = await rpc.call("environmentConfig/read", params), answer = await send("environmentConfig/read", params);
    expect(answer.reason).toBeUndefined(); expect(JSON.parse(answer.response!).result).toEqual(native.result); expect(answer.response).not.toContain("project_canary");
    const other = path.join(base, "other-config.toml"), target = path.join(home, "config.toml");
    fs.writeFileSync(other, '[mcp_servers.other_canary]\nurl="https://other-canary.invalid/mcp"\n');
    try {
      fs.unlinkSync(target); fs.linkSync(other, target);
      const denied = await send("environmentConfig/read", params); expect(denied.reason).toBeTruthy(); expect(denied.response).not.toContain("other_canary");
    } finally { fs.unlinkSync(target); fs.writeFileSync(target, config); }
  });
  it("projects confirmed HTTP MCP with the native 0.155.1 contract and no project settings", async () => {
    const servers = { stage2: { url: "https://stage2.invalid/mcp", enabled_tools: ["read"], tool_timeout_sec: 30 } };
    const target = path.join(home, "config.toml");
    fs.writeFileSync(target, ownedConfig("unelevated", servers));
    const fresh = new WindowsBridge({ roots: [root], home, helper, mode: "unelevated", ceiling, url: () => url });
    try {
      const params = { cwd: uri(root), configPaths: [["mcp_servers"]], requirementsPaths: [["mcp_servers"]] };
      const native = await rpc.call("environmentConfig/read", params);
      const answer = await fresh.receive(JSON.stringify({ id: 1, method: "environmentConfig/read", params }), false);
      expect(answer.reason).toBeUndefined();
      const actual = JSON.parse(answer.response!).result;
      expect(actual.config.layers).toHaveLength(1);
      expect(parse(actual.config.layers[0].toml)).toEqual(parse(native.result.config.layers[0].toml));
      expect(parse(actual.config.layers[0].toml)).toEqual({ mcp_servers: servers });
      expect(actual.config.layers[0].source).toBe(native.result.config.layers[0].source);
      expect(actual.config.layers[0].baseDir).toBe(native.result.config.layers[0].baseDir);
      expect(actual.requirements).toEqual(native.result.requirements);
      expect(answer.response).not.toContain("project_canary");
    } finally { await fresh.close(); fs.writeFileSync(target, config); }
  });
  it("requires local approval and durable audit before a real Windows write; outside remains denied", async () => {
    let approvals = 0, reports = 0, epoch = 0;
    const fresh = new WindowsBridge({ roots: [root], home, helper, mode: "unelevated", ceiling: { sandbox: "read-only", network: false }, url: () => url, temporary, executorEnvironment: () => env,
      localPermissions: { available: () => true, epoch: () => epoch,
        confirm: async () => { approvals++; return true; },
        report: async report => { reports++; expect(report.decision).toBe("approved"); return reports > 1; },
      },
    });
    const observe = (f: any) => fresh.observe(JSON.stringify(f)); rpc.listeners.add(observe);
    const file = path.join(root, "approved-stage2.txt"), outside = path.join(base, "denied-stage2.txt");
    const params = { ...request("stage2-approved"), metadata: { threadId: "12345678-1234-1234-1234-123456789abc", toolCallId: "call-stage2" } };
    params.argv = [process.execPath, "-e", `const fs=require('fs');fs.writeFileSync(${JSON.stringify(file)},'approved');try{fs.writeFileSync(${JSON.stringify(outside)},'escape')}catch{}`];
    try {
      const denied = await fresh.receive(JSON.stringify({ id: 1, method: "process/start", params }), false);
      expect(denied.reason).toBeTruthy(); expect(fs.existsSync(file)).toBe(false);
      const allowed = await fresh.receive(JSON.stringify({ id: 2, method: "process/start", params }), false);
      expect(allowed.reason).toBeUndefined(); expect(approvals).toBe(2); expect(reports).toBe(2);
      const frame = JSON.parse(allowed.forward!);
      expect((await rpc.call(frame.method, frame.params)).error).toBeUndefined();
      for (let i = 0; i < 100 && !events.some(f => f.method === "process/exited" && f.params.processId === params.processId); i++) await sleep(50);
      expect(fs.readFileSync(file, "utf8")).toBe("approved"); expect(fs.existsSync(outside)).toBe(false);
      epoch++;
      params.processId = "stage2-new-epoch";
      const next = await fresh.receive(JSON.stringify({ id: 3, method: "process/start", params }), false);
      expect(next.reason).toBeUndefined(); expect(approvals).toBe(3); expect(reports).toBe(3);
      // Deliberately not forwarded: only re-confirmation admission is checked.
    } finally { rpc.listeners.delete(observe); await fresh.close(); }
  }, 30000);
  it("runs real project + owned-temp writes, denies global Temp and outside writes, accepts late terminate", async () => {
    const params = request("owned-temp");
    params.sandbox.permissions.file_system.entries.push({ path: { type: "path", path: "file:///data/.codex" }, access: "read", missing_path_behavior: "skip" });
    const targets = [path.join(root, "positive.txt"), path.join(temporary.directory, "positive.txt"), path.join(base, "outside.txt"), path.join(os.tmpdir(), `sunmoon-followup-${path.basename(base)}.txt`)];
    params.argv = [process.execPath, "-e", `const fs=require('fs');for(const p of ${JSON.stringify(targets)}){try{fs.writeFileSync(p,'ok');console.log('ok')}catch(e){console.log(e.code)}}`];
    const accepted = await send("process/start", params); expect(accepted.reason).toBeUndefined(); expect(accepted.forward).toBeTruthy();
    const forwarded = JSON.parse(accepted.forward!); for (const key of ["TEMP", "TMP", "TMPDIR"]) expect(forwarded.params.env[key]).toBe(temporary.directory);
    expect(forwarded.params.sandbox.permissions.file_system.entries).not.toContainEqual(params.sandbox.permissions.file_system.entries.at(-1));
    const response = await rpc.call(forwarded.method, forwarded.params); bridge.observe(JSON.stringify({ ...response, id: forwarded.id })); expect(response.result.sandboxType).toBe("windowsRestrictedToken");
    for (let i = 0; i < 200 && !events.some(f => f.method === "process/closed" && f.params.processId === params.processId); i++) await sleep(50);
    expect(events.find(f => f.method === "process/exited" && f.params.processId === params.processId)?.params.exitCode).toBe(0);
    const stdout = events.filter(f => f.method === "process/output" && f.params.processId === params.processId && f.params.stream === "stdout").map(f => Buffer.from(f.params.chunk, "base64").toString()).join("");
    expect(stdout.match(/EPERM|EACCES/g)).toHaveLength(2); expect(targets.map(p => fs.existsSync(p))).toEqual([true, true, false, false]);
    const late = await send("process/terminate", { processId: params.processId }); expect(late.reason).toBeUndefined(); expect(JSON.parse(late.response!).result).toEqual((await rpc.call("process/terminate", { processId: params.processId })).result);
    const unknown = await send("process/terminate", { processId: "never-started" }); expect(unknown.reason).toContain("unknown");
    if (fs.existsSync(targets[3])) fs.unlinkSync(targets[3]);
  }, 30000);
  it("rejects remote TEMP/TMP overrides and a corrupted executor environment", async () => {
    for (const key of ["TEMP", "Tmp", "tmpdir"]) { const p = request(`override-${key}`); p.env = { [key]: base }; expect((await send("process/start", p)).reason).toContain("reserved"); }
    const saved = env.TEMP; env.TEMP = base;
    try { expect((await send("process/start", request("changed-executor"))).forward).toBeUndefined(); }
    finally { env.TEMP = saved; }
  });
  it("reports a missing project cwd explicitly and rejects mixed POSIX/Windows permissions", async () => {
    const p = request("missing-project"); p.cwd = uri(path.join(root, "missing-project")); p.sandbox.cwd = p.cwd;
    expect((await send("process/start", p)).reason).toContain("working directory does not exist");
    const malformed = request("linux-prefix"); malformed.sandbox.permissions.file_system.entries.push({ path: { type: "path", path: `file:///data/${root.replaceAll('\\', '%5C')}/.codex` }, access: "read", missing_path_behavior: "skip" });
    expect((await send("process/start", malformed)).reason).toContain("unsupported filesystem permission path");
  });
  it("pins temp against swaps and refuses a replaced directory after guard failure", async () => {
    expect(() => fs.renameSync(temporary.directory, `${temporary.directory}-moved`)).toThrow();
    const victim = await WindowsTemporary.create(home, [root], helper), moved = `${victim.directory}-moved`;
    const localEnv = windowsEnvironment(home, {}, process.env, victim.directory);
    const attacked = new WindowsBridge({ roots: [root], home, helper, mode: "unelevated", ceiling, url: () => url, temporary: victim, executorEnvironment: () => localEnv });
    // Fault injection: simulate loss of the local guard, then replace with an
    // outside junction. A dead pin cannot leave a grant usable.
    await (victim as any).guard.close(); fs.renameSync(victim.directory, moved); fs.symlinkSync(base, victim.directory, "junction");
    try { const answer = await attacked.receive(JSON.stringify({ id: 99, method: "process/start", params: request("swapped-temp") }), false); expect(answer.reason).toBeTruthy(); expect(answer.forward).toBeUndefined(); }
    finally { await attacked.close(); fs.unlinkSync(victim.directory); fs.rmSync(moved, { recursive: true, force: true }); }
  });
});
