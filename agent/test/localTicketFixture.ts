import http from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";

export async function ticketFixture() {
  let { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  let kid = "local-test-key";
  let available = true, requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (req.headers.authorization) { res.writeHead(400); res.end(); return; }
    res.writeHead(available ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture listen failed");
  return {
    fetch: ((_url: any, init: any) => fetch(`http://127.0.0.1:${address.port}/api/workbench/token-keys`, init)) as typeof fetch,
    token: (claims: object = {}, header: object = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const head = Buffer.from(JSON.stringify({ alg: "ES256", kid, typ: "JWT", ...header })).toString("base64url");
      const body = Buffer.from(JSON.stringify({ iss: "test-workbench", aud: "local-agent", sub: "probe-user", iat: now, exp: now + 600, jti: "test-only", ...claims })).toString("base64url");
      return head + "." + body + "." + sign("sha256", Buffer.from(head + "." + body), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    },
    fail: () => { available = false; },
    rotate: () => { ({ publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })); kid += "-next"; },
    requests: () => requests,
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}
