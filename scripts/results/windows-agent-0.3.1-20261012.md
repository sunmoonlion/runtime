# Windows Agent 0.3.1 implementation receipt

Date: 2026-10-12 (Asia/Shanghai)
Repository: `runtime`, local `luna` branch, based on `dbe5d01`
Status: implementation and Linux-hosted automated checks complete; local commits only, not pushed.

## Changes

### 1. Windows command output encoding

- Added pure argv and environment preparation helpers in `agent/src/windowsEncoding.ts`.
- `WindowsBridge` still runs `windowsDecision` against the original request. After approval and other local checks, the forwarded `process/start` copy gets the UTF-8 prefix for PowerShell (`powershell`, `pwsh`, `-Command`, `-c`) or `cmd.exe` (`/c`, `/d /c`, `/c /d`). Existing PowerShell prefix is not duplicated; non-shell commands are unchanged.
- Adds `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` only when no case-insensitive equivalent exists.
- Added table-driven helper tests and a bridge forwarding test.

Commit: `9c411a8` — `fix(windows): 转发命令时启用 UTF-8 输出；定向 Vitest 20 项、tsc 通过`

### 2. Pair page finish

- Renamed the link to “去网站允许” and updated the copy to say the website should already have the code filled in; replaced the warning with “别人发给你的码不要允许”。
- Added “复制连接码”; clicking the code also copies it. Uses `navigator.clipboard.writeText`, selects the code as a manual fallback, and shows “已复制” for two seconds after success. CSP remains unchanged.
- Added the requested guidance to the tray status window.
- Added rendered-page contract assertions.

Commit: `7d2577d` — `fix(pairing): 完成本机连接页收尾；pairPage Vitest 6 项、tsc 通过`

### 3. Local presence endpoint and version

- Added a read-only HTTP endpoint to the Windows resident at `127.0.0.1:47811/presence`, falling back to `47812`. If both ports are occupied it logs the failure and continues without the endpoint.
- Requires an exact `Origin` matching the installed `site.json` HTTPS origin; missing or different origins receive `403` without CORS headers. Only exact `/presence` is accepted; query strings and other paths return `404`; unsupported methods return `405`.
- Implements GET and GET preflight, including `Access-Control-Allow-Private-Network: true`. It does not emit credentials permission. The JSON contains exactly `agent`, `version`, `machine_name`, and `connected`.
- Limits accepted-origin traffic to 20 requests per second and logs only the rate-limit count, never request headers.
- Added endpoint tests for response projection/headers, origin rejection, path and method handling, preflight, fallback, both ports occupied, rate limit, and invalid site origin.
- Updated all three requested version fields to `0.3.1`: `agent/package.json`, `agent/src/cli.ts`, and `agent/distribution/windows-x64.json` (`agentVersion`).
- Updated `siteTrust.test.ts` to skip the incompatible child-process case when the child exits with code 9.

Commit: `d3caece` — `feat(presence): 提供受限的本机接入探测；全量 Vitest、tsc、发行包测试通过`

## Automated verification

Commands run from `runtime/agent`:

```text
pnpm exec vitest run test/windowsEncoding.test.ts test/windowsBridge.test.ts
Test Files  2 passed (2)
Tests       20 passed (20)

pnpm exec vitest run test/pairPage.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)

pnpm exec vitest run test/presence.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)

pnpm test
Test Files  23 passed | 4 skipped (27)
Tests       244 passed | 33 skipped (277)

pnpm typecheck
exit 0

node --test distribution/test/bundle.test.mjs distribution/test/processes.test.mjs distribution/test/watchdog.test.mjs
tests 48; pass 46; fail 0; skipped 2
```

The loopback test initially could not bind under the restricted shell (`listen EPERM`); after the approved local test run, all six presence tests passed. Full Vitest and the three distribution suites also passed. Windows-only tests were skipped on this Linux host.

## Not verified on the owner's Windows machine

- First-command Chinese output in a real Windows work conversation (`Get-ChildItem` and `dir`).
- Pairing page opened by the tray, site approval performed by the owner, clipboard copy behavior, and tray status presentation.
- Browser `fetch` from the investment site in Edge and Chrome; wrong-origin browser rejection; real `curl` checks; connection refusal after stopping the resident.
- Clean Windows candidate assembly and installation. The required official `node.exe` and prepared Windows dependency directory were not present under the checked local package/worktree locations, and this host cannot perform a Windows installation. No candidate was installed and the existing 0.3.0 installation was not touched.

No cluster, pairing account, installed agent, or unrelated process was changed. No files containing configuration or credentials were included in this receipt.
