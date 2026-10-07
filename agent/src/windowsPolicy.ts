// Pinned exec-server 0.155.1 request boundary. Linux keeps its existing policy.
import path from "node:path";
import { isUnder, isUnderAny, uriToPath } from "./pathuri.js";
import type { Ceiling, Decision } from "./filter.js";

const object = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
const only = (v: any, keys: string[]) => object(v) && Object.keys(v).every(k => keys.includes(k));
const string = (v: any) => typeof v === "string" && v.length > 0;
const uuid = (v: any) => typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export const isReservedWindowsEnv = (key: string): boolean => /^(?:CODEX|SUNMOON|RUST|LD_)|^NODE_(?:OPTIONS|PATH)$/i.test(key);
// Fixed-client annotations are validated here, then discarded before launch.
// They never become remote overrides of the executor's environment.
export function isClientWindowsEnvAnnotation(p: any, key: string): boolean {
  const value = p.env?.[key];
  if (key === "CODEX_VERSION") return value === "0.155.1";
  if (key === "CODEX_CI") return value === "1";
  if (key === "CODEX_SANDBOX_NETWORK_DISABLED") return value === "1" && p.sandbox?.permissions?.network === "restricted";
  if (["CODEX_THREAD_ID", "CODEX_SESSION_ID"].includes(key)) return uuid(p.metadata?.threadId) && value === p.metadata.threadId;
  return false;
}
const METHODS: Record<string, string[]> = {
  initialize: ["clientName", "resumeSessionId"], initialized: [],
  "environment/info": [], "environment/status": [],
  "process/start": ["processId", "metadata", "argv", "cwd", "env", "tty", "pipeStdin", "arg0", "sandbox", "enforceManagedNetwork", "managedNetwork", "envPolicy", "shellSnapshot", "networkProxy"],
  "process/read": ["processId", "afterSeq", "maxBytes", "waitMs"],
  "process/write": ["processId", "chunk", "writeId"],
  "process/signal": ["processId", "signal"], "process/terminate": ["processId"],
  "fs/readFile": ["path", "followSymlinks", "sandbox"],
  "fs/writeFile": ["path", "dataBase64", "followSymlinks", "sandbox"],
  "fs/createDirectory": ["path", "recursive", "followSymlinks", "sandbox"],
  "fs/remove": ["path", "recursive", "force", "followSymlinks", "sandbox"],
  "fs/copy": ["sourcePath", "destinationPath", "recursive", "sandbox"],
  "fs/getMetadata": ["path", "followSymlinks", "sandbox"],
  "fs/canonicalize": ["path", "sandbox"], "fs/readDirectory": ["path", "sandbox"],
  "fs/walk": ["path", "options", "sandbox"],
  "fs/open": ["path", "handleId", "sandbox"],
  "fs/readBlock": ["handleId", "offset", "len"], "fs/close": ["handleId"],
};
export const FS_WRITES = new Set(["fs/writeFile", "fs/createDirectory", "fs/remove", "fs/copy"]);

