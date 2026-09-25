// `<子命令> --help` 只打印用法、立即退出，不启动代理（以前 start --help 会真的起一个 exec-server 并连会合点）
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.resolve(__dirname, "../dist/cli.js");

describe("cli --help", () => {
  for (const args of [["--help"], ["start", "--help"], ["init", "-h"], ["roots", "list", "--help"]]) {
    it(`${args.join(" ")} prints usage and exits 0 without starting`, () => {
      const home = mkdtempSync(path.join(tmpdir(), "agent-help-"));
      const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, SUNMOON_AGENT_HOME: home }, timeout: 5000, encoding: "utf8" });
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/init --relay/);
      expect(r.stdout + r.stderr).not.toMatch(/exec-server ready/);
    });
  }
});
