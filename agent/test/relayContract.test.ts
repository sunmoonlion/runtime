import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { digest } from "../src/permissions.js";
import { PERMISSION_CAPABILITY, validPermissionReport } from "../src/relayProtocol.js";

describe("provider-owned permission contract", () => {
  it("pins the provider schema by canonical hash and keeps report examples strict", () => {
    const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../contracts/relay-permissions.lock.json"), "utf8"));
    expect(digest(lock.contract)).toBe(lock.canonical_sha256);
    expect(JSON.stringify(lock.contract)).toContain(PERMISSION_CAPABILITY);
    const provider = path.resolve(__dirname, "../../../k8s/sunmoonai/relay-platform/relay/local-permission-v1.json");
    if (fs.existsSync(provider)) expect(JSON.parse(fs.readFileSync(provider, "utf8"))).toEqual(lock.contract);
    const report = { id: "11111111-1111-1111-1111-111111111111", conn: "01234567", threadId: "22222222-2222-2222-2222-222222222222", requestDigest: "a".repeat(64), permissionDigest: "b".repeat(64), decision: "approved", scope: { sandbox: "workspace-write", network: false }, expiresAt: Math.floor(Date.now() / 1000) + 30 };
    expect(validPermissionReport(report)).toBe(true);
    for (const change of [{ token: "synthetic" }, { id: report.id + "\n" }, { expiresAt: true }, { scope: { sandbox: "danger-full-access", network: true } }]) expect(validPermissionReport({ ...report, ...change })).toBe(false);
  });
});
