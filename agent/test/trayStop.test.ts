import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discardDeadTrayStop } from "../src/resident.js";

const RUN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function home() {
  return mkdtempSync(path.join(tmpdir(), "agent-tray-stop-"));
}

function write(dir: string, name: string, pid: number) {
  writeFileSync(path.join(dir, name), JSON.stringify({ pid, runId: RUN }));
}

describe("leftover tray stop", () => {
  it("clears a stop file whose recorded tray process is gone", () => {
    const dir = home();
    try {
      write(dir, "tray-stop.json", 4242);
      write(dir, "tray.json", 4242);
      expect(discardDeadTrayStop(dir, () => false)).toBe("cleared");
      expect(existsSync(path.join(dir, "tray-stop.json"))).toBe(false);
      expect(existsSync(path.join(dir, "tray.json"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("leaves a stop request pending while the recorded tray process is alive", () => {
    const dir = home();
    try {
      write(dir, "tray-stop.json", 4242);
      write(dir, "tray.json", 4242);
      expect(discardDeadTrayStop(dir, pid => pid === 4242)).toBe("pending");
      expect(JSON.parse(readFileSync(path.join(dir, "tray-stop.json"), "utf8")).pid).toBe(4242);
      expect(JSON.parse(readFileSync(path.join(dir, "tray.json"), "utf8")).pid).toBe(4242);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("does not delete an unsafe stop file", () => {
    const dir = home();
    const target = path.join(dir, "target.json");
    const stop = path.join(dir, "tray-stop.json");
    try {
      writeFileSync(target, JSON.stringify({ pid: 1, runId: RUN }));
      symlinkSync(target, stop);
      expect(() => discardDeadTrayStop(dir, () => false)).toThrow(/Unsafe tray status/);
      expect(readFileSync(stop, "utf8")).toContain("\"pid\":1");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
