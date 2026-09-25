// 端到端（进程内）：假会合点 + 假 exec-server + 真 RelayClient。验配对、透传、过滤拒绝、重连。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { RelayClient } from "../src/relayClient.js";

type Waiter<T> = { promise: Promise<T>; resolve: (v: T) => void };
function waiter<T>(): Waiter<T> { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeRelay {
  wss: WebSocketServer; port = 0; agentCtrl: WebSocket | null = null; pending = new Map<string, Waiter<WebSocket>>();
  hellos: any[] = [];
  ready: Promise<void>;
  constructor(public rejectReason?: string) { this.wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }); this.ready = new Promise<void>((r) => this.wss.once("listening", r)); }
  async start() {
    await this.ready;
    this.port = (this.wss.address() as any).port;
    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", "http://x");
      ws.once("message", (data) => {
        const h = JSON.parse(String(data)); this.hellos.push({ path: url.pathname, ...h });
        if (url.pathname === "/agent") {
          if (this.rejectReason) { ws.send(JSON.stringify({ type: "reject", reason: this.rejectReason })); ws.close(); return; }
          this.agentCtrl = ws; ws.send(JSON.stringify({ type: "welcome", relay: "fake", proto: 1 }));
        } else if (url.pathname === "/agent-data") {
          this.pending.get(url.searchParams.get("conn")!)?.resolve(ws);
        }
      });
    });
  }
  /** 模拟一个沙箱连上来：返回一对（沙箱侧 ws，可以直接收发 JSON-RPC） */
  async connectSandbox(): Promise<WebSocket> {
    const conn = Math.random().toString(16).slice(2, 10); const w = waiter<WebSocket>(); this.pending.set(conn, w);
    this.agentCtrl!.send(JSON.stringify({ type: "open", conn }));
    // 会合点是逐消息透传：测试里直接把代理的数据流 ws 当作“沙箱侧”对端使用，语义等价
    return await w.promise;
  }
  async close() { for (const c of this.wss.clients) c.terminate(); await new Promise<void>((r) => this.wss.close(() => r())); }
}

class FakeExecServer {
  wss: WebSocketServer; port = 0; received: any[] = [];
  ready: Promise<void>;
  constructor() { this.wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }); this.ready = new Promise<void>((r) => this.wss.once("listening", r)); }
  async start() {
    await this.ready;
    this.port = (this.wss.address() as any).port;
    this.wss.on("connection", (ws) => {
      ws.on("message", (data: RawData) => {
        const f = JSON.parse(String(data)); this.received.push(f);
        if ("id" in f) ws.send(JSON.stringify({ id: f.id, result: { echoed: f.method } }));
      });
    });
  }
  async close() { for (const c of this.wss.clients) c.terminate(); await new Promise<void>((r) => this.wss.close(() => r())); }
}

async function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(String(d)))));
}

describe("RelayClient", () => {
  let relay: FakeRelay; let es: FakeExecServer; let client: RelayClient;
  const ROOT = "/home/u/proj";
  beforeEach(async () => { relay = new FakeRelay(); es = new FakeExecServer(); await relay.start(); await es.start(); });
  afterEach(async () => { client?.stop(); await relay.close(); await es.close(); });

  function makeClient(over: Partial<ConstructorParameters<typeof RelayClient>[0]> = {}) {
    client = new RelayClient({ relayUrl: `ws://127.0.0.1:${relay.port}`, userId: "u1", token: "t1", codexVersion: "0.155.1", softwareVersion: "test", localUrl: () => `ws://127.0.0.1:${es.port}`, ceiling: () => ({ sandbox: "workspace-write", network: false }), roots: () => [ROOT], ...over });
    client.start();
    return client;
  }

  it("sends hello on the control channel and becomes connected", async () => {
    makeClient();
    for (let i = 0; i < 50 && client.status !== "connected"; i++) await sleep(20);
    expect(client.status).toBe("connected");
    expect(relay.hellos[0]).toMatchObject({ path: "/agent", type: "hello", role: "agent", user: "u1", token: "t1", codex: "0.155.1", proto: 1 });
  });

  it("opens a data stream on 'open', forwards allowed requests to exec-server and responses back", async () => {
    makeClient();
    for (let i = 0; i < 50 && client.status !== "connected"; i++) await sleep(20);
    const sb = await relay.connectSandbox();
    const dataHello = relay.hellos.find((h) => h.path === "/agent-data");
    expect(dataHello?.conn).toBeTruthy();
    await sleep(50);
    const req = { id: 7, method: "fs/readFile", params: { path: `file://${ROOT}/a.txt`, sandbox: null } };
    const resp = nextMessage(sb); sb.send(JSON.stringify(req));
    expect(await resp).toEqual({ id: 7, result: { echoed: "fs/readFile" } });
    expect(es.received).toContainEqual(req);
    expect(client.stats.forwardedUp).toBe(1);
  });

  it("denies a danger-full-access process/start locally without forwarding", async () => {
    makeClient();
    for (let i = 0; i < 50 && client.status !== "connected"; i++) await sleep(20);
    const sb = await relay.connectSandbox(); await sleep(50);
    const req = { id: 9, method: "process/start", params: { processId: "1", argv: ["sh"], cwd: `file://${ROOT}`, sandbox: null } };
    const resp = nextMessage(sb); sb.send(JSON.stringify(req));
    const r = await resp;
    expect(r.id).toBe(9); expect(r.error.code).toBe(-32001); expect(r.error.message).toMatch(/exceeds local ceiling/);
    expect(es.received.find((f) => f.method === "process/start")).toBeUndefined();
    expect(client.stats.denied).toBe(1);
    expect(client.stats.lastDenial?.method).toBe("process/start");
  });

  it("stops retrying after a reject", async () => {
    await relay.close(); relay = new FakeRelay("bad token"); await relay.start();
    makeClient();
    for (let i = 0; i < 50 && client.status !== "rejected"; i++) await sleep(20);
    expect(client.status).toBe("rejected"); expect(client.lastError).toBe("bad token");
  });

  for (const [code, reason] of [[4000, "replaced by a newer agent for this user"], [4003, "token revoked"]] as const) {
    it(`does not reconnect after close ${code} (${reason})`, async () => {
      makeClient();
      for (let i = 0; i < 50 && client.status !== "connected"; i++) await sleep(20);
      relay.agentCtrl!.close(code, "x");
      for (let i = 0; i < 50 && client.status !== "rejected"; i++) await sleep(20);
      expect(client.status).toBe("rejected"); expect(client.lastError).toBe(reason);
      await sleep(1500);
      expect(relay.hellos.filter((h) => h.path === "/agent").length).toBe(1);
    });
  }

  it("reconnects the control channel after the relay drops it", async () => {
    makeClient();
    for (let i = 0; i < 50 && client.status !== "connected"; i++) await sleep(20);
    relay.agentCtrl!.terminate();
    for (let i = 0; i < 20 && client.status === "connected"; i++) await sleep(20);
    expect(client.status).not.toBe("connected");
    for (let i = 0; i < 150 && client.status !== "connected"; i++) await sleep(20);
    expect(client.status).toBe("connected");
    expect(relay.hellos.filter((h) => h.path === "/agent").length).toBe(2);
  });
});
