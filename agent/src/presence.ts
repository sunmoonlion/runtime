import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface PresenceOptions {
  webOrigin: string;
  version: string;
  machineName: string;
  connected: () => boolean;
  onEvent?: (event: "listening" | "rate_limited" | "unavailable", details: { count?: number; port?: number; code?: string }) => void;
  /** Test seam; production always uses the two fixed loopback ports. */
  ports?: readonly number[];
}

export interface PresenceHandle {
  port: number;
  close: () => Promise<void>;
}

function exactWebOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function createHandler(options: PresenceOptions) {
  let second = -1, count = 0, rateLogWritten = false;
  const respond = (res: ServerResponse, status: number, headers: Record<string, string>, body = "") => {
    res.writeHead(status, headers);
    res.end(body);
  };
  return (req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    const origin = req.headers.origin;
    if (typeof origin !== "string" || origin !== options.webOrigin) {
      respond(res, 403, { "Cache-Control": "no-store" });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now !== second) { second = now; count = 0; rateLogWritten = false; }
    count++;
    const headers = corsHeaders(options.webOrigin);
    if (count > 20) {
      if (!rateLogWritten) {
        options.onEvent?.("rate_limited", { count });
        rateLogWritten = true;
      }
      respond(res, 429, headers);
      return;
    }

    if (req.url !== "/presence") {
      respond(res, 404, headers);
      return;
    }
    if (req.method === "OPTIONS") {
      const requestedMethod = req.headers["access-control-request-method"];
      if (requestedMethod !== undefined && requestedMethod !== "GET") {
        respond(res, 405, { ...headers, Allow: "GET, OPTIONS" });
        return;
      }
      respond(res, 204, {
        ...headers,
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Private-Network": "true",
      });
      return;
    }
    if (req.method !== "GET") {
      respond(res, 405, { ...headers, Allow: "GET, OPTIONS" });
      return;
    }

    const body = JSON.stringify({
      agent: "sunmoon-agent",
      version: options.version,
      machine_name: options.machineName,
      connected: options.connected(),
    });
    respond(res, 200, headers, body);
  };
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startPresence(options: PresenceOptions): Promise<PresenceHandle | null> {
  if (!exactWebOrigin(options.webOrigin)) {
    options.onEvent?.("unavailable", { code: "invalid_web_origin" });
    return null;
  }
  const ports = options.ports ?? [47811, 47812];
  let lastCode = "listen_failed";
  for (const port of ports) {
    const server = http.createServer(createHandler(options));
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.keepAliveTimeout = 1000;
    try {
      await listen(server, port);
      const address = server.address();
      const actualPort = address && typeof address !== "string" ? address.port : port;
      options.onEvent?.("listening", { port: actualPort });
      return {
        port: actualPort,
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "listen_failed";
      lastCode = code;
      if (code !== "EADDRINUSE") {
        options.onEvent?.("unavailable", { port, code });
        return null;
      }
    }
  }
  options.onEvent?.("unavailable", { code: lastCode });
  return null;
}