export function windowsDecision(frame: any, ceiling: Ceiling, roots: readonly string[], codexHome?: string): Decision {
  const method = typeof frame?.method === "string" ? frame.method : "";
  const kind: Decision["kind"] = method.startsWith("process/") ? "process" : FS_WRITES.has(method) ? "fs-write" : method.startsWith("fs/") ? "fs-read" : "other";
  const no = (reason: string): Decision => ({ allow: false, kind, reason });
  const ok: Decision = { allow: true, kind };
  if (!only(frame, ["id", "method", "params", "jsonrpc"]) || (frame.jsonrpc !== undefined && frame.jsonrpc !== "2.0")) return no("invalid RPC envelope");
  if (!Object.hasOwn(METHODS, method)) return no("method is not in the Windows allowlist");
  if (method === "initialized") {
    if ("id" in frame || !only(frame.params ?? {}, [])) return no("invalid initialized notification");
    return ok;
  }
  if (!(typeof frame.id === "string" || Number.isSafeInteger(frame.id))) return no("request id required; notification not allowed");
  // Parameterless methods are serialized with params:null by the real client.
  const p = frame.params == null && METHODS[method].length === 0 ? {} : frame.params;
  if (!only(p, METHODS[method])) return no("unknown or invalid request fields");
  const within = (uri: any, read = false): boolean => {
    const target = uriToPath(uri, "win32");
    return target !== null && !(codexHome && [".sandbox-secrets", "auth.json"].some(p => isUnder(target, path.win32.join(codexHome, p), "win32"))) && isUnderAny(target, read && codexHome ? [...roots, codexHome] : roots, "win32");
  };
  if (method === "initialize") {
    if (!string(p.clientName)) return no("clientName required");
    // 0.155.1 sends explicit null on a new connection; resumed IDs are UUIDs.
    if (p.resumeSessionId != null && !uuid(p.resumeSessionId)) return no("invalid resumeSessionId");
    return ok;
  }
  if (method === "process/start") {
    if (!string(p.processId) || !Array.isArray(p.argv) || !p.argv.length || !p.argv.every(string) || !object(p.env) || !Object.values(p.env).every(v => typeof v === "string") || typeof p.tty !== "boolean") return no("invalid process fields");
    if (p.metadata != null && (!only(p.metadata, ["threadId", "toolCallId"]) || !uuid(p.metadata.threadId) || !string(p.metadata.toolCallId) || p.metadata.toolCallId.length > 256)) return no("invalid process metadata");
    if (p.pipeStdin != null && typeof p.pipeStdin !== "boolean") return no("invalid pipeStdin");
    if (p.enforceManagedNetwork != null && typeof p.enforceManagedNetwork !== "boolean") return no("invalid enforceManagedNetwork");
    if (p.arg0 != null || p.shellSnapshot != null || p.networkProxy != null || p.managedNetwork != null || p.enforceManagedNetwork === true) return no("unsupported process launch overrides");
    if (p.envPolicy != null) {
      const e = p.envPolicy;
      // Only the captured inherited-user policy: requested exclusions are all
      // reserved keys that our local environment builder already removes.
      if (!only(e, ["inherit", "ignoreDefaultExcludes", "exclude", "set", "includeOnly"]) || e.inherit !== "all" || e.ignoreDefaultExcludes !== true || !Array.isArray(e.exclude) || !e.exclude.every((k: any) => string(k) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && isReservedWindowsEnv(k)) || !only(e.set, []) || !Array.isArray(e.includeOnly) || e.includeOnly.length) return no("unsupported environment policy");
    }
    const sb = p.sandbox;
    if (!only(sb, ["permissions", "cwd", "workspaceRoots", "windowsSandboxLevel", "windowsSandboxPrivateDesktop", "windowsSandboxProxySettingsMode", "useLegacyLandlock"]) || !["restricted-token", "elevated"].includes(sb.windowsSandboxLevel)) return no("Windows inner sandbox is required; disabled/none exceeds local ceiling");
    if ((sb.windowsSandboxPrivateDesktop != null && sb.windowsSandboxPrivateDesktop !== true) || (sb.windowsSandboxProxySettingsMode != null && sb.windowsSandboxProxySettingsMode !== "reconcile") || (sb.useLegacyLandlock != null && sb.useLegacyLandlock !== false)) return no("unsupported sandbox launch options");
    if (!within(p.cwd) || !within(sb.cwd) || !Array.isArray(sb.workspaceRoots) || !sb.workspaceRoots.every((r: any) => within(r))) return no("cwd or workspace roots outside the whitelisted roots");
    const perm = sb.permissions;
    if (!only(perm, ["type", "file_system", "network"]) || perm.type !== "managed" || !["restricted", "enabled"].includes(perm.network)) return no("managed permissions required");
    if (!ceiling.network && perm.network !== "restricted") return no("network exceeds local ceiling");
    const f = perm.file_system;
    if (!only(f, ["type", "entries"]) || f.type !== "restricted" || !Array.isArray(f.entries) || !f.entries.length) return no("restricted filesystem entries required");
    for (const entry of f.entries) {
      if (!only(entry, ["path", "access", "missing_path_behavior"]) || !["read", "write", "deny"].includes(entry.access) || !only(entry.path, ["type", "value", "path"])) return no("unknown filesystem permission");
      if (entry.missing_path_behavior != null && (entry.missing_path_behavior !== "skip" || entry.access !== "read")) return no("unsupported missing path behaviour");
      const ep = entry.path;
      let targets: string[];
      if (ep.type === "path" && typeof ep.path === "string" && uriToPath(ep.path, "win32") !== null) targets = [uriToPath(ep.path, "win32")!];
      else if (ep.type === "special" && only(ep.value, ["kind", "subpath"])) {
        const { kind: special, subpath } = ep.value;
        if (["root", "minimal"].includes(special) && subpath == null && entry.access === "read") continue; // OS command runtime reads, not fs RPC reads.
        if (special !== "project_roots") return no("unsupported special filesystem permission");
        // Captured workspace-write protects these children as read-only.
        // No arbitrary subpath or writable descendant alias is accepted.
        if (subpath != null && (entry.access !== "read" || ![".git", ".agents", ".codex"].includes(subpath))) return no("unsupported project subpath permission");
        targets = [sb.cwd, ...sb.workspaceRoots].map((r: string) => uriToPath(r, "win32")!);
        if (subpath != null) targets = targets.map(t => path.win32.join(t, subpath));
      } else return no("unsupported filesystem permission path");
      if (!targets.every(t => isUnderAny(t, entry.access === "read" && codexHome ? [...roots, codexHome] : roots, "win32"))) return no("filesystem permission outside the whitelisted roots");
      if (entry.access === "write" && ceiling.sandbox === "read-only") return no("write permission exceeds local ceiling read-only");
    }
    // Caller env never selects the executor home or sandbox launcher behaviour.
    if (Object.keys(p.env).some(k => isReservedWindowsEnv(k) && !isClientWindowsEnvAnnotation(p, k) && !(k === "CODEX_HOME" && codexHome && p.env[k] === codexHome))) return no("reserved executor environment override");
    return ok;
  }
  if (method.startsWith("process/")) return string(p.processId) ? ok : no("processId required");
  if (!method.startsWith("fs/")) return ok;
  if (FS_WRITES.has(method) && ceiling.sandbox === "read-only") return no("filesystem write exceeds local ceiling read-only");
  if (["fs/readBlock", "fs/close"].includes(method)) return string(p.handleId) ? ok : no("handleId required"); // Ownership enforced by per-stream worker.
  if (method === "fs/copy") {
    if (!within(p.sourcePath, true) || !within(p.destinationPath)) return no("copy source or destination outside the whitelisted roots");
  } else if (!within(p.path, !FS_WRITES.has(method))) return no("filesystem path outside the whitelisted roots");
  // A remote FS sandbox may narrow access; don't silently throw its policy away.
  if (p.sandbox != null) return no("explicit filesystem sandbox not yet supported by Windows helper");
  return ok;
}
