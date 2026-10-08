// Confirmed HTTP MCP configuration only. Never copy auth.json, environment
// values, headers, model settings or skills into the remotely readable home.
import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "smol-toml";

export type HttpMcp = { url: string; enabled?: boolean; required?: boolean; startup_timeout_sec?: number; tool_timeout_sec?: number; enabled_tools?: string[]; disabled_tools?: string[] };
export type McpServers = Record<string, HttpMcp>;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const KEYS = ["url", "enabled", "required", "startup_timeout_sec", "tool_timeout_sec", "enabled_tools", "disabled_tools"];
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

function validateEntry(name: string, value: unknown): HttpMcp {
  if (!NAME.test(name) || !object(value) || Object.keys(value).some(k => !KEYS.includes(k)) || typeof value.url !== "string") throw new Error("unsupported MCP entry");
  const u = new URL(value.url);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.search || u.hash || value.url.length > 2048
      || /[\x00-\x20\\]/.test(value.url)) throw new Error("MCP URL must not contain credentials, query or fragment");
  for (const k of ["enabled", "required"]) if (value[k] !== undefined && typeof value[k] !== "boolean") throw new Error("invalid MCP flag");
  for (const k of ["startup_timeout_sec", "tool_timeout_sec"]) if (value[k] !== undefined && (typeof value[k] !== "number" || !Number.isFinite(value[k]) || value[k] < 1 || value[k] > 600)) throw new Error("invalid MCP timeout");
  for (const k of ["enabled_tools", "disabled_tools"]) if (value[k] !== undefined && (!Array.isArray(value[k]) || value[k].length > 128 || !value[k].every((v: unknown) => typeof v === "string" && /^[A-Za-z0-9_.:/-]{1,128}$/.test(v)))) throw new Error("invalid MCP tool list");
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) as HttpMcp;
}

export function importCandidates(text: string): { servers: McpServers; skipped: number } {
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("Codex config exceeds import limit");
  let raw: Record<string, any>;
  try { raw = parse(text); } catch { throw new Error("Codex config is not valid TOML; no configuration was imported"); }
  const servers: McpServers = Object.create(null);
  let skipped = 0;
  if (raw.mcp_servers === undefined) return { servers, skipped };
  if (!object(raw.mcp_servers) || Object.keys(raw.mcp_servers).length > 128) throw new Error("Invalid MCP server table");
  for (const [name, entry] of Object.entries(raw.mcp_servers)) {
    try { servers[name] = validateEntry(name, entry); } catch { skipped++; }
  }
  return { servers, skipped };
}

export function validateServers(raw: unknown): McpServers {
  if (!object(raw) || Object.keys(raw).length > 128) throw new Error("invalid saved MCP configuration");
  const result: McpServers = Object.create(null);
  for (const name of Object.keys(raw).sort()) result[name] = validateEntry(name, raw[name]);
  return result;
}

export function loadMcp(file: string): McpServers {
  if (!fs.existsSync(file)) return {};
  try {
    const s = fs.lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 1024 * 1024) throw new Error();
    return validateServers(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch { throw new Error("Saved MCP configuration is invalid; review it locally before starting"); }
}

export function saveMcp(file: string, servers: McpServers): void {
  const checked = validateServers(servers);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(checked, null, 2) + "\n", { mode: 0o600, flag: "wx" }); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}

export function mcpToml(servers: McpServers): string {
  const checked = validateServers(servers);
  return Object.keys(checked).length ? stringify({ mcp_servers: checked }) : "";
}

// Exact strings, not host prefixes, origin-wide or path-prefix grants. Input is
// the locally confirmed file read once at startup, never a remote RPC field.
export function confirmedMcpUrls(servers: McpServers): readonly string[] {
  return Object.freeze([...new Set(Object.values(validateServers(servers))
    .filter(server => server.enabled !== false).map(server => server.url))]);
}

export function ownedConfig(mode: "unelevated" | "elevated", servers: McpServers = {}): string {
  return `sandbox_mode = "read-only"\napproval_policy = "never"\n[windows]\nsandbox = "${mode}"\n` + mcpToml(servers);
}

export function ownedMcp(text: string): McpServers {
  let raw: Record<string, any>;
  try { raw = parse(text); } catch { throw new Error("invalid owned config"); }
  if (Object.keys(raw).some(k => !["sandbox_mode", "approval_policy", "windows", "mcp_servers"].includes(k))
    || raw.sandbox_mode !== "read-only" || raw.approval_policy !== "never"
    || !object(raw.windows) || Object.keys(raw.windows).length !== 1 || !["unelevated", "elevated"].includes(raw.windows.sandbox)) throw new Error("invalid owned config");
  return validateServers(raw.mcp_servers ?? {});
}
