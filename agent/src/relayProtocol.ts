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
  /**
   * 控制通道才有：这台机器叫什么、白名单里有哪些目录、它自己定的上限。
   * 会合点原样记下，工作台据此登记「我的机器」并知道它在不在线。只用来显示和登记，不是授权依据：
   * 能动哪些目录始终由本机的过滤和外沙箱拦。
   */
  machine?: MachineInfo;
}

export interface MachineInfo {
  name: string;
  roots: string[];
  ceiling: { sandbox: string; network: boolean };
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
