import { describe, expect, it } from "vitest";
import { deliverDesktop } from "../src/resident.js";

describe("openDesktop waits for stdin", () => {
  it("does not resolve until the injected spawn finishes writing stdin", async () => {
    let release = (): void => {};
    let unrefed = false;
    const seen: { command?: string; args?: string[]; payload?: string; detached?: boolean } = {};
    const pending = deliverDesktop((command, args, options) => {
      seen.command = command; seen.args = args; seen.detached = options.detached; seen.payload = undefined;
      return {
        stdin: {
          end(data, callback) { seen.payload = data; release = callback; },
          on() {},
        },
        once() {},
        unref() { unrefed = true; },
      };
    }, "powershell.exe", ["-File", "desktop.ps1", "-Action", "onboard"], "{\"action\":\"onboard\"}");
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(unrefed).toBe(false);
    expect(seen).toMatchObject({ command: "powershell.exe", detached: true, payload: "{\"action\":\"onboard\"}" });
    expect(seen.args).toEqual(["-File", "desktop.ps1", "-Action", "onboard"]);
    release();
    await pending;
    expect(settled).toBe(true);
    expect(unrefed).toBe(true);
  });
});
