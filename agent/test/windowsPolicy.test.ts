import { describe, it, expect } from "vitest";
import { windowsDecision, isClientWindowsEnvAnnotation, isInapplicableWindowsReadGuard } from "../src/windowsPolicy.js";
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
const clientFrame = () => {
  const f: any = frame();
  const threadId = "01a116d9-d2f4-77f3-8f14-4deb4d373f33";
  f.params.metadata = { threadId, toolCallId: "call_probe" };
  f.params.envPolicy = { inherit: "all", ignoreDefaultExcludes: true, exclude: ["CODEX_PERMISSION_PROFILE", "CODEX_VERSION", "CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS", "CODEX_PLUGIN_METRICS_OUTPUT"], set: {}, includeOnly: [] };
  f.params.env = { CODEX_THREAD_ID: threadId, CODEX_SESSION_ID: threadId, CODEX_VERSION: "0.155.1", CODEX_CI: "1", CODEX_SANDBOX_NETWORK_DISABLED: "1", TERM: "dumb" };
  f.params.sandbox.windowsSandboxPrivateDesktop = true;
  f.params.sandbox.windowsSandboxProxySettingsMode = "reconcile";
  f.params.pipeStdin = false;
  return f;
};
describe("Windows strict protocol policy", () => {
  it("discards only optional pure POSIX read guards, never malformed Windows guards", () => {
    const guard = (uri: string): any => ({ path: { type: "path", path: uri }, access: "read", missing_path_behavior: "skip" });
    const withEntry = (entry: any) => { const f: any = frame(); f.params.sandbox.permissions.file_system.entries.push(entry); return f; };
    for (const uri of ["file:///data/.codex", "file:///home/service/project/.codex"]) {
      const entry = guard(uri); expect(isInapplicableWindowsReadGuard(entry)).toBe(true); expect(check(withEntry(entry)).allow).toBe(true);
      for (const access of ["write", "deny"]) expect(check(withEntry({ ...entry, access })).allow).toBe(false);
      for (const missing_path_behavior of [undefined, null, "error"]) expect(check(withEntry({ ...entry, missing_path_behavior })).allow).toBe(false);
      expect(check(withEntry({ ...entry, unexpected: true })).allow).toBe(false);
      expect(check(withEntry({ ...entry, path: { ...entry.path, value: {} } })).allow).toBe(false);
      expect(check(withEntry(entry), { ...ceiling, sandbox: "read-only" } as any).allow).toBe(false);
    }
    const native = guard("file:///C:/Allowed/.codex"); expect(isInapplicableWindowsReadGuard(native)).toBe(false); expect(check(withEntry(native)).allow).toBe(true);
    for (const uri of ["/data/.codex", "file:///data/C:%5CUsers%5Cproject/.codex", "file:///data/C:/Users/project/.codex", "file:///C:/Outside/.codex", "file:///C:/Allowed./.codex", "file:///C:/ALLOWE~1/.codex", "file:///C:/Allowed/x:stream", "file://server/share/.codex", "file:////server/share/.codex", "file:///%5C%5C%3F%5CC:%5CAllowed/.codex", "file:///data/.codex?x=1"]) {
      expect(isInapplicableWindowsReadGuard(guard(uri))).toBe(false); expect(check(withEntry(guard(uri))).allow).toBe(false);
    }
  });
  it("requires owned temp context, exact special shape and writable ceiling", () => {
    for (const kind of ["tmpdir", "slash_tmp"]) {
      const f: any = frame(); const entry = { path: { type: "special", value: { kind } as any }, access: "write" };
      f.params.sandbox.permissions.file_system.entries.push(entry);
      expect(windowsDecision(f, ceiling, [root], home, "C:\\Owned").allow).toBe(true);
      expect(windowsDecision(f, { ...ceiling, sandbox: "read-only" }, [root], home, "C:\\Owned").allow).toBe(false);
      entry.path.value.subpath = ".."; expect(windowsDecision(f, ceiling, [root], home, "C:\\Owned").allow).toBe(false);
    }
    for (const key of ["TEMP", "Tmp", "tmpdir"]) { const f: any = frame(); f.params.env[key] = "C:\\Elsewhere"; expect(windowsDecision(f, ceiling, [root], home, "C:\\Owned").allow).toBe(false); }
  });
  it("accepts captured client metadata and strips only validated generated annotations", () => {
    const f = clientFrame(); expect(check(f).allow).toBe(true);
    expect(Object.keys(f.params.env).filter(k => !isClientWindowsEnvAnnotation(f.params, k))).toEqual(["TERM"]);
    for (const key of ["CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_VERSION", "CODEX_CI", "CODEX_SANDBOX_NETWORK_DISABLED", "CODEX_HOME", "codex_version", "NODE_OPTIONS"]) {
      const bad = clientFrame(); bad.params.env[key] = "bad"; expect(check(bad).allow).toBe(false);
    }
  });
  it("rejects altered environment policies, metadata and Windows launch options", () => {
    const edits = [
      (p: any) => p.metadata.extra = true,
      (p: any) => p.metadata.threadId = "bad",
      (p: any) => p.envPolicy.set.CODEX_HOME = "bad",
      (p: any) => p.envPolicy.exclude = ["PATH"],
      (p: any) => p.envPolicy.exclude = ["CODEX*"],
      (p: any) => p.envPolicy.includeOnly = ["PATH"],
      (p: any) => p.envPolicy.inherit = "none",
      (p: any) => p.envPolicy.ignoreDefaultExcludes = false,
      (p: any) => p.sandbox.windowsSandboxPrivateDesktop = false,
      (p: any) => p.sandbox.windowsSandboxProxySettingsMode = "unknown",
      (p: any) => p.pipeStdin = "yes",
      (p: any) => p.enforceManagedNetwork = "no",
    ];
    for (const edit of edits) { const f = clientFrame(); edit(f.params); expect(check(f).allow).toBe(false); }
  });
  it("accepts the captured 0.155.1 client handshake and validates resumeSessionId", () => {
    const init = (resumeSessionId: unknown) => ({ id: 1, method: "initialize", params: { clientName: "codex-environment", resumeSessionId } });
    expect(check(init(null)).allow).toBe(true);
    expect(check(init("467deea9-3b76-4af0-9a7b-db781857cd19")).allow).toBe(true);
    for (const value of [1, {}, "", "not-a-session", "../../outside"]) expect(check(init(value)).allow).toBe(false);
    expect(check({ ...init(null), params: { ...init(null).params, extra: true } }).allow).toBe(false);
  });
  it("accepts null params only on parameterless environment methods", () => {
    for (const method of ["environment/info", "environment/status"]) {
      expect(check({ id: 2, method, params: null }).allow).toBe(true);
      expect(check({ id: 2, method, params: {} }).allow).toBe(true);
      expect(check({ id: 2, method, params: [] }).allow).toBe(false);
      expect(check({ id: 2, method, params: { extra: true } }).allow).toBe(false);
    }
    expect(check({ id: 2, method: "fs/readFile", params: null }).allow).toBe(false);
  });
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
  it("accepts captured read-only project guards, rejecting traversal, writes and temp grants", () => {
    for (const subpath of [".git", ".agents", ".codex"]) {
      const f: any = frame();
      const guard = { path: { type: "special", value: { kind: "project_roots", subpath } }, access: "read", missing_path_behavior: "skip" };
      f.params.sandbox.permissions.file_system.entries.push(guard); expect(check(f).allow).toBe(true);
      guard.access = "write"; expect(check(f).allow).toBe(false);
      guard.access = "read"; guard.path.value.subpath = "../outside"; expect(check(f).allow).toBe(false);
    }
    for (const kind of ["slash_tmp", "tmpdir"]) {
      const f: any = frame(); f.params.sandbox.permissions.file_system.entries.push({ path: { type: "special", value: { kind } }, access: "write" });
      expect(check(f).allow).toBe(false);
    }
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
