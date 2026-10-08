import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { describe, expect, it } from "vitest";
import { readHiddenToken } from "../src/hiddenToken.js";

function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false,
    setRawMode(value: boolean) { this.isRaw = value; return this; } });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  let rendered = ""; output.on("data", chunk => { rendered += chunk.toString(); });
  const read = (ms?: number) => readHiddenToken(input as unknown as ReadStream, output as unknown as WriteStream, ms);
  return { input, output, read, rendered: () => rendered };
}
describe("hidden local credential input", () => {
  it("accepts split paste without echo and restores terminal and listeners", async () => {
    const t = terminal(), p = t.read();
    expect(t.input.isRaw).toBe(true);
    t.input.write("fixture-token-"); t.input.write("0123456789\r\n");
    expect(await p).toBe("fixture-token-0123456789");
    expect(t.rendered()).not.toContain("fixture-token");
    expect(t.input.isRaw).toBe(false); expect(t.input.listenerCount("data")).toBe(0);
    expect(t.input.isPaused()).toBe(true);
  });
  it("supports correction without exposing text", async () => {
    const t = terminal(), p = t.read();
    t.input.write("fixture-token-x\b0123456789\r");
    expect(await p).toBe("fixture-token-0123456789");
    expect(t.rendered()).not.toContain("fixture-token");
  });
  for (const data of ["\r", "secret value\r", "x".repeat(8193), "fixture-token-0123456789\u0003", "fixture-token-0123456789\rmore", "\u001b[A"]) {
    it(`rejects unsafe/cancelled input of length ${data.length}`, async () => {
      const t = terminal(), p = t.read(); const rejection = expect(p).rejects.toThrow();
      t.input.write(data); await rejection;
      expect(t.rendered()).not.toContain("fixture-token"); expect(t.input.isRaw).toBe(false);
    });
  }
  it("refuses pipes before reading any credential", async () => {
    const t = terminal(); t.input.isTTY = false;
    await expect(t.read()).rejects.toThrow("交互终端"); expect(t.rendered()).toBe("");
  });
  it("restores raw mode on timeout and closed terminal", async () => {
    const t = terminal(), p = t.read(10);
    await expect(p).rejects.toThrow("超时"); expect(t.input.isRaw).toBe(false);
    const u = terminal(), closed = u.read(); const rejection = expect(closed).rejects.toThrow("关闭");
    u.input.end(); await rejection; expect(u.input.isRaw).toBe(false);
  });
});
