import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs", () => ({ default: { statSync: () => ({ isDirectory: () => true }) } }));
const mocks = vi.hoisted(() => ({ reply: {} as any, release: vi.fn() }));
vi.mock("../src/windowsRuntime.js", async original => ({
  ...await original<any>(),
  pinWindowsDirectories: async () => mocks.release,
  WindowsFiles: class { async call() { return mocks.reply; } async close() {} },
}));
import { WindowsBridge } from "../src/windowsBridge.js";
const options = { roots: ["C:\\Allowed"], home: "C:\\Agent\\home", mode: "unelevated" as const, helper: { node: "node.exe", script: "helper.mjs" }, ceiling: { sandbox: "workspace-write" as const, network: false }, url: () => "ws://127.0.0.1:1" };
const start = (id: number, processId = "p1") => ({ id, method: "process/start", params: { processId, argv: ["cmd.exe"], env: {}, tty: false, cwd: "file:///C:/Allowed", sandbox: { cwd: "file:///C:/Allowed", workspaceRoots: ["file:///C:/Allowed"], windowsSandboxLevel: "restricted-token", permissions: { type: "managed", network: "restricted", file_system: { type: "restricted", entries: [{ path: { type: "special", value: { kind: "project_roots" } }, access: "write" }] } } } } });
const send = (bridge: WindowsBridge, frame: any) => bridge.receive(JSON.stringify(frame), false);
const terminate = (bridge: WindowsBridge, processId = "p1") => send(bridge, { id: 9, method: "process/terminate", params: { processId } });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("Windows bridge follow-up contracts", () => {
  it("answers late termination only for this stream, expires after 60 seconds", async () => {
    vi.useFakeTimers(); const bridge = new WindowsBridge(options), other = new WindowsBridge(options);
    expect((await send(bridge, start(1))).forward).toBeTruthy();
    bridge.observe(JSON.stringify({ id: 1, result: { processId: "p1" } }));
    bridge.observe(JSON.stringify({ method: "process/closed", params: { processId: "p1" } }));
    expect(mocks.release).toHaveBeenCalledTimes(1);
    const result = await terminate(bridge); expect(result.reason).toBeUndefined(); expect(JSON.parse(result.response!).result).toEqual({ running: false });
    expect((await terminate(other)).reason).toContain("unknown processId");
    expect((await terminate(bridge, "unknown")).reason).toContain("unknown processId");
    expect((await send(bridge, start(2))).reason).toContain("duplicate");
    vi.advanceTimersByTime(60001); expect((await terminate(bridge)).reason).toContain("unknown processId");
    await bridge.close(); await other.close();
  });
  it("does not learn unrelated executor closed IDs", async () => {
    const bridge = new WindowsBridge(options);
    bridge.observe(JSON.stringify({ method: "process/closed", params: { processId: "p1" } }));
    expect((await terminate(bridge)).reason).toContain("unknown processId"); await bridge.close();
  });
  it("returns real helper not-found without counting a ceiling denial", async () => {
    const bridge = new WindowsBridge(options);
    mocks.reply = { error: { code: -32004, message: "not found (os error 2)" } };
    const result = await send(bridge, { id: 8, method: "fs/getMetadata", params: { path: "file:///C:/Allowed/missing" } });
    expect(result.reason).toBeUndefined(); expect(JSON.parse(result.response!).error).toEqual(mocks.reply.error);
    mocks.reply = { error: { code: -32001, message: "alias refused" } };
    expect((await send(bridge, { id: 9, method: "fs/readFile", params: { path: "file:///C:/Allowed/link" } })).reason).toBeTruthy();
    await bridge.close();
  });
  it("accepts only captured config projection, delegating to fixed-file helper", async () => {
    const bridge = new WindowsBridge(options); mocks.reply = { result: { config: { layers: [], cloudInsertionIndex: 0 } } };
    const frame = { id: 1, method: "environmentConfig/read", params: { cwd: "file:///C:/Allowed", configPaths: [["mcp_servers"]], requirementsPaths: [["mcp_servers"]] } };
    expect((await send(bridge, frame)).reason).toBeUndefined();
    for (const params of [{ ...frame.params, path: "file:///C:/auth.json" }, { ...frame.params, cwd: "file:///C:/Outside" }, { ...frame.params, configPaths: [[]] }, { ...frame.params, configPaths: [["model_providers"]] }]) expect((await send(bridge, { ...frame, params })).reason).toBeTruthy();
    await bridge.close();
  });
});
