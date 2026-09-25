// 出站桥：一条控制 WS 到会合点；每收到 open 就开一条数据流到会合点、一条本地 WS 到 exec-server，两头对接。
// 沙箱→执行端方向的每个 JSON-RPC 请求过一遍协议过滤；越界的回错误、不转发。断线指数退避重连；exec-server 不动。
import WebSocket from "ws";
import { decide, denialResponse, type Ceiling } from "./filter.js";
import { log } from "./log.js";
import { hello, type ControlMessage } from "./relayProtocol.js";

export interface RelayClientOptions {
  relayUrl: string;
  userId: string;
  token: string;
  codexVersion: string;
  softwareVersion: string;
  localUrl: () => string; // exec-server 的当前地址（重启后端口可能变）
  ceiling: () => Ceiling;
  roots: () => readonly string[];
  /** 被会合点拒绝（令牌无效、被吊销、被同用户的新代理顶掉）时调用一次；之后不会再重连。 */
  onRejected?: (reason: string) => void;
}

export interface BridgeStats {
  connections: number;
  active: number;
  forwardedUp: number;
  forwardedDown: number;
  denied: number;
  lastDenial?: { method: string; reason: string; at: string };
}

export class RelayClient {
  private ctrl: WebSocket | null = null;
  private stopped = false;
  private backoff = 1000;
  readonly stats: BridgeStats = { connections: 0, active: 0, forwardedUp: 0, forwardedDown: 0, denied: 0 };
  status: "disconnected" | "connecting" | "connected" | "rejected" = "disconnected";
  lastError = "";

  constructor(private readonly opts: RelayClientOptions) {}

  start(): void {
    this.stopped = false;
    this.connectControl();
  }

  private rejectedNotified = false;

  private notifyRejected(): void {
    if (this.rejectedNotified) return;
    this.rejectedNotified = true;
    try { this.opts.onRejected?.(this.lastError); } catch (e) { log("error", "onRejected handler failed", { error: String(e) }); }
  }

  stop(): void {
    this.stopped = true;
    this.ctrl?.close();
    this.ctrl = null;
  }

  private controlUrl(): string {
    return this.opts.relayUrl.replace(/\/$/, "") + "/agent";
  }

  private dataUrl(conn: string): string {
    return this.opts.relayUrl.replace(/\/$/, "") + `/agent-data?conn=${encodeURIComponent(conn)}`;
  }

  private connectControl(): void {
    if (this.stopped) return;
    this.status = "connecting";
    const ws = new WebSocket(this.controlUrl(), { maxPayload: 0 });
    this.ctrl = ws;
    ws.on("open", () => {
      ws.send(hello({ role: "agent", user: this.opts.userId, token: this.opts.token, codex: this.opts.codexVersion, software: this.opts.softwareVersion }));
    });
    ws.on("message", (data) => {
      let msg: ControlMessage;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.type === "welcome") {
        this.status = "connected"; this.backoff = 1000; this.lastError = "";
        log("info", "relay connected", { relay: msg.relay });
      } else if (msg.type === "reject") {
        this.status = "rejected"; this.lastError = msg.reason;
        log("error", "relay rejected us — not retrying until config changes", { reason: msg.reason });
        this.stopped = true; ws.close();
        this.notifyRejected();
      } else if (msg.type === "open") {
        this.openStream(msg.conn);
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });
    const onDown = (why: string) => {
      if (this.ctrl !== ws) return;
      this.ctrl = null;
      if (this.status !== "rejected") this.status = "disconnected";
      if (this.stopped) return;
      log("warn", "relay control down, will retry", { why, inMs: this.backoff });
      setTimeout(() => this.connectControl(), this.backoff);
      this.backoff = Math.min(30000, this.backoff * 2);
    };
    ws.on("close", (code) => {
      // 4000 = 同一用户有更新的代理连上来，会合点把我们顶掉了；4003 = 令牌被吊销。
      // 这两种都不重连：重连只会把对方再顶掉，两个代理每秒互踢（KIND 09 实测）
      if ((code === 4000 || code === 4003) && this.ctrl === ws) {
        this.status = "rejected";
        this.lastError = code === 4000 ? "replaced by a newer agent for this user" : "token revoked";
        this.stopped = true;
        log("error", code === 4000
          ? "another agent for this user connected to the relay; this one stops (run only one agent per user)"
          : "relay revoked this agent's token; re-run init with a new token", { code });
        this.notifyRejected();
      }
      onDown(`close ${code}`);
    });
    ws.on("error", (e) => { this.lastError = String(e.message ?? e); onDown(`error ${this.lastError}`); });
  }

  private openStream(conn: string): void {
    this.stats.connections += 1; this.stats.active += 1;
    const up = new WebSocket(this.dataUrl(conn), { maxPayload: 0 });
    const local = new WebSocket(this.opts.localUrl(), { maxPayload: 0 });
    const queueUp: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];
    let localReady = false;
    const finish = (why: string) => {
      if (this.stats.active > 0) this.stats.active -= 1;
      log("info", "stream closed", { conn, why });
      try { up.close(); } catch {}
      try { local.close(); } catch {}
    };
    up.on("open", () => {
      up.send(hello({ role: "agent", user: this.opts.userId, token: this.opts.token, codex: this.opts.codexVersion, software: this.opts.softwareVersion, conn }));
    });
    local.on("open", () => {
      localReady = true;
      for (const q of queueUp) this.forwardUp(q.data, q.isBinary, up, local);
      queueUp.length = 0;
      log("info", "stream bridged", { conn, local: this.opts.localUrl() });
    });
    up.on("message", (data, isBinary) => {
      if (!localReady) { queueUp.push({ data, isBinary }); return; }
      this.forwardUp(data, isBinary, up, local);
    });
    local.on("message", (data, isBinary) => {
      this.stats.forwardedDown += 1;
      if (up.readyState === WebSocket.OPEN) up.send(data, { binary: isBinary });
    });
    up.on("close", (c) => finish(`relay side close ${c}`));
    up.on("error", (e) => finish(`relay side error ${e.message}`));
    local.on("close", (c) => finish(`exec-server side close ${c}`));
    local.on("error", (e) => finish(`exec-server side error ${e.message}`));
  }

  /** 沙箱 → 执行端：过滤后转发 */
  private forwardUp(data: WebSocket.RawData, isBinary: boolean, up: WebSocket, local: WebSocket): void {
    if (!isBinary) {
      const text = String(data);
      let frame: any = null;
      try { frame = JSON.parse(text); } catch { /* 不是 JSON 就原样转 */ }
      if (frame && typeof frame === "object") {
        const d = decide(frame, this.opts.ceiling(), this.opts.roots());
        if (!d.allow) {
          this.stats.denied += 1;
          this.stats.lastDenial = { method: frame.method, reason: d.reason ?? "", at: new Date().toISOString() };
          log("warn", "denied by local ceiling", { method: frame.method, reason: d.reason });
          if (up.readyState === WebSocket.OPEN) up.send(denialResponse(frame, d.reason ?? "denied"));
          return;
        }
      }
    }
    this.stats.forwardedUp += 1;
    if (local.readyState === WebSocket.OPEN) local.send(data, { binary: isBinary });
  }
}
