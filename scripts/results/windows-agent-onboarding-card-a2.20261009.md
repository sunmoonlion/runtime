# Windows agent onboarding Card A2 receipt

Date: 2026-10-09 (Asia/Shanghai)
Authority: Fable feedback, last section of `k8s/sunmoonai/docs/dev-investment-agent/switch-test/luna-feedback.md`; procedure: SDD 0012, Card A2.

## Result

**Stopped at the installer preview.** The A2 download and extraction checks passed. The packaged Node installer preview then refused to continue because this Windows account already has an installation at `%LOCALAPPDATA%\Programs\sunmoon-agent`:

```text
Installation stopped: An installation already exists; in-place replacement is not supported yet
```

SDD 0012 says to stop if any step is blocked. I did not change `LOCALAPPDATA` to bypass the guard, did not run `desktop.ps1`, and did not query `agent_token_expires_at` after the stop point.

## Evidence

| Step | Result |
| --- | --- |
| Source ZIP | Existing 0.2.1 artifact; 174,243,923 bytes; SHA256 `2d5421627198b9cf2eccf15d88b726c80d46f4180e2db30606120f5bd52aea5a` |
| Temporary transport | One-request HTTP server bound to WSL loopback only; served the existing ZIP and exited successfully after the request. The single-use URL is intentionally omitted. |
| Windows download | `Invoke-WebRequest -UseBasicParsing` completed into the isolated A2 directory; downloaded size and SHA256 matched the source ZIP. |
| Mark of the Web | `Zone.Identifier` absent from the newly downloaded ZIP. |
| Extraction | `Expand-Archive` completed; 90 files extracted. |
| Bundle manifest | SHA256 `d72f5443be1fa13895a92cb97f37b9cef6ce5fe27e7707705f3ee0e56a11f1b2`, matching the trusted value. |
| Packaged Node preview | **Blocked** by the existing installation guard shown above. No `--apply` flag was used. |
| Desktop window | Not run because the previous step was blocked. |
| Token expiry status | Not queried because the previous step was blocked. No token was issued or rotated. |

The exact isolated A2 evidence directory remains at:
`C:\Users\zymun\sunmoon-probe-runs\windows-agent-onboarding-card-a2-20261009`.

Fable had approved cleanup of the exact earlier Card A directory. It was removed after checking the resolved path and confirming there were no reparse points; no reparse point was traversed. The original Downloads ZIP and the pre-existing `Downloads\sunmoon-agent-0.2.1` extraction were untouched.

## Scope and next step

No installation, uninstall, token change, agent/relay change, cluster change, or policy change occurred. To finish A2, Fable/owner review must decide how to safely preview the installer when the target installation already exists, without weakening the installer guard or replacing the active installation. Until then, A2 is incomplete; do not record its preview, desktop-window, or expiry checks as passed.
