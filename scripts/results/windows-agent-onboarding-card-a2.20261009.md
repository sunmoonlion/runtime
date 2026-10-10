# Windows agent onboarding Card A2 receipt

Date: 2026-10-09 (Asia/Shanghai)
Authority: Fable feedback, last section of `k8s/sunmoonai/docs/dev-investment-agent/switch-test/luna-feedback.md`; procedure: SDD 0012, Card A2.

## Result

**A2 passed.** The download and extraction checks passed. The packaged Node installer ran and printed its own existing-installation guard because this Windows account already has an installation at `%LOCALAPPDATA%\Programs\sunmoon-agent`:

```text
Installation stopped: An installation already exists; in-place replacement is not supported yet
```

This is the installer’s deliberate no-overwrite rule, not a Smart App Control block. Since packaged `node.exe` executed far enough to emit the installer’s application-level message, this confirms the no-Mark-of-the-Web Node path was allowed by Smart App Control. We did not change `LOCALAPPDATA` to bypass the guard and did not install or replace anything. The owner confirms `desktop.ps1` had already opened the tray on the same kind of `Expand-Archive` path during an earlier check; it was not launched again in this run.

## Evidence

| Step | Result |
| --- | --- |
| Source ZIP | Existing 0.2.1 artifact; 174,243,923 bytes; SHA256 `2d5421627198b9cf2eccf15d88b726c80d46f4180e2db30606120f5bd52aea5a` |
| Temporary transport | One-request HTTP server bound to WSL loopback only; served the existing ZIP and exited successfully after the request. The single-use URL is intentionally omitted. |
| Windows download | `Invoke-WebRequest -UseBasicParsing` completed into the isolated A2 directory; downloaded size and SHA256 matched the source ZIP. |
| Mark of the Web | Exact read-only check output: `"zoneIdentifier":false`. `Get-Item -Stream *` did not include `Zone.Identifier`. |
| Extraction | `Expand-Archive` completed; 90 files extracted. |
| Bundle manifest | SHA256 `d72f5443be1fa13895a92cb97f37b9cef6ce5fe27e7707705f3ee0e56a11f1b2`, matching the trusted value. |
| Packaged Node preview | Ran with the expected manifest SHA and no `--apply`; returned the existing-installation guard shown above. This proves the package Node entrypoint executed. |
| Desktop window | Owner confirms the packaged `desktop.ps1` opened the tray in the earlier equivalent `Expand-Archive` path; not repeated in A2. |
| Token expiry | Owner verified in the website after token rotation: expiry displayed as **2026-11-08**, confirming the 30-day setting. No token was issued or rotated during A2. |

The exact isolated A2 directory `C:\Users\zymun\sunmoon-probe-runs\windows-agent-onboarding-card-a2-20261009` was removed after recording evidence. The one-request WSL loopback server exited successfully after the download.

Fable had approved cleanup of the exact earlier Card A directory `C:\Users\zymun\sunmoon-probe-runs\windows-agent-onboarding-card-a-20261009`. It was removed after checking the resolved path and confirming there were no reparse points; no reparse point was traversed. The original Downloads ZIP and the pre-existing `Downloads\sunmoon-agent-0.2.1` extraction were untouched.

## Scope and next step

No installation, uninstall, token change, agent/relay change, cluster change, or policy change occurred during A2. The existing-installation result is expected behavior and is addressed by the upgrade path in SDD 0012 step 2.4; it is not a failed A2 check.
