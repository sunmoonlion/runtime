import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TicketVerifier } from "../src/ticket.js";
import { ticketFixture } from "./localTicketFixture.js";
let fixture: Awaited<ReturnType<typeof ticketFixture>>, verifier: TicketVerifier;
beforeEach(async () => { fixture = await ticketFixture(); verifier = new TicketVerifier({ webOrigin: "https://investment.example", userId: () => "probe-user", fetch: fixture.fetch }); });
afterEach(async () => { await fixture.close(); });
describe("local-agent ES256 tickets", () => {
  it("verifies a P-256 signature and caches public JWKS, never sending the ticket", async () => {
    const token = fixture.token(); await verifier.check("Bearer " + token); await verifier.check("Bearer " + token);
    expect(fixture.requests()).toBe(1);
  });
  it("rejects missing, malformed, bad signature, unknown kid and unsupported algorithms", async () => {
    const token = fixture.token(), segments = token.split(".");
    segments[2] = Buffer.alloc(64).toString("base64url");
    for (const value of [undefined, "Bearer malformed", "Basic value", "Bearer " + segments.join("."), "Bearer " + fixture.token({}, { kid: "unknown" }), "Bearer " + fixture.token({}, { alg: "HS256" })]) {
      await expect(verifier.check(value)).rejects.toMatchObject({ status: 401, code: "ticket_invalid" });
    }
  });
  it("binds audience, subject and expiry and checks issuer and ten-minute lifetime", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [{ sub: "other" }, { aud: "relay" }, { aud: ["local-agent"] }, { exp: now - 1 }, { iss: "" }, { iat: now + 100 }, { exp: now + 601 }, { exp: "future" }]) {
      await expect(verifier.check("Bearer " + fixture.token(claims))).rejects.toMatchObject({ status: 401, code: "ticket_invalid" });
    }
    expect(fixture.requests()).toBe(0);
  });
  it("reports unavailable JWKS as 503 and does not use an expired cache", async () => {
    fixture.fail(); await expect(verifier.check("Bearer " + fixture.token())).rejects.toMatchObject({ status: 503, code: "keys_unavailable" });
    let now = Date.now();
    await fixture.close(); fixture = await ticketFixture();
    const fresh = new TicketVerifier({ webOrigin: "https://investment.example", userId: () => "probe-user", fetch: fixture.fetch, now: () => now });
    await fresh.check("Bearer " + fixture.token()); fixture.fail(); now += 600001;
    await expect(fresh.check("Bearer " + fixture.token({ iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 600 }))).rejects.toMatchObject({ status: 503, code: "keys_unavailable" });
  });
  it("deduplicates concurrent public key loads", async () => {
    await Promise.all(Array.from({ length: 4 }, () => verifier.check("Bearer " + fixture.token())));
    expect(fixture.requests()).toBe(1);
  });
  it("rechecks expiry after fetching keys and ignores header-supplied key URLs", async () => {
    let now = Date.now();
    const scoped = new TicketVerifier({ webOrigin: "https://investment.example", userId: () => "probe-user", now: () => now,
      fetch: (async (url, init) => { expect(url).toBe("https://investment.example/api/workbench/token-keys"); now += 2000; return fixture.fetch(url, init); }) as typeof fetch });
    const expiredWhileLoading = fixture.token({ exp: Math.floor(now / 1000) + 1 }, { jku: "https://attacker.invalid/keys" });
    await expect(scoped.check("Bearer " + expiredWhileLoading)).rejects.toMatchObject({ status: 401, code: "ticket_invalid" });
  });
});
