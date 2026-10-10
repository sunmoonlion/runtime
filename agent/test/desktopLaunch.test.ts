import { describe, expect, it } from "vitest";
import { deliverDesktop } from "../src/resident.js";

describe("openDesktop waits for stdin", () => {
  it("does not resolve until the injected spawn finishes writing stdin", async () => {
    let release = (): void => {};
    let ready: ((chunk: string) => void) | undefined;
    let unrefed = false;
    const seen: { command?: string; args?: string[]; payload?: string; stdout?: string } = {};
    const pending = deliverDesktop((command, args, options) => {
      seen.command = command; seen.args = args; seen.stdout = options.stdio[1]; seen.payload = undefined;
      return {
        stdin: {
          end(data, callback) { seen.payload = data; release = callback; },
          on() {},
        },
        stdout: { on(_event, listener) { ready = listener; } },
        once() {},
        unref() { unrefed = true; },
      };
    }, "powershell.exe", ["-File", "desktop.ps1", "-Action", "onboard"], "{\"action\":\"onboard\"}");
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(unrefed).toBe(false);
    expect(seen).toMatchObject({ command: "powershell.exe", stdout: "pipe", payload: "{\"action\":\"onboard\"}" });
    expect(seen.args).toEqual(["-File", "desktop.ps1", "-Action", "onboard"]);
    release();
    await Promise.resolve();
    expect(settled).toBe(false);
    ready?.('{"desktop":"ready"}\n');
    await pending;
    expect(settled).toBe(true);
    expect(unrefed).toBe(true);
  });

  it("accepts the ready line as UTF-16 and still waits for stdin", async () => {
    let release = (): void => {};
    let ready: ((chunk: Buffer) => void) | undefined;
    const pending = deliverDesktop(() => ({
      stdin: { end(_data, callback) { release = callback; }, on() {} },
      stdout: { on(_event, listener) { ready = listener; } },
      once() {},
      unref() {},
    }), "powershell.exe", ["-File", "desktop.ps1", "-Action", "tray"], "{}");
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    ready?.(Buffer.from('{"desktop":"ready"}\n', "utf16le"));
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await pending;
    expect(settled).toBe(true);
  });
});
