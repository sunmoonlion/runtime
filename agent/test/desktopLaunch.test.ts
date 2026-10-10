import { describe, expect, it } from "vitest";
import { launchOpenDesktop } from "../src/resident.js";

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
});
