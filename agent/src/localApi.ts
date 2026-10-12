import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AgentConfig } from "./config.js";
import { TicketVerifier, TicketError } from "./ticket.js";
import { LocalFiles, LocalError, LOCAL_MAX_READ } from "./localFiles.js";

export interface LocalApiOptions {
  webOrigin: string;
  version: string;
  machineName: string;
  connected: () => boolean;
  config?: () => AgentConfig;
  files?: LocalFiles;
  ticket?: TicketVerifier;
  onEvent?: (event: "listening" | "rate_limited" | "unavailable", details: { count?: number; port?: number; code?: string }) => void;
  onRequest?: (category: "info" | "dir" | "meta" | "file" | "other", code?: string) => void;
  /** Test seam. The shipped CLI always uses 47811 then 47812. */
  ports?: readonly number[];
}
export interface LocalApiHandle { port: number; close: () => Promise<void> }
function exactWebOrigin(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && !url.username && !url.password; }
  catch { return false; }
}
const routes = ["/local/v1/info", "/local/v1/fs/dir", "/local/v1/fs/meta", "/local/v1/fs/file"];
const headers = (origin: string) => ({ "Access-Control-Allow-Origin": origin, Vary: "Origin", "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });

function createHandler(options: LocalApiOptions) {
  let second = -1, count = 0, rateLogWritten = false;
  const tickets = options.ticket ?? (options.config ? new TicketVerifier({ webOrigin: options.webOrigin, userId: () => options.config!().userId }) : undefined);
  const respond = (res: ServerResponse, status: number, responseHeaders: Record<string, string>, body: string | Buffer = "") => { res.writeHead(status, responseHeaders); res.end(body); };
  return async (req: IncomingMessage, res: ServerResponse) => {
    req.resume(); // Stage 1 has no request bodies or write methods.
    const origin = req.headers.origin;
    if (typeof origin !== "string" || origin !== options.webOrigin) {
      respond(res, 403, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ code: "origin_rejected", message: "origin_rejected" })); return;
    }
    const responseHeaders = headers(origin);
    const error = (status: number, code: string) => respond(res, status, responseHeaders, JSON.stringify({ code, message: code }));
    const now = Math.floor(Date.now() / 1000);
    if (now !== second) { second = now; count = 0; rateLogWritten = false; }
    if (++count > 20) {
      if (!rateLogWritten) { options.onEvent?.("rate_limited", { count }); rateLogWritten = true; }
      error(429, "rate_limited"); return;
    }
    let url: URL;
    try { url = new URL(req.url ?? "", "http://127.0.0.1"); } catch { error(400, "invalid_params"); return; }
    const presence = req.url === "/presence";
    const isLocal = url.pathname.startsWith("/local/v1/") && !!options.config;
    const category = url.pathname === "/local/v1/info" ? "info" : url.pathname.endsWith("/dir") ? "dir" : url.pathname.endsWith("/meta") ? "meta" : url.pathname.endsWith("/file") ? "file" : "other";
    if (!presence && !isLocal) { error(404, "not_found"); return; }
    if (req.method === "OPTIONS") {
      if (!presence && !routes.includes(url.pathname)) { error(404, "not_found"); return; }
      if (req.headers["access-control-request-method"] && !["GET", "POST", "PUT"].includes(String(req.headers["access-control-request-method"]))) { error(405, "method_not_allowed"); return; }
      respond(res, 204, { ...responseHeaders, "Access-Control-Allow-Methods": "GET, POST, PUT", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Private-Network": "true" }); return;
    }
    if (presence) {
      if (req.method !== "GET") { respond(res, 405, { ...responseHeaders, Allow: "GET, OPTIONS" }, JSON.stringify({ code: "method_not_allowed", message: "method_not_allowed" })); return; }
      respond(res, 200, responseHeaders, JSON.stringify({ agent: "sunmoon-agent", version: options.version, machine_name: options.machineName, connected: options.connected() })); return;
    }
    try {
      await tickets!.check(req.headers.authorization);
      if (res.destroyed) return;
      if (!routes.includes(url.pathname)) throw new LocalError(404, "not_found");
      if (req.method !== "GET") throw new LocalError(405, "method_not_allowed");
      if (category === "info") {
        if (url.search) throw new LocalError(400, "invalid_params");
        const cfg = options.config!();
        respond(res, 200, responseHeaders, JSON.stringify({ agent: "sunmoon-agent", version: options.version, userId: cfg.userId, roots: cfg.roots, libraryDir: null, capabilities: ["local-fs-v1"] }));
      } else {
        const keys = [...url.searchParams.keys()];
        if (keys.some(key => !(category === "file" ? ["path", "offset", "length"] : ["path"]).includes(key)) || new Set(keys).size !== keys.length || !url.searchParams.get("path")) throw new LocalError(400, "invalid_params");
        const target = url.searchParams.get("path")!;
        const number = (key: string, fallback: number) => { const raw = url.searchParams.get(key); if (raw === null) return fallback; if (!/^[0-9]+$/.test(raw)) throw new LocalError(400, "invalid_params"); return Number(raw); };
        if (!options.files) throw new LocalError(503, "files_unavailable");
        const result = await options.files.read(category as "dir" | "meta" | "file", target, number("offset", 0), number("length", LOCAL_MAX_READ));
        if (category === "file") respond(res, 200, { ...responseHeaders, "Content-Type": "application/octet-stream", "Access-Control-Expose-Headers": "X-File-Size, X-File-Mtime, X-File-Eof", "X-File-Size": String(result.size), "X-File-Mtime": String(result.mtime), "X-File-Eof": String(result.eof) }, result.content);
        else respond(res, 200, responseHeaders, JSON.stringify(result));
      }
      options.onRequest?.(category);
    } catch (cause) {
      const known = cause instanceof LocalError || cause instanceof TicketError;
      const code = known ? cause.code : "local_failed", status = known ? cause.status : 503;
      options.onRequest?.(category, code);
      if (!res.headersSent && !res.destroyed) error(status, code);
    }
  };
}
async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError); server.once("listening", onListening); server.listen(port, "127.0.0.1");
  });
}
export async function startLocalApi(options: LocalApiOptions): Promise<LocalApiHandle | null> {
  if (!exactWebOrigin(options.webOrigin)) { options.onEvent?.("unavailable", { code: "invalid_web_origin" }); return null; }
  const handler = createHandler(options); let lastCode = "listen_failed";
  for (const port of options.ports ?? [47811, 47812]) {
    const server = http.createServer((req, res) => { void handler(req, res).catch(() => { if (res.destroyed || res.writableEnded) return; if (!res.headersSent) res.writeHead(503); res.end(); }); });
    server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000;
    try {
      await listen(server, port);
      const address = server.address(), actualPort = address && typeof address !== "string" ? address.port : port;
      options.onEvent?.("listening", { port: actualPort });
      return { port: actualPort, close: async () => { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); await options.files?.close(); } };
    } catch (cause) {
      lastCode = (cause as NodeJS.ErrnoException).code ?? "listen_failed";
      if (lastCode !== "EADDRINUSE") { options.onEvent?.("unavailable", { port, code: lastCode }); return null; }
    }
  }
  options.onEvent?.("unavailable", { code: lastCode }); return null;
}
