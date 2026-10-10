import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { applyLaunchEnv, installedLaunchError, installedSite, nodeLaunch } from "../src/siteTrust.js";

const pem = fs.readFileSync(new URL("../distribution/sites/dev-kind-ca.pem", import.meta.url), "utf8");
const hash = createHash("sha256").update(new X509Certificate(pem).raw).digest("hex");

function layout(): { root: string; url: string; caPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sunmoon-trust-"));
  const dist = path.join(root, "app", "dist");
  fs.mkdirSync(dist, { recursive: true });
  const marker = path.join(dist, "cli.js");
  fs.writeFileSync(marker, "");
  const caPath = path.join(root, "site", "ca.pem");
  fs.mkdirSync(path.dirname(caPath));
  fs.writeFileSync(caPath, pem);
  fs.writeFileSync(path.join(root, "site", "site.json"), JSON.stringify({
    site: "dev-kind", web_origin: "https://investment.sunmoonai.com:30443",
    relay_url: "wss://relay.sunmoonai.com:30443",
    trust: { mode: "bundled-ca", ca_file: "site/ca.pem", ca_sha256: hash },
  }, null, 2) + "\n");
  return { root, url: pathToFileURL(marker).href, caPath };
}

describe("installed site launch", () => {
  it("ignores a source checkout that has no packaged site", () => {
    expect(installedSite(import.meta.url)).toBeNull();
    expect(installedLaunchError(import.meta.url)).toBeNull();
  });
  it("fails closed when the packaged entry omits the system CA flag", () => {
    const packed = layout();
    expect(installedSite(packed.url)?.caPath).toBe(packed.caPath);
    expect(nodeLaunch(installedSite(packed.url)).execArgv).toEqual(["--use-system-ca"]);
    const error = installedLaunchError(packed.url);
    expect(error).toContain("SITE_LAUNCH");
    expect(error).not.toContain("PRIVATE");
    fs.rmSync(packed.root, { recursive: true, force: true });
  });
  it("rejects a certificate whose DER hash does not match the package", () => {
    const packed = layout();
    const file = path.join(packed.root, "site", "site.json");
    const site = JSON.parse(fs.readFileSync(file, "utf8"));
    site.trust.ca_sha256 = "0".repeat(64);
    fs.writeFileSync(file, JSON.stringify(site));
    expect(() => installedSite(packed.url)).toThrow(/不一致/);
    fs.rmSync(packed.root, { recursive: true, force: true });
  });
  it("accepts the packaged flags in a child process and rejects the wrong CA path", () => {
    const packed = layout();
    const script = `
      import { installedLaunchError } from ${JSON.stringify(new URL("../src/siteTrust.ts", import.meta.url).href)};
      const message = installedLaunchError(${JSON.stringify(packed.url)});
      console.log(message ?? "OK");
    `;
    const run = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ["--use-system-ca", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script], { env, encoding: "utf8" });
    const good = run({ ...process.env, NODE_EXTRA_CA_CERTS: packed.caPath });
    expect(good.status, good.stderr).toBe(0);
    expect(good.stdout.trim()).toBe("OK");
    const bad = run({ ...process.env, NODE_EXTRA_CA_CERTS: path.join(packed.root, "missing.pem"), NODE_OPTIONS: "--use-openssl-ca" });
    expect(bad.stdout.trim()).toContain("SITE_LAUNCH");
    expect(bad.stdout).not.toContain("use-openssl-ca");
    const cleared = applyLaunchEnv({ ...process.env, NODE_OPTIONS: "--use-openssl-ca", NODE_EXTRA_CA_CERTS: "elsewhere" }, nodeLaunch(installedSite(packed.url)));
    expect(cleared.NODE_OPTIONS).toBeUndefined();
    expect(cleared.NODE_EXTRA_CA_CERTS).toBe(packed.caPath);
    fs.rmSync(packed.root, { recursive: true, force: true });
  });
  it("accepts another case spelling of the same certificate and rejects a different file", () => {
    const packed = layout();
    const other = path.join(packed.root, "site", "other.pem");
    fs.writeFileSync(other, `${pem}\nnot-the-packaged-file\n`);
    const flipped = packed.caPath.replace(/[A-Za-z]/g, (ch) => ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase());
    let spelling = "";
    try {
      if (flipped !== packed.caPath && fs.realpathSync.native(flipped) === fs.realpathSync.native(packed.caPath)) spelling = flipped;
    } catch { /* this filesystem does not open the other case as the same file */ }
    if (!spelling) {
      spelling = path.join(packed.root, "site", "CA.pem");
      fs.symlinkSync(packed.caPath, spelling);
    }
    expect(spelling).not.toBe(packed.caPath);
    const script = `
      import { installedLaunchError } from ${JSON.stringify(new URL("../src/siteTrust.ts", import.meta.url).href)};
      const message = installedLaunchError(${JSON.stringify(packed.url)});
      console.log(message ?? "OK");
    `;
    const run = (ca: string) => spawnSync(process.execPath, ["--use-system-ca", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: ca }, encoding: "utf8",
    });
    const same = run(spelling);
    expect(same.status, same.stderr).toBe(0);
    expect(same.stdout.trim()).toBe("OK");
    const different = run(other);
    expect(different.status, different.stderr).toBe(0);
    expect(different.stdout.trim()).toContain("SITE_LAUNCH");
    expect(different.stdout).not.toContain("other.pem");
    fs.rmSync(packed.root, { recursive: true, force: true });
  });
});
