export type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let current: Level = (process.env.SUNMOON_AGENT_LOG as Level) || "info";

export function setLevel(l: Level): void {
  current = l;
}

export function log(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (RANK[level] < RANK[current]) return;
  const line = { t: new Date().toISOString(), level, msg, ...(extra ?? {}) };
  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + "\n");
}
