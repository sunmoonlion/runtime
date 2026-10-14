import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.js";
import { LocalFiles } from "../src/localFiles.js";
import { LocalProjects } from "../src/localProjects.js";
import { TicketVerifier } from "../src/ticket.js";
import { startLocalApi, type LocalApiHandle } from "../src/localApi.js";
import { ticketFixture } from "./localTicketFixture.js";

const origin = "https://investment.sunmoonai.com:30443";
let base: string, root: string, endpoint: LocalApiHandle, fixture: Awaited<ReturnType<typeof ticketFixture>>;
function call(route: string, body: unknown, headers: Record<string, string> = {}, method = "POST") {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${endpoint.port}${route}`, { method, headers: { Origin: origin, Authorization: "Bearer " + fixture.token(), "Content-Type": "application/json", ...headers } }, res => {
      const chunks: Buffer[] = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString() || "null") }));
    }); req.once("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
beforeEach(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sunmoon-projects-api-"))); root = path.join(base, "root"); fs.mkdirSync(root);
  fixture = await ticketFixture();
  const cfg = { ...defaultConfig(), userId: "probe-user", roots: [root], codexHome: path.join(base, "home") };
  endpoint = (await startLocalApi({ webOrigin: origin, version: "0.4.1", machineName: "test-pc", connected: () => true, config: () => cfg,
    files: new LocalFiles({ roots: () => cfg.roots, configDir: path.join(base, "config"), codexHome: cfg.codexHome }),
    projects: new LocalProjects({ roots: () => cfg.roots, denied: () => [cfg.codexHome], ceiling: () => cfg.ceiling, platform: "linux" }),
    ticket: new TicketVerifier({ webOrigin: origin, userId: () => cfg.userId, fetch: fixture.fetch }), ports: [0] }))!;
});
afterEach(async () => { await endpoint.close(); await fixture.close(); fs.rmSync(base, { recursive: true, force: true }); });

describe("loopback new-project routes", () => {
  it("announce themselves in info and sit behind the same origin and ticket gates", async () => {
    expect((await call("/local/v1/info", undefined, {}, "GET")).body.capabilities).toEqual(["local-fs-v1", "local-project-v1"]);
    expect((await call("/local/v1/projects/folder", { path: path.join(root, "p") }, { Authorization: "" })).status).toBe(401);
    expect((await call("/local/v1/projects/folder", { path: path.join(root, "p") }, { Origin: "https://example.com" })).status).toBe(403);
    expect(fs.existsSync(path.join(root, "p"))).toBe(false);
  });
  // 用 platform: "linux" 的 LocalProjects 在本机临时目录建文件夹；Windows 的建文件夹由真机探针覆盖
  it.skipIf(process.platform === "win32")("make a folder by POST with a JSON body holding only the path", async () => {
    const target = path.join(root, "新项目");
    expect(await call("/local/v1/projects/folder", { path: target })).toEqual({ status: 200, body: { path: target, created: true } });
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect((await call("/local/v1/projects/folder", undefined, {}, "GET")).status).toBe(405);
    expect((await call("/local/v1/projects/folder", { path: target, extra: 1 })).body.code).toBe("invalid_params");
    expect((await call("/local/v1/projects/folder", { path: target }, { "Content-Type": "text/plain" })).body.code).toBe("invalid");
    expect((await call("/local/v1/projects/folder", { path: path.join(base, "out") })).body).toEqual({ code: "outside_whitelist", message: "outside_whitelist" });
  });
  it("check the clone address before touching the disk", async () => {
    const res = await call("/local/v1/projects/clone", { url: "file:///etc", path: path.join(root, "r") });
    expect(res).toEqual({ status: 400, body: { code: "invalid_url", message: "invalid_url" } });
    expect(fs.existsSync(path.join(root, "r"))).toBe(false);
    expect((await call("/local/v1/projects/clone", { url: "https://example.com/r", path: path.join(root, "r"), branch: "x" })).body.code).toBe("invalid_params");
  });
});
