import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { windowsDecision } from "../src/windowsPolicy.js";
import { WindowsBridge } from "../src/windowsBridge.js";
import { locateCodex } from "../src/paths.js";
import { freeLoopbackPort, waitForPort } from "../src/execServer.js";
import { killWindowsTree, locateWindowsHelper, windowsEnvironment } from "../src/windowsRuntime.js";

// Fields captured from real 0.155.1 cloud app-server's imported MCP request.
const packet = () => ({ id: 2, method: "http/request", params: {
  method: "POST", url: "http://127.0.0.1:48291/mcp", headers: [{ name: "content-type", value: "application/json" }],
  bodyBase64: Buffer.from('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}').toString("base64"),
  timeoutMs: 5000, redirectPolicy: "stop", requestId: "fixture-1", streamResponse: true,
} });
const allow = (frame: any, network = true) => windowsDecision(frame, { sandbox: "read-only", network }, ["C:\\fixture"], "C:\\agent-home");
it("requires the explicit local network ceiling for executor HTTP", () => {
  expect(allow(packet(), false).allow).toBe(false);
  expect(allow(packet()).allow).toBe(true);
  expect(allow(packet()).kind).toBe("http");
});
it.each([
  { method: "CONNECT" }, { url: "file:///C:/secret" }, { url: "http://name:secret@host/" },
  { url: "https://host/\r\nx" }, { url: "https://host/#fragment" }, { url: "https://host\\evil/" },
  { headers: [{ name: "Authorization", value: "Bearer ", valueEnvVar: "PRIVATE_TOKEN" }] },
  { headers: [{ name: "X-Test", value: "a\r\nb" }] }, { headers: [{ name: "bad name", value: "a" }] },
  { bodyBase64: "%%%" }, { timeoutMs: -1 }, { timeoutMs: 0.5 }, { timeoutMs: 600001 },
  { redirectPolicy: "trust-all" }, { requestId: "bad\n" }, { streamResponse: "yes" }, { proxy: "http://elsewhere" },
])("rejects invalid or authority-expanding HTTP fields: %j", extra => {
  const frame = packet(); Object.assign(frame.params, extra);
  expect(allow(frame).allow).toBe(false);
});

describe.skipIf(process.platform !== "win32")("native pinned executor HTTP (isolated loopback, no relay)", () => {
  it.each([false, true])("passes actual buffered/streamed response frames, streamed=%s", async streamed => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sunmoon-http-fixture-"));
    const server = http.createServer((req, res) => { req.resume(); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"fixture":"HTTP_OK"}'); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const port = await freeLoopbackPort(), url = `ws://127.0.0.1:${port}`;
    const child = spawn(locateCodex().codexBin, ["exec-server", "--listen", url], { cwd: home, env: windowsEnvironment(home), stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    let ws: WebSocket | undefined, bridge: WindowsBridge | undefined;
    try {
      expect(locateCodex().version).toBe("0.155.1");
      expect(await waitForPort(port, 10000, () => child.exitCode === null)).toBe(true);
      ws = new WebSocket(url);
      const frames: any[] = []; ws.on("message", raw => frames.push(JSON.parse(String(raw))));
      await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
      ws.send(JSON.stringify({ id: 1, method: "initialize", params: { clientName: "http-fixture" } }));
      const until = async (predicate: () => boolean) => { const end = Date.now() + 10000; while (!predicate() && Date.now() < end) await new Promise(r => setTimeout(r, 20)); expect(predicate(), JSON.stringify(frames)).toBe(true); };
      await until(() => frames.some(f => f.id === 1));
      ws.send(JSON.stringify({ method: "initialized" }));
      bridge = new WindowsBridge({ roots: [home], home, mode: "unelevated", helper: locateWindowsHelper(), ceiling: { sandbox: "read-only", network: true }, url: () => url });
      const frame = packet(); frame.params.url = `http://127.0.0.1:${address.port}/mcp`; frame.params.streamResponse = streamed;
      const checked = await bridge.receive(JSON.stringify(frame), false);
      expect(checked.reason).toBeUndefined(); expect(checked.forward).toBeTruthy();
      ws.send(checked.forward!);
      await until(() => frames.some(f => f.id === 2));
      const response = frames.find(f => f.id === 2);
      expect(response.error).toBeUndefined(); expect(response.result.status).toBe(200);
      if (streamed) {
        await until(() => frames.some(f => f.method === "http/request/bodyDelta" && f.params.done));
        const chunks = frames.filter(f => f.method === "http/request/bodyDelta");
        expect(chunks.every(f => f.params.requestId === "fixture-1")).toBe(true);
        expect(Buffer.concat(chunks.map(f => Buffer.from(f.params.deltaBase64, "base64"))).toString()).toBe('{"fixture":"HTTP_OK"}');
      } else expect(Buffer.from(response.result.bodyBase64, "base64").toString()).toBe('{"fixture":"HTTP_OK"}');
    } finally {
      ws?.terminate(); await bridge?.close(); await killWindowsTree(child);
      server.closeAllConnections(); server.close(); fs.rmSync(home, { recursive: true, force: true });
    }
  }, 30000);
});
