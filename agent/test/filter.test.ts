import { describe, expect, it } from "vitest";
import { decide, denialResponse, requestedMode, requestedNetwork } from "../src/filter.js";
import { isUnder, uriToPath } from "../src/pathuri.js";

const ROOT = "/home/u/research/proj";
const roots = [ROOT];
const ws = (p: string) => `file://${p}`;

// 2026-09-24 抓到的真实帧形状（runtime/probe/frames.jsonl）
const dangerStart = { id: 42, method: "process/start", params: { processId: "1", argv: ["/bin/sh", "-lc", "touch /home/u/x"], cwd: ws(ROOT), sandbox: null, enforceManagedNetwork: false, managedNetwork: null } };
const workspaceWriteStart = {
  id: 82, method: "process/start", params: {
    processId: "2", argv: ["/bin/sh", "-lc", "echo L3 > f"], cwd: ws(ROOT),
    sandbox: {
      permissions: { type: "managed", file_system: { type: "restricted", entries: [{ path: { type: "special", value: { kind: "root" } }, access: "read" }, { path: { type: "special", value: { kind: "project_roots" } }, access: "write" }] }, network: "restricted" },
      cwd: ws(ROOT), workspaceRoots: [ws(ROOT)], windowsSandboxLevel: "disabled", useLegacyLandlock: false,
    },
  },
};
const readOnlyStart = { ...workspaceWriteStart, id: 83, params: { ...workspaceWriteStart.params, sandbox: { ...workspaceWriteStart.params.sandbox, permissions: { type: "managed", file_system: { type: "restricted", entries: [{ path: { type: "special", value: { kind: "root" } }, access: "read" }] }, network: "restricted" } } } };

describe("requestedMode / requestedNetwork", () => {
  it("sandbox=null means danger-full-access with network", () => {
    expect(requestedMode(dangerStart.params)).toBe("danger-full-access");
    expect(requestedNetwork(dangerStart.params)).toBe(true);
  });
  it("write entries mean workspace-write; restricted network", () => {
    expect(requestedMode(workspaceWriteStart.params)).toBe("workspace-write");
    expect(requestedNetwork(workspaceWriteStart.params)).toBe(false);
  });
  it("read-only entries mean read-only", () => {
    expect(requestedMode(readOnlyStart.params)).toBe("read-only");
  });
});

describe("decide: process/start", () => {
  const wwCeiling = { sandbox: "workspace-write" as const, network: false };
  it("denies danger-full-access under a workspace-write ceiling", () => {
    const d = decide(dangerStart, wwCeiling, roots);
    expect(d.allow).toBe(false); expect(d.reason).toMatch(/exceeds local ceiling/);
  });
  it("allows workspace-write inside the whitelist", () => {
    expect(decide(workspaceWriteStart, wwCeiling, roots).allow).toBe(true);
  });
  it("denies workspace-write under a read-only ceiling", () => {
    expect(decide(workspaceWriteStart, { sandbox: "read-only", network: false }, roots).allow).toBe(false);
  });
  it("allows danger-full-access only when the ceiling was raised and network is on", () => {
    expect(decide(dangerStart, { sandbox: "danger-full-access", network: true }, roots).allow).toBe(true);
    expect(decide(dangerStart, { sandbox: "danger-full-access", network: false }, roots).allow).toBe(false);
  });
  it("denies cwd outside the whitelist", () => {
    const f = { ...workspaceWriteStart, params: { ...workspaceWriteStart.params, cwd: ws("/home/u/other") } };
    expect(decide(f, wwCeiling, roots).reason).toMatch(/cwd .* outside/);
  });
  it("denies workspaceRoots outside the whitelist", () => {
    const f = { ...workspaceWriteStart, params: { ...workspaceWriteStart.params, sandbox: { ...workspaceWriteStart.params.sandbox, workspaceRoots: [ws(ROOT), ws("/etc")] } } };
    expect(decide(f, wwCeiling, roots).reason).toMatch(/workspace root .* outside/);
  });
  it("denies a prefix-lookalike path (/home/u/research/proj2)", () => {
    const f = { ...workspaceWriteStart, params: { ...workspaceWriteStart.params, cwd: ws(ROOT + "2"), sandbox: { ...workspaceWriteStart.params.sandbox, cwd: ws(ROOT + "2"), workspaceRoots: [ws(ROOT + "2")] } } };
    expect(decide(f, wwCeiling, roots).allow).toBe(false);
  });
  it("denies everything when the whitelist is empty", () => {
    expect(decide(workspaceWriteStart, wwCeiling, []).allow).toBe(false);
  });
});

describe("decide: fs and http", () => {
  const c = { sandbox: "workspace-write" as const, network: false };
  it("allows reads anywhere (AGENTS.md above cwd is legitimately read)", () => {
    expect(decide({ id: 1, method: "fs/readFile", params: { path: ws("/home/u/research/AGENTS.md"), sandbox: null } }, c, roots).allow).toBe(true);
    expect(decide({ id: 2, method: "fs/getMetadata", params: { path: ws("/home/u/.codex/config.toml"), sandbox: null } }, c, roots).allow).toBe(true);
  });
  it("allows writes inside, denies outside", () => {
    expect(decide({ id: 3, method: "fs/writeFile", params: { path: ws(ROOT + "/a.txt"), data_base64: "" } }, c, roots).allow).toBe(true);
    expect(decide({ id: 4, method: "fs/writeFile", params: { path: ws("/home/u/a.txt"), data_base64: "" } }, c, roots).allow).toBe(false);
    expect(decide({ id: 5, method: "fs/copy", params: { source_path: ws("/etc/hosts"), destination_path: ws("/tmp/x") } }, c, roots).allow).toBe(false);
    expect(decide({ id: 6, method: "fs/remove", params: { path: ws(ROOT + "/old") } }, c, roots).allow).toBe(true);
  });
  it("denies all writes under a read-only ceiling", () => {
    expect(decide({ id: 7, method: "fs/writeFile", params: { path: ws(ROOT + "/a.txt") } }, { sandbox: "read-only", network: false }, roots).allow).toBe(false);
  });
  it("http/request follows the network ceiling", () => {
    expect(decide({ id: 8, method: "http/request", params: { url: "https://x" } }, c, roots).allow).toBe(false);
    expect(decide({ id: 9, method: "http/request", params: { url: "https://x" } }, { ...c, network: true }, roots).allow).toBe(true);
  });
  it("passes notifications and responses untouched", () => {
    expect(decide({ method: "process/output", params: {} }, c, roots).allow).toBe(true);
    expect(decide({ id: 10, result: {} }, c, roots).allow).toBe(true);
  });
});

describe("denialResponse", () => {
  it("is a JSON-RPC error with the same id", () => {
    const r = JSON.parse(denialResponse(dangerStart, "why"));
    expect(r.id).toBe(42); expect(r.error.code).toBe(-32001); expect(r.error.message).toMatch(/why/); expect(r.error.data.method).toBe("process/start");
  });
});

describe("pathuri", () => {
  it("decodes file URIs", () => {
    expect(uriToPath("file:///home/u/a%20b")).toBe("/home/u/a b");
    expect(uriToPath("http://x")).toBeNull();
  });
  it("isUnder is exact on boundaries", () => {
    expect(isUnder("/a/b", "/a")).toBe(true);
    expect(isUnder("/a", "/a")).toBe(true);
    expect(isUnder("/ab", "/a")).toBe(false);
    expect(isUnder("/a/../etc", "/a")).toBe(false);
  });
});
