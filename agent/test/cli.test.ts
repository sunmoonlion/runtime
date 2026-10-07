// `<子命令> --help` 只打印用法、立即退出，不启动代理（以前 start --help 会真的起一个 exec-server 并连会合点）
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.resolve(__dirname, "../dist/cli.js");

describe("cli --help", () => {
  for (const args of [["--help"], ["start", "--help"], ["init", "-h"], ["roots", "list", "--help"]]) {
    it(`${args.join(" ")} prints usage and exits 0 without starting`, () => {
      const home = mkdtempSync(path.join(tmpdir(), "agent-help-"));
      try {
        const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, SUNMOON_AGENT_HOME: home }, timeout: 5000, encoding: "utf8" });
        expect(r.error).toBeUndefined();
        expect(r.status).toBe(0);
        expect(r.stdout + r.stderr).toMatch(/init --relay/);
        expect(r.stdout + r.stderr).not.toMatch(/exec-server ready/);
      } finally { rmSync(home, { recursive: true, force: true }); }
    });
  }
});

describe.skipIf(process.platform !== "win32")("Windows CLI before sandbox admission", () => {
  it("supports configuration commands but refuses start before any relay connection", () => {
    const home = mkdtempSync(path.join(tmpdir(), "agent-cli-"));
    const workspace = path.join(home, "workspace");
    mkdirSync(workspace);
    const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, SUNMOON_AGENT_HOME: home }, timeout: 10000, encoding: "utf8", windowsHide: true,
    });
    try {
      expect(run("init", "--root", workspace).status).toBe(0);
      expect(run("roots", "add", workspace.toUpperCase()).status).toBe(0);
      expect(JSON.parse(readFileSync(path.join(home, "config.json"), "utf8")).roots).toHaveLength(1);
      expect(run("roots", "list").stdout).toContain(workspace);
      expect(run("ceiling", "set", "--sandbox", "read-only", "--network", "off").status).toBe(0);
      expect(JSON.parse(run("ceiling", "show").stdout)).toEqual({ sandbox: "read-only", network: false });
      expect(run("status").status).toBe(1);
      const start = run("start");
      expect(start.error).toBeUndefined();
      expect(start.status).toBe(1);
      expect(start.stdout + start.stderr).toContain("CreateRestrictedToken failed: 87");
      expect(start.stdout + start.stderr).not.toMatch(/exec-server starting|relay connected/);
      expect(existsSync(path.join(home, "status.json"))).toBe(false);
      expect(existsSync(path.join(home, "codex-home", "auth.json"))).toBe(false);
      expect(run("roots", "remove", workspace.toUpperCase()).status).toBe(0);
      expect(run("roots", "list").stdout.trim()).toBe("");
    } finally { rmSync(home, { recursive: true, force: true }); }
  }, 30000);
});
