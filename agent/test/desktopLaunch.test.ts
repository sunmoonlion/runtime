import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { desktopWindowReady, launchOpenDesktop, onboardLifetime } from "../src/resident.js";

describe("onboard child lifetime", () => {
  it("allows startup, then closes immediately if its ready marker disappears", () => {
    const tick = onboardLifetime(0, 42);
    expect(tick(0, null, false)).toBeNull();
    expect(tick(14000, 42, true)).toBeNull();
    expect(tick(14500, null, false)).toContain("disappeared");
  });
  it("allows a ten-second dead PID interval, resetting on recovery", () => {
    const tick = onboardLifetime(0, 42);
    expect(tick(0, 42, true)).toBeNull();
    expect(tick(1000, 42, false)).toBeNull();
    expect(tick(10999, 42, false)).toBeNull();
    expect(tick(11000, 42, false)).toContain("unavailable");
    expect(tick(12000, 42, true)).toBeNull();
    expect(tick(13000, 42, false)).toBeNull();
  });
  it("does not accept another window's PID or run for longer than thirty minutes", () => {
    const tick = onboardLifetime(0, 42);
    expect(tick(0, 99, true)).toBeNull();
    expect(tick(15000, 99, true)).toContain("unavailable");
    expect(tick(30 * 60000, 42, true)).toContain("30 minutes");
  });
});

describe("openDesktop waits for the window marker", () => {
  it("does not resolve until the ready file exists, and detaches wscript", async () => {
    let ready = false;
    let unrefed = false;
    const seen: { command?: string; args?: string[]; detached?: boolean; stdio?: string } = {};
    const pending = launchOpenDesktop((command, args, options) => {
      seen.command = command; seen.args = args; seen.detached = options.detached; seen.stdio = options.stdio;
      return { unref() { unrefed = true; } };
    }, "wscript.exe", "open-desktop.vbs", "node.exe", "cli.js", "C:\\state", "onboard", () => ready);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(unrefed).toBe(true);
    expect(seen).toMatchObject({ command: "wscript.exe", detached: true, stdio: "ignore" });
    expect(seen.args).toEqual(["//B", "//Nologo", "open-desktop.vbs", "node.exe", "cli.js", "C:\\state", "onboard"]);
    ready = true;
    await pending;
    expect(settled).toBe(true);
  });

  it("treats a tray status that cannot be read as not ready", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sunmoon-tray-ready-"));
    const marker = path.join(dir, "tray.json");
    try {
      expect(desktopWindowReady(marker, "tray")).toBe(false);
      fs.writeFileSync(marker, "{");
      expect(desktopWindowReady(marker, "tray")).toBe(false);
      fs.writeFileSync(marker, JSON.stringify({ pid: 1, runId: "not-a-uuid" }));
      expect(desktopWindowReady(marker, "tray")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
