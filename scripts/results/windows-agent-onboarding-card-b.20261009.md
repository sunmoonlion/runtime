# Windows agent onboarding Card B — backend implementation receipt

Date: 2026-10-09 (Asia/Shanghai)
Authority: owner/Fable direction and SDD 0012, Card B. This is a local implementation candidate for review; it is **not** an acceptance pass.

## Implemented

- Added Alembic revision `20261009_0014` for pairing requests, pairing audit events, and short-lived install credentials. Pairing codes are stored as HMAC digests, device secrets as SHA256 digests, install credentials as SHA256 digests, and the relay token is stored only as encrypted ciphertext until one-time delivery.
- Added the six pairing endpoints and three install-capability endpoints, mounted in the API router. Owner actions use the existing web-session dependency, which validates origin/CSRF for mutation requests. Public poll returns the relay token only on the atomic `approved → delivered` transition; later polls only return `delivered`.
- Approval uses the existing owner-level advisory lock and relay identity ensure/rotation path. It writes an `agent/paired` audit event with request ID, machine name, source address and request time; it does not write a token or connection code to the event.
- Added fixed-window Redis limits for pairing creation, owner lookup failures, install-command issuance, plus the three-second poll interval and 500-pending-request global cap.
- Added a Celery Beat cleanup every 600 seconds. It expires pending/approved pairings, clears leftover encrypted tokens, and deletes expired install credentials. Pairing creation also expires stale rows before checking the global cap.
- Added `WORKBENCH_TRUSTED_PROXY_CIDRS`, default empty. Empty means the backend records only the direct peer and ignores XFF. If a configured trusted peer has no usable forwarded value, the API returns the sentinel `unknown`. No cluster/Traefik CIDR was selected or hardcoded. Card D must render `unknown` as `未知`; Card E must verify the direct Traefik hop and forwarding behavior before any CIDR is configured.
- Redacted capability-bearing install paths, including query strings, from Uvicorn access records. Onboarding application logs record only a generated request ID and status/result. Exception handling does not log exception messages or tracebacks for onboarding paths; streamed object-store errors produce only a request ID and `stream_error`. No request bodies are logged.
- Package delivery uses the existing immutable object-storage descriptor and streaming verifier, supports Range/If-Range and HEAD, rejects query parameters, checks configured size/digests, and refuses object-store redirects. Credentials are not consumed for malformed Range or invalid templates.
- Updated SDD 0012: A2 is marked passed with the owner-confirmed 2026-11-08 expiry; Card C explicitly includes stop → uninstall while preserving configuration → install for upgrades; release Card E includes checking Traefik access-log enablement and path logging.

No application was deployed. No cluster, Traefik, running service, credential, or user data was changed.

## Checks run

| Check | Result |
| --- | --- |
| `ruff check app tests` | Passed |
| Targeted pyright on changed application/interface/bootstrap/repository files | Passed: 0 errors, 0 warnings |
| `lint-imports` | Passed: 4 contracts kept, 0 broken |
| New unit tests (`test_agent_onboarding_unit.py`) | 10 passed |
| New PostgreSQL tests (`test_agent_onboarding_db.py`) | 3 skipped because `AGENT_TEST_DATABASE_URL` is not configured |
| Existing release-configuration validation (`test_agent_onboarding.py -k bad_release`) | 9 passed, 4 deselected |

The required PostgreSQL concurrency checks are present but **not verified against PostgreSQL**. `AGENT_TEST_DATABASE_URL` and `DELIVERY_TEST_DATABASE_URL` were both absent. The new database cases cover concurrent one-time token delivery and ciphertext clearing, atomic pending-cap reservation, install-credential use cap, and expiry cleanup; they need rerunning against the disposable `*_tests` database.

## Unresolved test stop

The existing HTTP contract test `test_download_contract_is_authenticated_config_only_no_store[None]` did not return in this environment. A bounded diagnostic request showed the workbench-enabled dependency override ran, then the request remained in Starlette `BaseHTTPMiddleware.call_next` waiting for the inner response; the expected current-user override was not reached. The temporary diagnostic test was removed. A broader targeted run likewise remained active after 60 seconds and was stopped with Ctrl+C (exit 130). This is recorded as **not passed**; no authentication behavior is claimed from it. Resolve the test dependency/ASGI hang, then run the HTTP contract, auth+CSRF, route behavior tests and full backend suite before calling Card B accepted.

The package-hosting routes also need an end-to-end test against a local fake S3 endpoint; no real storage or relay service was used in Card B. SDD’s real PostgreSQL concurrency/rotation assertions remain pending. Windows pairing, real token rotation, publication, Card E, and Traefik access-log inspection remain later-stage work.

## Re-run

From `investment-app/investment-backend/app`:

