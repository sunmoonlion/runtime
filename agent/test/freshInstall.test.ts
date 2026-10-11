import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, saveConfig, type AgentConfig } from "../src/config.js";
import { menuPlan } from "../src/pair.js";
import { prepareAgentHome } from "../src/resident.js";
import { ensureWindowsSandbox } from "../src/windowsBootstrap.js";

const homes: string[] = [];

afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

function emptyHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "sunmoon-fresh-"));
  homes.push(home);
  return home;
}

describe("fresh install state", () => {
  it("opens the browser page when there is no token", () => {
    expect(menuPlan(false, false)).toEqual({ start: false, action: "pair-page" });
  });

  it("prepares an empty agent home without requiring config.json", () => {
    const home = emptyHome();
    const configPath = path.join(home, "config.json");
    expect(existsSync(configPath)).toBe(false);
    expect(prepareAgentHome(home, configPath)).toEqual([]);
    expect(existsSync(home)).toBe(true);
    expect(existsSync(configPath)).toBe(false);
  });

  it("reads existing roots when config.json is already present", () => {
    const home = emptyHome();
    const configPath = path.join(home, "config.json");
    const cfg = defaultConfig();
    cfg.codexHome = path.join(home, "codex-home");
    cfg.roots = [home];
    saveConfig(cfg, configPath);
    expect(prepareAgentHome(home, configPath)).toEqual([home]);
  });

  it("probes and saves Windows sandbox capability when start has none", async () => {
    const home = emptyHome();
    const configPath = path.join(home, "config.json");
    const cfg: AgentConfig = { ...defaultConfig(), codexHome: path.join(home, "codex-home") };
    saveConfig(cfg, configPath);
    let calls = 0;
    const capability = {
      mode: "unelevated" as const,
      testedAt: "2026-10-11T00:00:00.000Z",
      probe: "process/start" as const,
      elevatedSetupForHome: false,
      elevatedUsable: false,
    };
    await ensureWindowsSandbox(cfg, async () => {
      calls += 1;
      return capability;
    }, configPath);
    expect(calls).toBe(1);
    expect(cfg.windowsSandbox).toEqual(capability);
    expect(JSON.parse(readFileSync(configPath, "utf8")).windowsSandbox).toEqual(capability);
    await ensureWindowsSandbox(cfg, async () => {
      calls += 1;
      return capability;
    }, configPath);
    expect(calls).toBe(1);
  });
});
