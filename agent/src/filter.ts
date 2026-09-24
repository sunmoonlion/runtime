// 本地上限的协议过滤层（security.md「本地上限」第二层）。
// 只看沙箱→执行端方向的 JSON-RPC 请求；越出上限的直接回错误、不转发。外沙箱（第一层）是兜底，这里负责干净的拒绝与可观测。
// 字段名来自 codex-rs exec-server-protocol 与 2026-09-24 抓到的真实帧（runtime/probe/frames.jsonl）。
import { isUnderAny, uriToPath } from "./pathuri.js";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface Ceiling {
  /** 允许编排端要求的最高沙箱模式 */
  sandbox: SandboxMode;
  /** 是否允许沙箱内进程联网、以及执行端代发 http/request */
  network: boolean;
}

export interface Decision {
  allow: boolean;
  /** 拒绝原因（给日志与错误响应） */
  reason?: string;
  /** 这条请求的语义分类，用于计数与日志 */
  kind: "process" | "fs-write" | "fs-read" | "http" | "other";
}

const MODE_RANK: Record<SandboxMode, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };

const FS_WRITE_METHODS = new Set(["fs/writeFile", "fs/createDirectory", "fs/remove", "fs/copy"]);
const FS_READ_METHODS = new Set(["fs/readFile", "fs/open", "fs/readBlock", "fs/close", "fs/getMetadata", "fs/canonicalize", "fs/readDirectory", "fs/walk"]);

/** 从 process/start 的 sandbox 字段推断编排端要求的模式 */
export function requestedMode(params: any): SandboxMode {
  const sb = params?.sandbox;
  if (sb == null) return "danger-full-access";
  const fsType = sb?.permissions?.file_system?.type;
  if (fsType === "unrestricted") return "danger-full-access";
  const entries: any[] = sb?.permissions?.file_system?.entries ?? [];
  const anyWrite = entries.some((e) => e?.access === "write");
  return anyWrite ? "workspace-write" : "read-only";
}

export function requestedNetwork(params: any): boolean {
  const sb = params?.sandbox;
  if (sb == null) return true;
  const net = sb?.permissions?.network;
  return net !== "restricted";
}

export function decide(frame: any, ceiling: Ceiling, roots: readonly string[]): Decision {
  const method: string | undefined = frame?.method;
  if (!method || !("id" in (frame ?? {}))) return { allow: true, kind: "other" }; // 通知与响应一律放行
  const p = frame.params ?? {};

  if (method === "process/start") {
    const mode = requestedMode(p);
    if (MODE_RANK[mode] > MODE_RANK[ceiling.sandbox]) {
      return { allow: false, kind: "process", reason: `sandbox mode ${mode} exceeds local ceiling ${ceiling.sandbox}` };
    }
    if (!ceiling.network && requestedNetwork(p)) {
      return { allow: false, kind: "process", reason: "network access exceeds local ceiling (network disabled)" };
    }
    const cwd = uriToPath(p.cwd ?? "");
    if (!cwd || !isUnderAny(cwd, roots)) {
      return { allow: false, kind: "process", reason: `cwd ${p.cwd} is outside the whitelisted roots` };
    }
    const wsRoots: string[] = p.sandbox?.workspaceRoots ?? [];
    for (const r of wsRoots) {
      const rp = uriToPath(r);
      if (!rp || !isUnderAny(rp, roots)) {
        return { allow: false, kind: "process", reason: `workspace root ${r} is outside the whitelisted roots` };
      }
    }
    if (p.sandbox?.cwd) {
      const scwd = uriToPath(p.sandbox.cwd);
      if (!scwd || !isUnderAny(scwd, roots)) {
        return { allow: false, kind: "process", reason: `sandbox cwd ${p.sandbox.cwd} is outside the whitelisted roots` };
      }
    }
    return { allow: true, kind: "process" };
  }

  if (FS_WRITE_METHODS.has(method)) {
    if (ceiling.sandbox === "read-only") {
      return { allow: false, kind: "fs-write", reason: `${method} exceeds local ceiling read-only` };
    }
    const targets = method === "fs/copy" ? [p.destination_path ?? p.destinationPath] : [p.path];
    for (const t of targets) {
      const tp = uriToPath(t ?? "");
      if (!tp || !isUnderAny(tp, roots)) {
        return { allow: false, kind: "fs-write", reason: `${method} target ${t} is outside the whitelisted roots` };
      }
    }
    return { allow: true, kind: "fs-write" };
  }

  if (FS_READ_METHODS.has(method)) {
    // 读放行：编排端要读 cwd 之上的 AGENTS.md、$CODEX_HOME 等；外沙箱同样允许全盘读
    return { allow: true, kind: "fs-read" };
  }

  if (method === "http/request") {
    if (!ceiling.network) return { allow: false, kind: "http", reason: "http/request exceeds local ceiling (network disabled)" };
    return { allow: true, kind: "http" };
  }

  return { allow: true, kind: "other" };
}

/** 拒绝时回给沙箱侧的 JSON-RPC 错误帧 */
export function denialResponse(frame: any, reason: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32001, message: `sunmoon-agent local ceiling: ${reason}`, data: { method: frame.method } } });
}
