import { describe, expect, it } from "vitest";
import { buildBwrapArgv, wrapCommand } from "../src/outerSandbox.js";

describe("buildBwrapArgv", () => {
  it("matches the probe-verified shape: ro /, private /tmp, rw only for roots and CODEX_HOME", () => {
    const argv = buildBwrapArgv({ bwrap: "/x/bwrap", roots: ["/home/u/proj"], codexHome: "/home/u/.sunmoon-agent/codex-home" }, ["/x/codex", "exec-server", "--listen", "ws://127.0.0.1:1"]);
    expect(argv.slice(0, 9)).toEqual(["/x/bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs"]);
    expect(argv).toContain("--unshare-pid");
    expect(argv).toContain("--die-with-parent");
    expect(argv).not.toContain("--unshare-net");
    const binds = argv.map((a, i) => (a === "--bind" ? argv[i + 1] : null)).filter(Boolean);
    expect(binds).toEqual(["/home/u/.sunmoon-agent/codex-home", "/home/u/proj"]);
    expect(argv.slice(argv.indexOf("--") + 1)).toEqual(["/x/codex", "exec-server", "--listen", "ws://127.0.0.1:1"]);
  });
  it("dedupes and normalizes roots", () => {
    const argv = buildBwrapArgv({ bwrap: "/x/bwrap", roots: ["/home/u/proj/", "/home/u/proj"], codexHome: "/h" }, ["c"]);
    expect(argv.filter((a) => a === "--bind").length).toBe(2);
  });
});

describe("wrapCommand", () => {
  it("does not wrap when disabled or when there is no bwrap", () => {
    expect(wrapCommand(["c"], { enabled: false, bwrap: "/x/bwrap", roots: [], codexHome: "/h" })).toEqual({ argv: ["c"], sandboxed: false });
    expect(wrapCommand(["c"], { enabled: true, bwrap: null, roots: [], codexHome: "/h" })).toEqual({ argv: ["c"], sandboxed: false });
  });
});
