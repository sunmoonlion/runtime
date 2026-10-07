import { describe, expect, it } from "vitest";
import { windowsEnvironment } from "../src/windowsRuntime.js";

describe("Windows command environment", () => {
  it("preserves user tools and ordinary environment, removing reserved keys case-insensitively", () => {
    const inherited = { Path: "C:\\Git\\cmd;C:\\Python;C:\\uv", USERPROFILE: "C:\\Users\\tester", UV_CACHE_DIR: "C:\\Cache", NODE_USE_ENV_PROXY: "1", CoDeX_HOME: "wrong", CODEX_API_KEY: "test-only", sunmoon_token: "test-only", NODE_OPTIONS: "--require bad", node_path: "bad", RUST_LOG: "trace", LD_ANYTHING: "bad" };
    const env = windowsEnvironment("C:\\Agent\\home", {}, inherited);
    expect(env).toEqual({ PATH: inherited.Path, USERPROFILE: inherited.USERPROFILE, UV_CACHE_DIR: "C:\\Cache", NODE_USE_ENV_PROXY: "1", CODEX_HOME: "C:\\Agent\\home" });
    expect(inherited.CoDeX_HOME).toBe("wrong");
  });
  it("merges remote ordinary variables case-insensitively, keeping fixed CODEX_HOME", () => {
    expect(windowsEnvironment("C:\\home", { pAtH: "C:\\Other", MODE: "remote" }, { Path: "C:\\Local", mode: "local" })).toEqual({ PATH: "C:\\Other", MODE: "remote", CODEX_HOME: "C:\\home" });
    expect(windowsEnvironment("C:\\home", { CODEX_HOME: "C:\\home" }, {})).toEqual({ CODEX_HOME: "C:\\home" });
  });
  it("replaces inherited global Temp with the owned directory", () => {
    expect(windowsEnvironment("C:\\home", {}, { TEMP: "C:\\Global", Tmp: "C:\\Other", TMPDIR: "C:\\Third" }, "C:\\Owned")).toEqual({ CODEX_HOME: "C:\\home", TEMP: "C:\\Owned", TMP: "C:\\Owned", TMPDIR: "C:\\Owned" });
  });
  it.each(["CODEX_HOME", "codex_any", "Sunmoon_Any", "NODE_OPTIONS", "node_path", "RUST_LOG", "LD_OTHER", "TEMP", "Tmp", "tmpdir"])("refuses remote reserved variable %s", key => {
    expect(() => windowsEnvironment("C:\\home", { [key]: "bad" }, {})).toThrow("reserved");
  });
});
