// Real Windows 0.155.1, no model/token/UAC. Positive controls must pass before
// an absent outside file can count as a denied attack. Not a mock OS sandbox.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { locateCodex } from "../src/paths.js";
import { freeLoopbackPort, waitForPort } from "../src/execServer.js";
import { WindowsBridge } from "../src/windowsBridge.js";
import { type WindowsHelper, locateWindowsHelper, killWindowsTree, pinWindowsDirectories, runSandboxProbe, windowsEnvironment, windowsHelperArgs } from "../src/windowsRuntime.js";
import { windowsDecision } from "../src/windowsPolicy.js";

const uri = (p: string) => pathToFileURL(p).href;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
describe.skipIf(process.platform !== "win32")("native Windows adversarial admission", () => {
  let base: string, root: string, home: string, outside: string, helper: WindowsHelper, url: string, child: ChildProcess;
  let bridge: WindowsBridge; let seq = 0;
  const ceiling = { sandbox: "workspace-write", network: false } as const;
  async function call(method: string, params: any) {
    const result = await bridge.receive(JSON.stringify({ id: ++seq, method, params }), false);
    expect(result.forward).toBeUndefined(); expect(result.response).toBeTruthy();
    return JSON.parse(result.response!);
  }
  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.homedir(), "sunmoon-native-security-"));
    [root, home, outside] = ["allowed", "agent-home", "outside"].map(n => path.join(base, n));
    for (const d of [root, home, outside]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(home, "config.toml"), 'sandbox_mode="read-only"\napproval_policy="never"\n[windows]\nsandbox="unelevated"\n');
    helper = locateWindowsHelper(); const port = await freeLoopbackPort(); url = `ws://127.0.0.1:${port}`;
    child = spawn(locateCodex().codexBin, ["exec-server", "--listen", url], { cwd: home, env: windowsEnvironment(home), stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    expect(await waitForPort(port, 10000, () => child.exitCode === null)).toBe(true);
    bridge = new WindowsBridge({ roots: [root], home, mode: "unelevated", helper, ceiling, url: () => url });
  }, 45000);
  afterAll(async () => { await bridge?.close(); if (child) await killWindowsTree(child); if (base) fs.rmSync(base, { recursive: true, force: true }); }, 30000);
  it("detects a genuinely usable unelevated inner sandbox in a fresh home", async () => {
    expect(await runSandboxProbe(url, home, root, "unelevated")).toBe(true);
    expect(fs.existsSync(path.join(home, "auth.json"))).toBe(false);
  }, 30000);
  it.each(["unelevated", "elevated"] as const)("%s OS sandbox blocks ordinary Node writes after a directory swap", async mode => {
    const chosenHome = mode === "elevated" ? process.env.SUNMOON_TEST_ELEVATED_HOME! : home;
    expect(chosenHome).toBeTruthy();
    const dir = path.join(root, `os-race-${mode}`); fs.mkdirSync(dir);
    const target = path.join(dir, "escape.txt"), outsideTarget = path.join(outside, "escape.txt");
    const control = path.join(root, `os-control-${mode}.txt`);
    // Start sandbox first; swap only after it reports ready. This deliberately
    // omits the helper's path checks so the OS itself must stop the attack.
    const program = `const fs=require('fs');console.log('ready');process.stdin.once('data',()=>{fs.writeFileSync(${JSON.stringify(control)},'inside');for(const p of ${JSON.stringify([target, outsideTarget])}){try{fs.writeFileSync(p,'escaped');console.log('ALLOWED')}catch(e){console.log(e.code)}}process.exit(0)});`;
    const args = windowsHelperArgs(chosenHome, [root], mode, true, helper);
    args.splice(args.indexOf("--") + 1, 3, process.execPath, "-e", program);
    const worker = spawn(locateCodex().codexBin, args, { cwd: root, env: windowsEnvironment(chosenHome), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; worker.stdout!.on("data", d => output += String(d)); worker.stderr!.resume();
    try {
      for (let i = 0; i < 160 && !output.includes("ready"); i++) await sleep(50);
      expect(output).toContain("ready");
      fs.rmdirSync(dir); fs.symlinkSync(outside, dir, "junction"); worker.stdin!.end("go\n");
      for (let i = 0; i < 160 && worker.exitCode === null; i++) await sleep(50);
      expect(worker.exitCode).toBe(0); expect(output).not.toContain("ALLOWED"); expect(output.match(/EPERM|EACCES/g)).toHaveLength(2);
      expect(fs.readFileSync(control, "utf8")).toBe("inside"); expect(fs.existsSync(outsideTarget)).toBe(false);
    } finally { await killWindowsTree(worker); fs.unlinkSync(dir); }
  }, 30000);
  it("probes an existing elevated setup and runs the protected file helper under it", async () => {
    const existing = process.env.SUNMOON_TEST_ELEVATED_HOME;
    expect(existing, "Set SUNMOON_TEST_ELEVATED_HOME to an existing credential-free setup home").toBeTruthy();
    expect(fs.existsSync(path.join(existing!, "auth.json"))).toBe(false);
    const port = await freeLoopbackPort(); const elevatedUrl = `ws://127.0.0.1:${port}`;
    const executor = spawn(locateCodex().codexBin, ["exec-server", "--listen", elevatedUrl], { cwd: root, env: windowsEnvironment(existing!), windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    let files: WindowsBridge | undefined;
    try {
      expect(await waitForPort(port, 10000, () => executor.exitCode === null)).toBe(true);
      expect(await runSandboxProbe(elevatedUrl, existing!, root, "elevated")).toBe(true);
      files = new WindowsBridge({ roots: [root], home: existing!, mode: "elevated", helper, ceiling, url: () => elevatedUrl });
      const target = path.join(root, "elevated.txt");
      const result = await files.receive(JSON.stringify({ id: 1, method: "fs/writeFile", params: { path: uri(target), dataBase64: "ZWxldmF0ZWQ=" } }), false);
      expect(JSON.parse(result.response!).result, result.response).toEqual({}); expect(fs.readFileSync(target, "utf8")).toBe("elevated");
      const denied = await files.receive(JSON.stringify({ id: 2, method: "fs/readFile", params: { path: uri(path.join(existing!, ".sandbox-secrets", "never-read")) } }), false);
      expect(JSON.parse(denied.response!).error.code).toBe(-32001);
    } finally { await files?.close(); await killWindowsTree(executor); }
  }, 45000);
  it("runs write/read/open/block/close/copy/mkdir/remove through a sandboxed worker", async () => {
    const p = path.join(root, "positive.txt");
    expect((await call("fs/writeFile", { path: uri(p), dataBase64: "cG9zaXRpdmU=", sandbox: null })).result).toEqual({});
    expect(fs.readFileSync(p, "utf8")).toBe("positive");
    expect((await call("fs/readFile", { path: uri(p) })).result.dataBase64).toBe("cG9zaXRpdmU=");
    expect((await call("fs/getMetadata", { path: uri(p) })).result.isFile).toBe(true);
    expect((await call("fs/canonicalize", { path: uri(p) })).result.path).toBe(uri(p));
    expect((await call("fs/readDirectory", { path: uri(root) })).result.entries.some((e: any) => e.fileName === "positive.txt")).toBe(true);
    expect((await call("fs/walk", { path: uri(root), options: { maxDepth: 2, maxDirectories: 100, maxEntries: 100, followDirectorySymlinks: false, pruneHiddenDirectories: false } })).result.entries.some((e: any) => e.path === uri(p))).toBe(true);
    expect((await call("fs/open", { path: uri(p), handleId: "h1" })).result.handleId).toBe("h1");
    expect((await call("fs/readBlock", { handleId: "h1", offset: 0, len: 100 })).result).toEqual({ chunk: "cG9zaXRpdmU=", eof: true });
    expect((await call("fs/close", { handleId: "h1" })).result).toEqual({});
    expect((await call("fs/readBlock", { handleId: "h1", offset: 0, len: 1 })).error.code).toBe(-32001);
    const d = path.join(root, "new-dir"); expect((await call("fs/createDirectory", { path: uri(d), recursive: false })).result).toEqual({});
    expect((await call("fs/copy", { sourcePath: uri(p), destinationPath: uri(path.join(d, "copy.txt")), recursive: false })).result).toEqual({});
    expect(fs.readFileSync(path.join(d, "copy.txt"), "utf8")).toBe("positive");
    expect((await call("fs/remove", { path: uri(d), recursive: true, force: false })).result).toEqual({});
  }, 45000);
  it("rejects unknown methods, binary frames, responses and unlisted notifications", async () => {
    for (const raw of ['{"id":1,"method":"fs/rename","params":{}}', '{"id":1,"result":{}}', '{"method":"fs/writeFile","params":{}}', 'not-json']) expect((await bridge.receive(raw, false)).reason).toBeTruthy();
    expect((await bridge.receive('{"id":1,"method":"initialize","params":{"clientName":"x"}}', true)).reason).toBeTruthy();
  });
  it("refuses reads outside roots and copy-source exfiltration", async () => {
    const p = path.join(outside, "secret.txt"); fs.writeFileSync(p, "outside-control");
    for (const method of ["fs/readFile", "fs/open", "fs/readDirectory", "fs/walk"]) expect((await call(method, { path: uri(p) })).error.code).toBe(-32001);
    expect((await call("fs/copy", { sourcePath: uri(p), destinationPath: uri(path.join(root, "stolen")), recursive: false })).error.code).toBe(-32001);
  });
  it("blocks junction and symlink reads/writes", async () => {
    for (const type of ["junction"] as const) {
      const link = path.join(root, `link-${type}`); fs.symlinkSync(outside, link, type);
      const p = path.join(link, "secret.txt");
      expect((await call("fs/readFile", { path: uri(p) })).error.code).toBe(-32001);
      expect((await call("fs/writeFile", { path: uri(p), dataBase64: "eA==" })).error.code).toBe(-32001);
      expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("outside-control");
      fs.unlinkSync(link);
    }
  }, 30000);
  it("rejects precreated native symbolic links as an ordinary user", async () => {
    const fixture = process.env.SUNMOON_TEST_SYMLINK_FIXTURE;
    expect(fixture, "Set SUNMOON_TEST_SYMLINK_FIXTURE to the separately created Windows fixture").toBeTruthy();
    const allowed = path.join(fixture!, "allowed");
    const files = new WindowsBridge({ roots: [allowed], home, mode: "unelevated", helper, ceiling, url: () => url });
    try {
      for (const target of [path.join(allowed, "directory-link", "secret.txt"), path.join(allowed, "file-link.txt")]) {
        expect(fs.readFileSync(target, "utf8")).toBe("outside-control"); // unsandboxed control follows the real link
        for (const method of ["fs/readFile", "fs/writeFile"]) {
          const result = await files.receive(JSON.stringify({ id: ++seq, method, params: { path: uri(target), ...(method === "fs/writeFile" ? { dataBase64: "eA==" } : {}) } }), false);
          expect(JSON.parse(result.response!).error.code).toBe(-32001);
        }
      }
      expect(fs.readFileSync(path.join(fixture!, "outside", "secret.txt"), "utf8")).toBe("outside-control");
    } finally { await files.close(); }
  }, 30000);
  it("refuses hardlink reads and writes, preserving outside content", async () => {
    const p = path.join(root, "hard.txt"); fs.linkSync(path.join(outside, "secret.txt"), p);
    expect((await call("fs/readFile", { path: uri(p) })).error.code).toBe(-32001);
    expect((await call("fs/writeFile", { path: uri(p), dataBase64: "eA==" })).error.code).toBe(-32001);
    expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("outside-control"); fs.unlinkSync(p);
  });
  it("handles case correctly and refuses 8.3/device-prefix aliases", async () => {
    expect((await call("fs/readFile", { path: uri(path.join(root, "positive.txt").toUpperCase()) })).result.dataBase64).toBe("cG9zaXRpdmU=");
    for (const p of ["file:///C:/PROGRA~1", "file:///%5C%5C%3F%5CC%3A%5CWindows", uri(path.join(outside.toUpperCase(), "secret.txt"))]) expect((await call("fs/readFile", { path: p })).error.code).toBe(-32001);
  });
  it("blocks a checked directory replaced by a junction before the operation", async () => {
    const dir = path.join(root, "race"); fs.mkdirSync(dir);
    const frame = { id: 99, method: "fs/writeFile", params: { path: uri(path.join(dir, "escape")), dataBase64: "eA==" } };
    expect(windowsDecision(frame, ceiling, [root], home).allow).toBe(true);
    fs.rmdirSync(dir); fs.symlinkSync(outside, dir, "junction");
    expect(JSON.parse((await bridge.receive(JSON.stringify(frame), false)).response!).error.code).toBe(-32001);
    expect(fs.existsSync(path.join(outside, "escape"))).toBe(false); fs.unlinkSync(dir);
  });
  it("rejects a checked read path swapped for an outside junction", async () => {
    const dir = path.join(root, "read-race"); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "secret.txt"), "inside");
    const frame = { id: 199, method: "fs/readFile", params: { path: uri(path.join(dir, "secret.txt")) } };
    expect(windowsDecision(frame, ceiling, [root], home).allow).toBe(true);
    fs.rmSync(dir, { recursive: true }); fs.symlinkSync(outside, dir, "junction");
    const result = (await bridge.receive(JSON.stringify(frame), false)).response!;
    expect(JSON.parse(result).error.code).toBe(-32001); expect(result).not.toContain(Buffer.from("outside-control").toString("base64")); fs.unlinkSync(dir);
  });
  it("pins sandbox roots against replacement throughout command launch", async () => {
    const dir = path.join(root, "pinned"); fs.mkdirSync(dir);
    const release = await pinWindowsDirectories(helper, [dir], home);
    try { expect(() => fs.renameSync(dir, `${dir}-moved`)).toThrow(); fs.writeFileSync(path.join(dir, "control"), "allowed"); }
    finally { release(); await sleep(300); }
    fs.renameSync(dir, `${dir}-moved`);
  });
});
