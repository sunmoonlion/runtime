import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, loadConfig, saveConfig, type AgentConfig } from "../src/config.js";
import { LocalSettings } from "../src/localSettings.js";
import { LocalFiles } from "../src/localFiles.js";

let base: string, file: string, root: string, other: string, library: string, cfg: AgentConfig, enabled: boolean;
let settings: LocalSettings, confirm: ReturnType<typeof vi.fn>, restart: ReturnType<typeof vi.fn>, setAuto: ReturnType<typeof vi.fn>;
const signal = () => new AbortController().signal;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "sunmoon-settings-"));
  [root, other, library] = ["root", "other", "library"].map(name => path.join(base, name));
  for (const dir of [root, other, library, path.join(base, "state", "codex-home")]) fs.mkdirSync(dir, { recursive: true });
  file = path.join(base, "state", "config.json");
  cfg = { ...defaultConfig(), codexHome: path.join(base, "state", "codex-home"), roots: [root], rootChoices: [root, other], ceiling: { sandbox: "read-only", network: false }, token: "private-test-token" };
  saveConfig(cfg, file); enabled = false;
  confirm = vi.fn(async () => true); restart = vi.fn(async () => {});
  setAuto = vi.fn(async (value: boolean) => { enabled = value; });
  settings = new LocalSettings({ file, config: () => cfg, confirm, restart, autostart: { get: async () => enabled, set: setAuto } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); fs.rmSync(base, { recursive: true, force: true }); });
