import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { confirmedMcpUrls } from "../src/mcp.js";
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
const approvedUrl = "http://127.0.0.1:48291/mcp";
const allow = (frame: any, network = true, urls: readonly string[] = [approvedUrl]) => windowsDecision(frame, { sandbox: "read-only", network }, ["C:\\fixture"], "C:\\agent-home", undefined, urls);
it("requires the explicit local network ceiling for executor HTTP", () => {
  expect(allow(packet(), false).allow).toBe(false);
  expect(allow(packet()).allow).toBe(true);
  expect(allow(packet()).kind).toBe("http");
});
it("requires an explicit enabled locally confirmed URL, not merely the network switch",()=>{
  expect(allow(packet(),true,[]).allow).toBe(false);
  const servers={yes:{url:approvedUrl},disabled:{url:"http://127.0.0.1:48291/disabled",enabled:false}};
  const urls=confirmedMcpUrls(servers);expect(urls).toEqual([approvedUrl]);expect(Object.isFrozen(urls)).toBe(true);
  servers.yes.url="http://127.0.0.1:48291/changed";expect(urls).toEqual([approvedUrl]);
  const denied=packet();denied.params.url=servers.disabled.url;expect(allow(denied,true,urls).allow).toBe(false);
});
it.each([
  "http://127.0.0.1:48292/mcp", "http://localhost:48291/mcp", "https://127.0.0.1:48291/mcp",
  "http://127.0.0.2:48291/mcp", "http://127.0.0.1:48291/", "http://127.0.0.1:48291/mcp/",
  "http://127.0.0.1:48291/mcp/child", "http://127.0.0.1:48291/MCP", "http://127.0.0.1:48291/%6dcp",
  "http://127.0.0.1:48291/a/../mcp", "http://127.0.0.1:48291/mcp?other=1", "http://127.0.0.1:48291/mcp#part",
  "http://2130706433:48291/mcp", "http://127.0.0.1.evil.invalid:48291/mcp", "http://169.254.169.254/latest/meta-data/",
])("rejects a different authority, port or exact path: %s",url=>{const p=packet();p.params.url=url;expect(allow(p).allow).toBe(false)});
it.each(["follow", undefined, null])("rejects redirects and implicit defaults: %s",redirectPolicy=>{
  const p:any=packet();p.params.redirectPolicy=redirectPolicy;expect(allow(p).allow).toBe(false);
});
it.each(["Host","host","Proxy-Authorization","Proxy-Connection"])("rejects authority/proxy override header %s",name=>{
  const p=packet();p.params.headers=[{name,value:"elsewhere.invalid"}];expect(allow(p).allow).toBe(false);
});
it("bridge rejects unconfirmed HTTP without prompting or creating a forwarded frame",async()=>{
  const confirm=vi.fn(async()=>true), report=vi.fn(async()=>true);
  const bridge=new WindowsBridge({roots:["C:\\fixture"],home:"C:\\agent-home",mode:"unelevated",helper:{node:"node",script:"helper"},ceiling:{sandbox:"read-only",network:true},url:()=>"ws://127.0.0.1:1",localPermissions:{confirm,report,available:()=>true,epoch:()=>1}});
  const result=await bridge.receive(JSON.stringify(packet()),false);expect(result.forward).toBeUndefined();expect(result.reason).toContain("locally confirmed");expect(confirm).not.toHaveBeenCalled();expect(report).not.toHaveBeenCalled();await bridge.close();
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
  it.each([[false,200],[true,200],[false,302]] as const)("passes confirmed endpoint without redirects: streamed=%s status=%s", async (streamed,status) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sunmoon-http-fixture-"));
    let redirectedHits=0;
    const server = http.createServer((req, res) => { req.resume(); if(req.url!=="/mcp")redirectedHits++;res.writeHead(status, { "Content-Type": "application/json", ...(status===302?{Location:"/must-not-be-requested"}:{}) }); res.end('{"fixture":"HTTP_OK"}'); });
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
      bridge = new WindowsBridge({ roots: [home], home, mode: "unelevated", helper: locateWindowsHelper(), ceiling: { sandbox: "read-only", network: true }, url: () => url, confirmedHttpUrls: [`http://127.0.0.1:${address.port}/mcp`] });
      const frame = packet(); frame.params.url = `http://127.0.0.1:${address.port}/mcp`; frame.params.streamResponse = streamed;
      const checked = await bridge.receive(JSON.stringify(frame), false);
      expect(checked.reason).toBeUndefined(); expect(checked.forward).toBeTruthy();
      ws.send(checked.forward!);
      await until(() => frames.some(f => f.id === 2));
      const response = frames.find(f => f.id === 2);
      expect(response.error).toBeUndefined(); expect(response.result.status).toBe(status);expect(redirectedHits).toBe(0);
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
