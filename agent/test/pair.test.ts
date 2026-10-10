import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, saveConfig } from "../src/config.js";
import { deviceSecretSha256, runPair, type PairResponse } from "../src/pair.js";

const SECRET = "device-secret-0123456789ABCDEFGHijkl";
const TOKEN = "agent-token-should-stay-out-of-stdout";

function harness(replies: PairResponse[]) {
  const home = mkdtempSync(path.join(tmpdir(), "agent-pair-"));
  const configPath = path.join(home, "config.json");
  const calls: { url: string; body: Record<string, string> }[] = [];
  const lines: string[] = [];
  let stopped = 0;
  let cancelled = false;
  const post = async (url: string, body: Record<string, string>) => {
    calls.push({ url, body });
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  };
  const run = (extra: { jump?: number } = {}) => runPair({
    webOrigin: "https://investment.example",
    machineName: "desk",
    osName: "Windows",
    agentVersion: "0.2.2",
    codexVersion: "0.155.1",
    configPath,
    secret: SECRET,
    post,
    sleep: async ms => { clock += extra.jump ?? ms; },
    now: () => clock,
    cancelled: () => cancelled,
    stdout: line => lines.push(line),
    stopIfRunning: async () => { stopped += 1; },
  });
  let clock = 0;
  return {
    home, configPath, calls, lines, run,
    stopCount: () => stopped,
    cancel: () => { cancelled = true; },
    output: () => lines.join("\n"),
  };
}

const created = {
  status: 200,
  body: { request_id: "req-1", user_code: "ABCD-2345", expires_in: 300, interval: 3, verify_url: "https://investment.example/settings#computer" },
};

describe("pair", () => {
  it("writes the approved token only into config", async () => {
    const h = harness([created, { status: 429, body: { error: "slow_down" } }, {
      status: 200,
      body: { status: "approved", relay_url: "wss://relay.example/relay", relay_user: "owner", agent_token: TOKEN, agent_token_expires_at: "2026-11-09T00:00:00Z" },
    }]);
    try {
      expect(await h.run()).toBe(0);
      const body = h.calls[0].body;
      expect(Object.keys(body).sort()).toEqual(["agent_version", "codex_version", "device_secret_sha256", "machine_name", "os"]);
      expect(body.device_secret_sha256).toBe(deviceSecretSha256(SECRET));
      expect(body.device_secret_sha256).toBe(createHash("sha256").update(SECRET, "ascii").digest("hex"));
      expect(h.calls[1].url).toContain("/requests/req-1/poll");
      expect(h.calls[1].body).toEqual({ device_secret: SECRET });
      expect(h.stopCount()).toBe(1);
      const saved = JSON.parse(readFileSync(h.configPath, "utf8"));
      expect(saved.token).toBe(TOKEN);
      expect(saved.userId).toBe("owner");
      expect(saved.relayUrl).toBe("wss://relay.example/relay");
      expect(h.output()).toContain("ABCD-2345");
      expect(h.output()).not.toContain(TOKEN);
      expect(h.output()).not.toContain(SECRET);
    } finally { rmSync(h.home, { recursive: true, force: true }); }
  });

  it("keeps an existing config's other fields", async () => {
    const h = harness([created, { status: 200, body: { status: "approved", relay_url: "wss://relay.example/relay", relay_user: "owner", agent_token: TOKEN } }]);
    const prior = defaultConfig();
    prior.machineName = "kept-name";
    prior.ceiling = { sandbox: "read-only", network: false };
    saveConfig(prior, h.configPath);
    try {
      expect(await h.run()).toBe(0);
      const saved = JSON.parse(readFileSync(h.configPath, "utf8"));
      expect(saved.machineName).toBe("kept-name");
      expect(saved.ceiling).toEqual({ sandbox: "read-only", network: false });
      expect(saved.token).toBe(TOKEN);
    } finally { rmSync(h.home, { recursive: true, force: true }); }
  });

  it("cancels without saving and reports expiry, denial and reuse", async () => {
    const cases: { replies: PairResponse[]; jump?: number; cancel?: boolean; code: number; text: string }[] = [
      { replies: [created, { status: 200, body: { status: "cancelled" } }], cancel: true, code: 6, text: "已取消连接" },
      { replies: [created, { status: 200, body: { status: "pending" } }], jump: 300_000, code: 4, text: "连接码已过期" },
      { replies: [created, { status: 200, body: { status: "denied" } }], code: 5, text: "连接码已被拒绝" },
      { replies: [created, { status: 200, body: { status: "delivered" } }], code: 1, text: "连接码已经用过" },
    ];
    for (const item of cases) {
      const h = harness(item.replies);
      if (item.cancel) h.cancel();
      try {
        expect(await h.run({ jump: item.jump })).toBe(item.code);
        expect(h.output()).toContain(item.text);
        expect(h.output()).not.toContain(SECRET);
        expect(existsSync(h.configPath)).toBe(false);
      } finally { rmSync(h.home, { recursive: true, force: true }); }
    }
  });
});