describe("loopback settings transaction", () => {
  it.each(["roots", "sandbox", "network", "library", "autostart"])("requires confirmation for widening %s", async kind => {
    const updates: Record<string, object> = { roots: { roots: [root, other] }, sandbox: { ceiling: { sandbox: "workspace-write", network: false } }, network: { ceiling: { sandbox: "read-only", network: true } }, library: { libraryDir: library }, autostart: { autostart: true } };
    expect(await settings.write(updates[kind], signal())).toEqual({ applied: true, restart: true });
    expect(confirm).toHaveBeenCalledTimes(1); expect(restart).not.toHaveBeenCalled();
    expect(loadConfig(file).lastSettingsChange).toMatch(/^\d{4}-/);
    expect(loadConfig(file).token).toBe("private-test-token");
    await settings.restart(); expect(restart).toHaveBeenCalledTimes(1);
  });
  it.each(["roots", "sandbox", "network", "library", "autostart", "choices"])("writes narrowing %s without confirmation", async kind => {
    cfg.ceiling = { sandbox: "workspace-write", network: true }; cfg.libraryDir = library; enabled = true; saveConfig(cfg, file);
    const updates: Record<string, object> = { roots: { roots: [] }, sandbox: { ceiling: { sandbox: "read-only", network: true } }, network: { ceiling: { sandbox: "workspace-write", network: false } }, library: { libraryDir: null }, autostart: { autostart: false }, choices: { rootChoices: [root, library] } };
    await settings.write(updates[kind], signal()); expect(confirm).not.toHaveBeenCalled();
  });
  it("combines every widening in one window, mentioning the directories locally", async () => {
    await settings.write({ roots: [root, other], ceiling: { sandbox: "workspace-write", network: true }, libraryDir: library, autostart: true }, signal());
    expect(confirm).toHaveBeenCalledTimes(1);
    const message = confirm.mock.calls[0][0]; expect(message).toContain(other); expect(message).toContain(library);
    expect(cfg.roots).toEqual([root, other]); expect(cfg.roots).not.toContain(library); expect(enabled).toBe(true);
  });
  it("a changed library is widening, an equivalent canonical path is not", async () => {
    cfg.libraryDir = library; saveConfig(cfg, file);
    await settings.write({ libraryDir: path.join(library, ".") }, signal()); expect(confirm).not.toHaveBeenCalled();
    await settings.restart(); await settings.write({ libraryDir: other }, signal()); expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("denial leaves config bytes, in-memory settings and autostart unchanged", async () => {
    const before = fs.readFileSync(file); confirm.mockResolvedValue(false);
    await expect(settings.write({ roots: [other], ceiling: { sandbox: "workspace-write", network: true }, libraryDir: library, autostart: true }, signal())).rejects.toMatchObject({ status: 409, code: "local_denied" });
    expect(fs.readFileSync(file).equals(before)).toBe(true); expect(cfg.roots).toEqual([root]); expect(setAuto).not.toHaveBeenCalled();
  });
  it("holds the single-write lock through confirmation and pending restart", async () => {
    let allow!: (value: boolean) => void;
    confirm.mockImplementation(() => new Promise<boolean>(resolve => { allow = resolve; }));
    const first = settings.write({ roots: [root, other] }, signal()); await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    await expect(settings.write({ roots: [] }, signal())).rejects.toMatchObject({ status: 409, code: "busy" });
    allow(true); await first;
    await expect(settings.write({ roots: [] }, signal())).rejects.toMatchObject({ status: 409, code: "busy" });
    await settings.restart(); await settings.write({ roots: [] }, signal());
  });
  it("timeouts after 60s with a broken confirmation callback and leaves config intact", async () => {
    vi.useFakeTimers(); confirm.mockImplementation(() => new Promise(() => {}));
    const before = fs.readFileSync(file), write = settings.write({ libraryDir: library }, signal());
    const rejected = expect(write).rejects.toMatchObject({ status: 409, code: "local_denied" });
    await vi.advanceTimersByTimeAsync(60000); await rejected; expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(confirm.mock.calls[0][1].aborted).toBe(true);
  });
  it("cancellation never writes even if the confirmation callback later approves", async () => {
    let allow!: (value: boolean) => void;
    confirm.mockImplementation(() => new Promise<boolean>(resolve => { allow = resolve; }));
    const before = fs.readFileSync(file), controller = new AbortController();
    const write = settings.write({ libraryDir: library }, controller.signal);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled()); controller.abort();
    await expect(write).rejects.toMatchObject({ status: 409, code: "local_denied" }); allow(true);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
  it("does not overwrite a concurrent local edit made while confirming", async () => {
    confirm.mockImplementation(async () => { const changed = { ...cfg, machineName: "local-edit" }; saveConfig(changed, file); return true; });
    await expect(settings.write({ libraryDir: library }, signal())).rejects.toMatchObject({ status: 409, code: "busy" });
    expect(loadConfig(file).machineName).toBe("local-edit"); expect(loadConfig(file).libraryDir).toBeUndefined(); expect(setAuto).not.toHaveBeenCalled();
  });
  it("revalidates directories after confirmation before writing", async () => {
    const before = fs.readFileSync(file); confirm.mockImplementation(async () => { fs.rmdirSync(library); return true; });
    await expect(settings.write({ libraryDir: library }, signal())).rejects.toMatchObject({ status: 400, code: "invalid" });
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
  it("rolls back login task changes if disconnected before committing config", async () => {
    const controller = new AbortController(), before = fs.readFileSync(file);
    setAuto.mockImplementation(async value => { enabled = value; if (value) controller.abort(); });
    await expect(settings.write({ autostart: true }, controller.signal)).rejects.toMatchObject({ status: 409, code: "local_denied" });
    expect(setAuto.mock.calls.map(call => call[0])).toEqual([true, false]); expect(enabled).toBe(false); expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
  it("a failed config replacement restores the login task and leaves no partial config or temporary file", async () => {
    const before = fs.readFileSync(file);
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("simulated disk failure"); });
    await expect(settings.write({ autostart: true, libraryDir: library }, signal())).rejects.toThrow("simulated disk failure");
    expect(enabled).toBe(false); expect(setAuto.mock.calls.map(call => call[0])).toEqual([true, false]);
    expect(fs.readFileSync(file).equals(before)).toBe(true); expect(cfg.libraryDir).toBeUndefined();
    expect(fs.readdirSync(path.dirname(file)).filter(name => name.startsWith(".settings-"))).toEqual([]);
  });
  it("reads the current disk settings shared with tray after a local edit", async () => {
    saveConfig({ ...cfg, machineName: "renamed-locally" }, file);
    expect((await settings.read("0.4.0")).machineName).toBe("renamed-locally");
  });
  it("rejects invalid inputs before opening any window or touching the login task", async () => {
    const before = fs.readFileSync(file);
    for (const input of [null, [], {}, { token: "x" }, { machineName: "x" }, { roots: [library] }, { roots: Array(33).fill(root) }, { roots: [root, root] }, { rootChoices: [] }, { rootChoices: [root, root] }, { libraryDir: "relative" }, { libraryDir: path.join(base, "missing") }, { libraryDir: path.join(root, "auth.json") }, { autostart: 1 }, { ceiling: { sandbox: "danger-full-access", network: false } }, { ceiling: { sandbox: "read-only", network: "yes" } }, { ceiling: { sandbox: "read-only", network: false, other: true } }]) {
      await expect(settings.write(input, signal())).rejects.toMatchObject({ status: 400, code: "invalid" });
    }
    expect(confirm).not.toHaveBeenCalled(); expect(setAuto).not.toHaveBeenCalled(); expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
  it.skipIf(process.platform === "win32")("rejects symlink directories and protected configuration roots", async () => {
    const link = path.join(base, "link"); fs.symlinkSync(library, link);
    for (const input of [{ libraryDir: link }, { libraryDir: cfg.codexHome }, { rootChoices: [root, base] }]) await expect(settings.write(input, signal())).rejects.toMatchObject({ status: 400 });
    expect(confirm).not.toHaveBeenCalled();
  });
  it("projects only public settings and makes the library readable without adding it to roots", async () => {
    await settings.write({ libraryDir: library }, signal());
    const view = await settings.read("0.4.0");
    expect(Object.keys(view).sort()).toEqual(["autostart", "ceiling", "lastSettingsChange", "libraryDir", "machineName", "rootChoices", "roots", "version"]);
    expect(JSON.stringify(view)).not.toContain(cfg.token); expect(view.roots).toEqual([root]);
    if (process.platform === "win32") return; // Native library helper is covered by the isolated Windows acceptance probe.
    fs.writeFileSync(path.join(library, "note.md"), "test library");
    const files = new LocalFiles({ roots: () => [...cfg.roots, ...(cfg.libraryDir ? [cfg.libraryDir] : [])], configDir: path.dirname(file), codexHome: cfg.codexHome });
    expect((await files.read("file", path.join(library, "note.md"))).content.toString()).toBe("test library");
    await files.close();
  });
});
