import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decide } from "../src/filter.js";
import { canonicalPath, isUnder, uriToPath } from "../src/pathuri.js";

// Unmodified requests captured from the native pinned executor. Mutations below
// are explicitly adversarial/normalization variants, not claimed wire captures.
const captures = fs.readFileSync(path.resolve(__dirname, "../../probe/frames.jsonl"), "utf8")
  .trim().split("\n").map(line => JSON.parse(line));
const boundarySources = new Set([
  "scripts/results/windows-unelevated-20261007/outer-final.frames.jsonl",
  "scripts/results/windows-agent-1-20261007/inner-cmdlet.txt",
]);
const requests = captures.filter(row => row.direction === "request" && boundarySources.has(row.source)).map(row => row.frame);
const start = requests.find(f => f.method === "process/start");
const writes = requests.filter(f => f.method === "fs/writeFile");
const root = uriToPath(start.params.cwd, "win32")!;
const fileRoot = path.win32.dirname(uriToPath(writes[0].params.path, "win32")!);
const ceiling = { sandbox: "workspace-write" as const, network: false };
const decision = (frame: unknown, roots = [root]) => decide(frame, ceiling, roots, "win32");

describe("captured Windows 0.155.1 frames", () => {
  it("contains real initialize, initialized and dataBase64 fields", () => {
    expect(requests.find(f => f.method === "initialize").params.clientName).toBeTruthy();
    expect(requests.find(f => f.method === "initialized")).not.toHaveProperty("id");
    expect(writes).toHaveLength(3);
    for (const f of writes) {
      expect(f.params).toHaveProperty("dataBase64");
      expect(f.params).not.toHaveProperty("data_base64");
    }
    expect(start.params).toMatchObject({ tty: false, sandbox: { windowsSandboxLevel: "restricted-token" } });
  });
  it("allows the captured workspace request under a matching Windows root", () => {
    expect(decision(start).allow).toBe(true);
    expect(decision(start, [root.toUpperCase().replaceAll("\\", "/")]).allow).toBe(true);
  });
  it("allows the real inside file write and rejects both real outside writes", () => {
    expect(writes.map(f => decision(f, [fileRoot]).allow)).toEqual([true, false, false]);
  });
  it("rejects a different drive, prefix lookalike, outside sandbox cwd and outside workspace root", () => {
    for (const uri of [start.params.cwd.replace("file:///C:/", "file:///D:/"), `${start.params.cwd}-other`, "file:///C:/Windows"]) {
      for (const frame of [
        { ...start, params: { ...start.params, cwd: uri } },
        { ...start, params: { ...start.params, sandbox: { ...start.params.sandbox, cwd: uri } } },
        { ...start, params: { ...start.params, sandbox: { ...start.params.sandbox, workspaceRoots: [uri] } } },
      ]) expect(decision(frame).allow).toBe(false);
    }
  });
  it("preserves the local mode and network ceilings for Windows", () => {
    expect(decision({ ...start, params: { ...start.params, sandbox: null } }).allow).toBe(false);
    expect(decide(start, { ...ceiling, sandbox: "read-only" }, [root], "win32").allow).toBe(false);
    expect(decision({ ...start, params: { ...start.params, sandbox: {
      ...start.params.sandbox, permissions: { ...start.params.sandbox.permissions, network: "enabled" },
    } } }).allow).toBe(false);
  });
});

describe("Windows path boundaries", () => {
  it("normalizes drive case, separators, spaces and non-ASCII file URIs", () => {
    expect(uriToPath("file:///c:/Users/Test/a%20b/%E6%96%87%E6%A1%A3", "win32")).toBe("c:\\Users\\Test\\a b\\文档");
    expect(isUnder("c:/USERS/test/a b/文档", "C:\\Users\\Test\\a b", "win32")).toBe(true);
    expect(isUnder("c:/work/..inside/f", "C:\\work", "win32")).toBe(true);
    expect(isUnder("C:\\work\\..\\outside", "C:\\work", "win32")).toBe(false);
  });
  it.each(["C:relative", "\\work", "\\\\server\\share", "\\\\?\\C:\\work", "C:\\work\\f:stream", "C:\\work.\\f", "C:\\work \\f", "C:\\work\\NUL.txt", "C:\\work\\bad\u0000"])('refuses ambiguous/unsupported path %s', value => {
    expect(canonicalPath(value, "win32")).toBeNull();
  });
  it.each(["https://example.test/a", "file:///C:/work/a%2Fb", "file:///C:/work/a%5Cb", "file:///C:/work/a?x", "file:///C:/work/a#fragment", "file:///C:/work/f%3Astream", "file://server/share/a", "file:///C:/work/%00"])('refuses nonlocal or ambiguous URI %s', value => {
    expect(uriToPath(value, "win32")).toBeNull();
  });
  it("POSIX remains case sensitive and does not depend on the test host", () => {
    expect(isUnder("/a/B", "/a/b", "linux")).toBe(false);
    expect(isUnder("/a/..inside/f", "/a", "linux")).toBe(true);
    expect(uriToPath("file:///home/test/a%20b", "linux")).toBe("/home/test/a b");
  });
});
