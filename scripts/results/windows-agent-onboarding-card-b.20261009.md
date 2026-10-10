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