```bash
UV_CACHE_DIR=/tmp/uv-cache-luna uv run ruff check app tests
UV_CACHE_DIR=/tmp/uv-cache-luna uv run pyright app/application/workbench/agent_onboarding.py app/interfaces/endpoints/agent_onboarding_routes.py app/interfaces/http/client_ip.py app/tasks/agent_onboarding.py app/bootstrap/api.py app/infrastructure/workbench/repository.py
UV_CACHE_DIR=/tmp/uv-cache-luna uv run lint-imports
UV_CACHE_DIR=/tmp/uv-cache-luna uv run pytest -q tests/test_agent_onboarding_unit.py tests/test_agent_onboarding_db.py
UV_CACHE_DIR=/tmp/uv-cache-luna uv run pytest -q tests/test_agent_onboarding.py
```

Set `AGENT_TEST_DATABASE_URL` only to the disposable PostgreSQL test database whose name ends in `_tests`; do not point it at a deployed application database. The `pytest` HTTP hang must be diagnosed rather than excluded from the acceptance result.

## Stop point

Stop here for Fable review. Do not start Card C/D, publish the backend or package, change cluster configuration, inspect/change Traefik, or run against a live relay until the HTTP test stop and PostgreSQL acceptance gap are resolved and reviewed.

## 2026-10-10 · Fable review corrections and rerun

Fable reviewed backend commit `9bcff86` and required three corrections:

1. **One-time token delivery:** changed delivery to a PostgreSQL CTE that locks and snapshots the approved row's old ciphertext, then clears it while returning the snapshot. A poll that sees a missing/empty ciphertext now returns `delivered` without attempting to decrypt `None`.
2. **Migration-chain invariant:** added `20261009_0014_agent_onboarding.py` to `test_one_linear_canonical_migration_chain` and asserted its parent is `20261007_0013`.
3. **Forwarded client chain:** `source_ip` accepts every `X-Forwarded-For` header field, parses all comma-separated addresses, walks right-to-left past configured trusted hops, and chooses the first untrusted address. Invalid entries yield `unknown`; if every hop is trusted, it uses the leftmost. Added tests for the Tokyo/frpc chain, a forged leftmost entry, repeated header fields, fully trusted chain, invalid chain, and empty default configuration. The configured CIDR remains empty until Card E verifies the live path.

Rerun results in this worktree:

| Check | Result |
| --- | --- |
| `ruff check app tests` | Passed |
| `lint-imports` | Passed: 4 kept, 0 broken |
| pyright on changed implementation files | Passed: 0 errors, 0 warnings, 0 informations |
| `pytest -q tests/test_agent_onboarding_unit.py tests/test_kernel_invariants.py` | 21 passed |
| `pytest -q tests/test_agent_onboarding_db.py` | 3 skipped: both disposable PostgreSQL URL variables are absent |
| Full `pytest -vv -x` | Collected 943; first 9 tests passed; hangs at `tests/test_agent_onboarding.py::test_download_contract_is_authenticated_config_only_no_store[None]`; stopped with Ctrl+C (exit 130), not passed |

For the requested redacted environment diagnostic, matching variable names present were `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and lowercase equivalents; values were not read into the report. No `AGENT_TEST_DATABASE_URL` or `DELIVERY_TEST_DATABASE_URL` is set. This does not establish that proxy settings cause the HTTP hang. The PostgreSQL CTE/concurrency fix therefore remains unverified against a real disposable test database in this worktree. The hanging HTTP test was not excluded from the full-suite result.

## 2026-10-10 · Edge cluster DNS step 1 (read-only only)

Context: SDD 0013 section 5.1. Queried context `kind-sunmoon-kind`; all three nodes were `Ready`, Kubernetes `v1.36.5`. No resources were changed.

The live CoreDNS Corefile contains only this explicit hosts mapping:

```text
hosts {
    172.18.0.1 harbor.sunmoonai.com
    fallthrough
}
```

The investment API Pod was `investment-api-54ff7fb96-j6mtd`. Its `/etc/hosts` had no `hostAliases` and no entries for the three queried names; its resolver was `nameserver 10.99.0.10`, search `app-platform-dev.svc.cluster.local svc.cluster.local cluster.local`, `ndots:2`.

The requested `getent hosts casdoor.sunmoonai.com relay.sunmoonai.com investment.sunmoonai.com` returned:

```text
127.0.0.1 harbor.sunmoonai.com casdoor.sunmoonai.com
127.0.0.1 info.sunmoonai.com relay.sunmoonai.com
127.0.0.1 harbor.sunmoonai.com investment.sunmoonai.com
```

Individual `getent ahostsv4` confirmed `casdoor` and `investment` resolve to `127.0.0.1` (reported canonical name `harbor.sunmoonai.com`), `relay` to `127.0.0.1` (canonical `info.sunmoonai.com`), while `harbor.sunmoonai.com` resolves to `172.18.0.1`. The Corefile has no explicit entries for casdoor, relay, or investment; those three therefore do not currently resolve to the cluster gateway. This step stopped at read-only verification: no DNS/CoreDNS changes, no release, and no public DNS changes. Hand off this evidence for review before preparing the next implementation/release card.
