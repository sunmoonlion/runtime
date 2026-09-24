// 会合点协议 v1（0004-relay）。代理与沙箱都只出站；会合点按 user 配对，逐消息透传。
// 控制通道：代理 → 会合点 `/agent`；会合点用 {"type":"open","conn":ID} 通知代理开一条数据流。
// 数据流：代理 → 会合点 `/agent-data?conn=ID`；沙箱 → 会合点 `/sandbox`。两端第一帧都是 hello。
export const RELAY_PROTOCOL = 1;

export interface Hello {
  type: "hello";
  role: "agent" | "sandbox" | "site";
  proto: number;
  user: string;
  token: string;
  /** 这一端的 Codex 版本（成对检查：不一致会合点拒绝配对） */
  codex: string;
  /** 软件版本（代理版 / 沙箱镜像版） */
  software: string;
  /** 数据流才有 */
  conn?: string;
}

export type ControlMessage =
  | { type: "welcome"; relay: string; proto: number }
  | { type: "reject"; reason: string }
  | { type: "open"; conn: string }
  | { type: "ping" }
  | { type: "pong" };

export function hello(h: Omit<Hello, "type" | "proto">): string {
  return JSON.stringify({ type: "hello", proto: RELAY_PROTOCOL, ...h });
}
