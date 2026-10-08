import { createHash, randomUUID } from "node:crypto";
import type { Ceiling } from "./filter.js";
import type { PermissionReport } from "./relayProtocol.js";
import { windowsDecision } from "./windowsPolicy.js";

export const canonical = (v: any): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
export const digest = (v: unknown): string => createHash("sha256").update(canonical(v)).digest("hex");

export interface LocalPermissions {
  confirm: (description: string, signal: AbortSignal) => Promise<boolean>;
  report: (report: Omit<PermissionReport, "conn">) => Promise<boolean>;
  available: () => boolean;
  epoch: () => number;
}
export interface PermissionGrant { ceiling: Ceiling; valid: () => boolean }

/** Grants live only in this stream and thread. A more permissive request must
 * still pass every non-ceiling check, including Windows inner sandbox + roots.
 * Unscoped FS RPC, unknown fields, unsandboxed processes and new roots cannot
 * be approved through this path. They stay denied, never silently downgraded. */
export class SessionPermissions {
  private grants = new Map<string, { ceiling: Ceiling; expires: number; epoch: number }>();
  private aborter = new AbortController();
  constructor(private local: LocalPermissions) {}

  async allow(frame: any, base: Ceiling, roots: readonly string[], home: string, temporary?: string): Promise<PermissionGrant | null> {
    const p = frame?.params;
    if (this.aborter.signal.aborted || frame?.method !== "process/start" || !p?.metadata?.threadId || !this.local.available()) return null;
    const max: Ceiling = { sandbox: "workspace-write", network: true };
    const maximum = windowsDecision(frame, max, roots, home, temporary);
    if (!maximum.allow) {
      // An explicitly unsandboxed request is auditable, never approvable on
      // Windows. Malformed input or an unscoped request is not a report.
      if (p.sandbox === null && maximum.reason === "Windows inner sandbox is required; disabled/none exceeds local ceiling") {
        try { await this.local.report({ id: randomUUID(), threadId: p.metadata.threadId,
          requestDigest: digest(frame), permissionDigest: digest({ cwd: p.cwd, sandbox: null, roots }),
          decision: "denied", scope: { sandbox: "danger-full-access", network: true },
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        }); } catch { /* denial stands even if audit is unavailable */ }
      }
      return null;
    }
    const scope = { sandbox: (p.sandbox.permissions.file_system.entries.some((e: any) => e.access === "write") ? "workspace-write" : "read-only") as "workspace-write" | "read-only", network: p.sandbox.permissions.network === "enabled" };
    const permissionDigest = digest({ cwd: p.cwd, sandbox: p.sandbox, roots });
    const key = `${p.metadata.threadId}:${permissionDigest}`;
    const epoch = this.local.epoch();
    for (const [k, g] of this.grants) if (g.expires <= Date.now() || g.epoch !== epoch) this.grants.delete(k);
    const previous = this.grants.get(key);
    const grant = (ceiling: Ceiling, expires: number): PermissionGrant => ({ ceiling, valid: () => !this.aborter.signal.aborted && this.local.available() && epoch === this.local.epoch() && Date.now() < expires });
    if (previous) return grant(previous.ceiling, previous.expires);
    if (this.grants.size >= 64) return null;
    const requestDigest = digest(frame);
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    const description = `本机权限请求\n会话(thread)：${JSON.stringify(p.metadata.threadId)}\n程序：${JSON.stringify(p.argv[0])}\n目录：${JSON.stringify(p.cwd)}\n权限：${JSON.stringify(base)} → ${JSON.stringify(scope)}\n请求 SHA-256：${requestDigest}\n只允许本会话中相同目录/权限范围，30分钟或连接断开时失效；仍受 Windows 内层沙箱和目录白名单限制。`;
    let yes = false;
    try { yes = await this.local.confirm(description, this.aborter.signal); } catch { return null; }
    if (this.aborter.signal.aborted || epoch !== this.local.epoch() || !this.local.available()) return null;
    let recorded = false;
    try { recorded = await this.local.report({ id: randomUUID(), threadId: p.metadata.threadId, requestDigest, permissionDigest, decision: yes ? "approved" : "denied", scope, expiresAt }); }
    catch { return null; }
    if (!yes || !recorded || this.aborter.signal.aborted || epoch !== this.local.epoch() || expiresAt * 1000 <= Date.now()) return null;
    this.grants.set(key, { ceiling: scope, expires: expiresAt * 1000, epoch });
    return grant(scope, expiresAt * 1000);
  }

  close(): void { this.aborter.abort(); this.grants.clear(); }
}
