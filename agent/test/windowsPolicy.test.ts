import { describe, it, expect } from "vitest";
import { windowsDecision } from "../src/windowsPolicy.js";
const root = "C:\\Allowed", home = "C:\\Agent\\codex-home";
const ceiling = { sandbox: "workspace-write", network: false } as const;
const frame = () => ({ id: 1, method: "process/start", params: {
  processId: "p1", argv: ["cmd.exe", "/c", "echo ok"], cwd: "file:///C:/Allowed", env: {}, tty: false,
  sandbox: { cwd: "file:///C:/Allowed", workspaceRoots: ["file:///C:/Allowed"], windowsSandboxLevel: "restricted-token", useLegacyLandlock: false,
    permissions: { type: "managed", network: "restricted", file_system: { type: "restricted", entries: [
      { path: { type: "special", value: { kind: "root" } }, access: "read" },
      { path: { type: "special", value: { kind: "project_roots" } }, access: "write" },
    ] } },
  },
} });
const check = (f: any, over = ceiling) => windowsDecision(f, over, [root], home);
describe("Windows strict protocol policy", () => {
  it("accepts pinned process shape and sandboxed modes", () => { expect(check(frame()).allow).toBe(true); const f = frame(); f.params.sandbox.windowsSandboxLevel = "elevated"; expect(check(f).allow).toBe(true); });
  it.each([null, "none", {}, { permissions: { type: "unrestricted" } }])("refuses absent/unknown sandbox %j", sandbox => { const f: any = frame(); f.params.sandbox = sandbox; expect(check(f).allow).toBe(false); });
  it.each(["disabled", "none", "unelevated"])("refuses wire sandbox level %s", level => { const f = frame(); f.params.sandbox.windowsSandboxLevel = level; expect(check(f).allow).toBe(false); });
  it("checks every write entry, not just mode/cwd", () => {
    for (const entry of [
      { path: { type: "path", path: "file:///C:/Outside" }, access: "write" },
      { path: { type: "special", value: { kind: "root" } }, access: "write" },
      { path: { type: "special", value: { kind: "tmpdir" } }, access: "write" },
      { path: { type: "special", value: { kind: "project_roots", subpath: "../../outside" } }, access: "write" },
      { path: { type: "glob_pattern", pattern: "C:/**" }, access: "write" },
      { path: { type: "special", value: { kind: "future" } }, access: "write" },
    ]) { const f: any = frame(); f.params.sandbox.permissions.file_system.entries.push(entry); expect(check(f).allow).toBe(false); }
    const f: any = frame(); f.params.sandbox.permissions.file_system.entries.push({ path: { type: "path", path: "file:///C:/Allowed/sub" }, access: "write" }); expect(check(f).allow).toBe(true);
  });
  it("rejects network widening and reserved executor configuration overrides", () => {
    const f = frame(); f.params.sandbox.permissions.network = "enabled"; expect(check(f).allow).toBe(false);
    for (const key of ["CODEX_HOME", "CODEX_EXEC_SERVER_EXIT_ON_STDIN_CLOSE", "NODE_OPTIONS"]) { const f: any = frame(); f.params.env[key] = "bad"; expect(check(f).allow).toBe(false); }
  });
  it("rejects unknown methods, notifications, responses, extra fields and malformed frames", () => {
    for (const f of [null, [], {}, { id: 1, result: {} }, { id: 1, method: "fs/newWrite", params: {} }, { method: "fs/writeFile", params: { path: "file:///C:/Allowed/x" } }, { method: "initialized", params: { extra: 1 } }, { ...frame(), surprise: true }]) expect(check(f).allow).toBe(false);
  });
  it.each(["fs/readFile", "fs/open", "fs/getMetadata", "fs/canonicalize", "fs/readDirectory", "fs/walk"])("limits %s reads to roots plus executor home", method => {
    const f = (path: string) => ({ id: 1, method, params: { path, sandbox: null } });
    expect(check(f("file:///c:/ALLOWED/x")).allow).toBe(true);
    expect(check(f("file:///C:/Agent/codex-home/config.toml")).allow).toBe(true);
    for (const p of ["file:///C:/Outside/x", "file:///C:/Allowed-other/x", "file://server/share/x", "file:///C:/Allowed/x:stream", "file:///C:/ALLOWE~1/x"]) expect(check(f(p)).allow).toBe(false);
  });
  it("checks copy source and destination separately", () => {
    const f = (src: string, dst: string) => ({ id: 1, method: "fs/copy", params: { sourcePath: src, destinationPath: dst, recursive: false } });
    expect(check(f("file:///C:/Allowed/a", "file:///C:/Allowed/b")).allow).toBe(true);
    expect(check(f("file:///C:/Outside/a", "file:///C:/Allowed/b")).allow).toBe(false);
    expect(check(f("file:///C:/Allowed/a", "file:///C:/Outside/b")).allow).toBe(false);
  });
});
