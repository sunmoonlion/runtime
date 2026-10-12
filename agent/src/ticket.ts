import { createPublicKey, verify, type KeyObject, type JsonWebKey } from "node:crypto";

export class TicketError extends Error {
  constructor(readonly status: 401 | 503, readonly code: "ticket_invalid" | "keys_unavailable") { super(code); }
}
const invalid = () => new TicketError(401, "ticket_invalid");
const unavailable = () => new TicketError(503, "keys_unavailable");

/** Fetches public keys only. A ticket or user file is never sent to the site. */
export class TicketVerifier {
  private keys = new Map<string, KeyObject>();
  private expires = 0;
  private lastFetch = -Infinity;
  private loading?: Promise<void>;
  constructor(private readonly opts: { webOrigin: string; userId: () => string; fetch?: typeof fetch; now?: () => number }) {}
  async check(authorization: string | undefined): Promise<void> {
    if (!authorization || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) || authorization.length > 8192) throw invalid();
    const [header64, payload64, signature64] = authorization.slice(7).split(".");
    let header: any, claims: any, signature: Buffer;
    try {
      header = JSON.parse(Buffer.from(header64, "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(payload64, "base64url").toString("utf8"));
      signature = Buffer.from(signature64, "base64url");
    } catch { throw invalid(); }
    const now = Math.floor((this.opts.now ?? Date.now)() / 1000);
    if (!header || header.alg !== "ES256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 128 || header.crit
      || !claims || claims.aud !== "local-agent" || claims.sub !== this.opts.userId() || typeof claims.iss !== "string" || !claims.iss.trim()
      || !Number.isSafeInteger(claims.exp) || claims.exp <= now || !Number.isSafeInteger(claims.iat) || claims.iat > now + 30
      || claims.exp <= claims.iat || claims.exp - claims.iat > 600 || signature.length !== 64) throw invalid();
    if ((this.opts.now ?? Date.now)() >= this.expires) await this.refresh();
    if (!this.keys.has(header.kid)) {
      if (this.loading) await this.loading;
      else if ((this.opts.now ?? Date.now)() - this.lastFetch > 60000) await this.refresh();
    }
    const key = this.keys.get(header.kid);
    if (!key) throw invalid();
    try {
      if (!verify("sha256", Buffer.from(header64 + "." + payload64), { key, dsaEncoding: "ieee-p1363" }, signature)) throw invalid();
      if (claims.exp <= Math.floor((this.opts.now ?? Date.now)() / 1000)) throw invalid();
    } catch { throw invalid(); }
  }
  private refresh(): Promise<void> {
    // Count attempts too: an unavailable endpoint must not create a fetch storm.
    if (!this.loading) {
      this.lastFetch = (this.opts.now ?? Date.now)();
      this.loading = this.load().finally(() => { this.loading = undefined; });
    }
    return this.loading;
  }
  private async load(): Promise<void> {
    try {
      const response = await (this.opts.fetch ?? fetch)(this.opts.webOrigin + "/api/workbench/token-keys", { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
      if (!response.ok || !response.body) throw unavailable();
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > 65536) throw unavailable(); chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      const document = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(document.keys) || document.keys.length > 64) throw unavailable();
      const keys = new Map<string, KeyObject>();
      for (const item of document.keys) {
        if (!item || item.kty !== "EC" || item.crv !== "P-256" || (item.alg && item.alg !== "ES256") || (item.use && item.use !== "sig") || item.d) continue;
        if (typeof item.kid !== "string" || !item.kid || item.kid.length > 128 || keys.has(item.kid)) throw unavailable();
        keys.set(item.kid, createPublicKey({ key: item as JsonWebKey, format: "jwk" }));
      }
      if (!keys.size) throw unavailable();
      this.keys = keys; this.expires = (this.opts.now ?? Date.now)() + 600000;
    } catch { throw unavailable(); }
  }
}
