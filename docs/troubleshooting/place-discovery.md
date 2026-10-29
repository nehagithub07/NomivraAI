# Discover Places diagnosis and fix

The local locking, duplicate-request handling and error attribution have been fixed and validated. **A live success through Overpass and hosted Supabase is not claimed:** the configured public Overpass endpoint timed out during explicit live verification. The fresh backend acquired immediately, made one upstream call, returned a safe provider error and released its slot. Authentication code, RLS, the signed persistence RPC and the existing UI design were preserved.

## Credentials moved to private environment files

- Removed all three real `SecretStr` defaults from `backend/app/core/config.py`: the internal service key, StayAPI key and Geoapify key. Their source defaults are now empty.
- Stored provider credentials only in ignored `backend/.env`. Preserved the matching internal key in both `backend/.env` and root `.env.local`, avoiding disruption to the existing database proof verifier.
- Removed the real internal key that had also been copied into root `.env.example`. Example server-secret values are blank. No secret values were printed by the migration/check scripts.
- Moved the user's selected Overpass endpoint into `backend/.env`; `Settings` keeps its normal public fallback. Corrected the Open-Meteo source fallback to a base URL, because its adapter appends `/search` and `/get`. The existing backend environment already had the correct base URL.
- Verified both private environment files are ignored, all three credentials load, provider keys are absent from root `.env.local`, and the internal values match. A scan found no matching real secrets in tracked working-tree files or in the checked history of config/example files across three referenced commits. This is a scoped check, not a guarantee about external copies or all historical artifacts.

Hardcoding secrets creates exposure risk when source is shared or committed. The pasted credentials should be rotated at their issuers; moving them does not revoke them. Rotate the internal key together in both private environments **and** the restricted database application-secret configuration, then restart both services, to keep HMAC verification consistent. No keys were rotated automatically, because the hosted database secret must remain synchronized. Public Supabase publishable settings were retained.

## 1. Root cause and complete request path

The existing path is authenticated `DestinationPlaces` UI → Next.js discovery route → owned-trip lookup and persisted-place read → `callTravelApi` → internally authenticated FastAPI route → Overpass adapter → normalization → BFF HMAC proof → `persist_trip_place_candidates` → UI.

Inspection established:

1. `create_app` creates one `ProviderLimits` on `app.state`. Production's one application per worker therefore has a shared limiter across trips; destination search uses the separate `search()` method.
2. The originally reported implementation rejected immediately when a discovery was active or its 10s interval had not passed. At inspection, the working tree already contained the user's partial 8s-wait/2s-cooldown replacement.
3. That replacement caught `Exception` during setup. `asyncio.CancelledError` derives from `BaseException`, so cancellation during its cooldown leaked an acquired lock. A direct pre-fix reproduction confirmed `lock_still_held=true` after cancellation. The route's `finally` could not help because `begin_discovery()` had not returned yet.
4. The route released the raw lock in `finally` after provider work, but did not encapsulate ownership. It now uses an async context manager with explicit owning-task release.
5. Overpass already had the lighter query and up to 45s of HTTP budget, while Next.js allowed only 30s. Normal slow upstream calls could outlive the BFF timeout and leave subsequent requests competing with still-running work.
6. `request_json` and `callTravelApi` contained no retry loops. However, the BFF collapsed every HTTP 429 into `provider_rate_limited`, hiding the actual source. Its same-trip in-flight set also produced a separate application 429 for overlapping requests.
7. The client already used a synchronous ref guard, disabled pending button, `finally` cleanup and explicit button activation only. The shared Button defaults to `type="button"`. No useEffect trigger, automatic retry, double form submission or client duplication bug was found.

## 2. Files changed by this fix

| File | Change |
| --- | --- |
| `backend/app/core/config.py` | Empty credential defaults; correct geocoding base fallback |
| `backend/.env`, `.env.local` (ignored) | Migrated private credentials; matching internal key; configured Overpass endpoint |
| `.env.example` | Removed real internal key and misplaced backend-only URL entries |
| `backend/app/core/rate_limit.py` | Bounded queue/deadline, cooldown, cancellation-safe ownership and context manager |
| `backend/app/api/v1/places.py` | Scoped lock lifecycle; effective 5 km response radius; request log |
| `backend/app/core/provider_http.py` | Safe provider timeout/throttle diagnostics; existing provider 429 code retained |
| `backend/app/core/logging.py` | Enable concise application INFO logs without duplicate handlers or outbound URL logging |
| `backend/app/providers/places/overpass.py` | Safe hostname/count/error logs; existing lighter query retained and formatted |
| `src/lib/destinations/backend.ts` | 60s discovery budget; allowlisted local/provider 429 propagation; no retries |
| `src/app/api/trips/[tripId]/discover-places/route.ts` | Persisted-first reads and same-user/trip in-flight promise sharing |
| `src/lib/destinations/discovery-errors.ts` | Distinct safe local/provider saturation messages |
| `backend/tests/test_discovery_limits.py` | Focused concurrency, cancellation, ownership, timeout and route cleanup tests |
| `backend/tests/test_config_secrets.py` | Empty secret defaults and private environment loading |
| `backend/tests/test_open_providers.py` | Update stale query/sequential/concurrency expectations to current behavior |
| `tests/destinations-bff.test.mjs`, `tests/destinations.test.mjs` | 429 attribution, no retries, timeout budget, coalescing and UI messages |
| `backend/README.md`, this report | Current behavior, verification and operational instructions |

Existing unrelated working-tree changes, including auth/session debug edits, Step 8 files and editor settings, were left in place. This fix does not modify `src/lib/auth/session.ts`, Supabase clients, proxy, RLS, proof signing or persistence schema/functions. No dependency was added.

## 3. Exact behavior changed

- Initial discovery can acquire immediately. Concurrent different-trip requests wait instead of receiving an immediate lock-held 429.
- There is one total **8s deadline** for acquisition and any remaining **2s start interval**. At most **four pending acquisitions** are admitted. Saturation beyond the queue/deadline still returns HTTP 429 / `PLACES_RATE_LIMITED`.
- Every success, provider failure, runtime/validation failure and cancellation after acquisition releases the owning task's slot. Cancelled waiters do not release another request's lock. Setup cancellation, including during cooldown, also releases safely.
- Same-user/same-trip BFF requests first check persisted places, then share an existing search/persistence promise. Both callers receive the same result or safe error; one backend request and one signed write occur. In-flight state clears on success or failure.
- Discovery's BFF timeout is now 60s, larger than the backend's 8s waiting plus 45s provider budgets. Destination autocomplete's 15s BFF budget and 60/minute backend limiter were not changed.
- The provider's existing bounding-box query, 5 km cap, 20 normalized results, bounded raw output, center-only geometry, User-Agent, Haversine filtering and deduplication remain. The response now reports the effective capped radius rather than advertising 10 km while querying 5 km.
- Actual upstream HTTP 429 remains `PLACES_PROVIDER_RATE_LIMITED`. Both codes survive the BFF and receive separate safe UI messages. Unknown/raw error messages never reach the browser. No automatic retries or endpoint rotation were added.

## 4. Why the locking is safe

The lock remains per backend application/worker. Only its owning asyncio task can release it. A context manager releases in `finally`, and `begin_discovery` handles `BaseException` so cancellation cannot strand an acquired lock. It tracks whether acquisition actually succeeded, preventing a cancelled/timed-out waiter from releasing another task's active slot. Queue length and total waiting time are both bounded; the provider still sees one active discovery at a time. No background queue, Redis, worker service or new dependency was introduced. Multi-worker deployments still need shared coordination; use one backend worker for the current process-local protection.

## 5. Duplicate requests

No client bug was found. Real browser verification rendered the existing `DestinationPlaces` inside a form and activated its button twice synchronously: exactly one request was sent, the button was disabled while pending, the form was not submitted and no effect/rerender initiated discovery. Its state reset after local/provider throttling and outages. The server's previous same-trip immediate-rejection guard was improved to share the active result for legitimate overlapping tabs/requests.

## 6. Application 429 versus external 429

The historical HTTP status alone cannot conclusively identify the source because the old BFF flattened both. The old immediate-rejection limiter and same-trip set could produce application 429s; actual Overpass throttling was also mapped to 429.

After the fix:

| Source | Backend / BFF code | Diagnostic |
| --- | --- | --- |
| Local queue capacity or wait deadline | `PLACES_RATE_LIMITED` | `discovery_local_rate_limited reason=queue_full` or `wait_timeout` |
| Overpass HTTP 429 | `PLACES_PROVIDER_RATE_LIMITED` | `places_provider_rate_limited status=429` |
| Overpass timeout/connection failure | `PLACES_PROVIDER_UNAVAILABLE` → safe BFF `provider_unavailable` | `places_provider_timeout` or transport failure |

The latest explicit live requests did **not** return local 429. A fresh backend logged `discovery_slot_acquired wait_ms=0`, one `overpass_calling`, `places_provider_timeout`, `PLACES_PROVIDER_UNAVAILABLE` and `discovery_slot_released`, returning HTTP 503 after about **42 seconds**. The configured `overpass.private.coffee` status endpoint also timed out from this environment. A status-only check of `overpass-api.de` returned 406; no automatic switch was made. These observations establish upstream/network unavailability during testing, not permanent provider downtime.

## 7. Tests added and updated

Focused tests cover: first acquisition/release, rapid sequential calls waiting successfully, concurrent serialization, excessive-wait local 429, bounded pending queue, wrong-owner release denial, cancellation while waiting/in cooldown/active, cooldown deadline expiry, upstream HTTP 429 with its distinct code, timeout, invalid provider response, runtime/Pydantic failure cleanup, no provider retries and successful subsequent requests.

BFF tests cover distinct 429 codes without leaking messages, one fetch per attempt, the 60s budget, shared requests/writes for overlapping owned-trip calls and cleanup after success/throttling. Existing canonical-coordinate, authentication, ownership, persisted reuse, HMAC, PostgreSQL RLS and error tests remain passing. Credential tests ensure source defaults are blank and private environment values load as masked secrets.

## 8. Validation executed

**199 passing Python/Node tests** in total; external provider calls in automated tests are mocked.

| Command / check | Result |
| --- | --- |
| Backend `.venv/Scripts/python.exe -m pytest -q` | 123 passed |
| Backend Ruff check and format check | Passed |
| `npm.cmd run test:destinations` | 26 passed |
| `npm.cmd run test:accommodations` | 19 passed |
| `npm.cmd run test:food` | 13 passed |
| `npm.cmd run test:auth` | 9 passed |
| `npm.cmd run test:trips` | 9 passed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run build` | Passed |
| Actual UI in Chrome, mocked transport | All single-click/double-activation/error/recovery checks passed; no page errors or console warnings |
| WCAG axe scan of discovery UI | Passed |
| Explicit live FastAPI → configured Overpass | Safe provider-timeout 503; immediate lock acquisition and release verified |

No mypy or pyright configuration/check command is present. Ruff and the configured frontend scripts were used. Browser and live evidence are in ignored `.qa/discovery-browser-result.json`, `.qa/verify-discovery-browser.cjs`, `.qa/discovery-live-result-8011.json` and `.qa/credential-migration-check.json`. The temporary verification server on port 8011 was stopped; existing development servers were left running.

## 9. Remaining limitations

Public Overpass availability remains external to the application. It timed out during this session, so a fresh live provider result and an authenticated browser → hosted Supabase discovery/save round trip could not be established. Mocked success paths, real local PostgreSQL proof/RLS behavior and browser rendering were verified independently. No places were fabricated, demo fallback enabled or hosted user data written for verification. Restart the existing services to ensure they load the changed code and environment; an older process may retain prior state/settings. The previous internal key remains intentionally unchanged until a coordinated rotation.

## 10. Manual verification

1. Restart FastAPI from the repository root: `backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload --reload-dir backend`.
2. Restart Next.js with `npm.cmd run dev`. The private root internal key and backend internal key must match the restricted database application secret.
3. Sign in normally, open an owned trip with confirmed coordinates and choose Overview. If persisted places already exist, they should display without Overpass calls.
4. For a trip without persisted places, open the browser Network panel and click **Discover places once**. Confirm one `POST /api/trips/<tripId>/discover-places`; while pending, its button must be disabled.
5. With a responsive provider, expect `discovery_slot_acquired`, `overpass_completed normalized_places=...`, `discovery_slot_released`, BFF `discovery_persisted`, HTTP 200 and visible cards. Reload to verify persistence with no new Overpass request.
6. If HTTP 429 occurs, inspect its safe JSON code: `PLACES_RATE_LIMITED` means bounded local saturation; `PLACES_PROVIDER_RATE_LIMITED` means actual upstream throttling. Do not immediately repeat clicks.
7. If the current endpoint still times out, expect safe provider-unavailable handling and slot release. Check provider/network availability and, if choosing another approved instance, change only backend `OVERPASS_API_URL` and restart FastAPI. No automatic instance rotation occurs.

## 11. Recommended commit message

`fix: make place discovery cancellation-safe and load secrets from env`

Stage only the reviewed source/test/docs changes for this fix. Keep real environment files and private `.qa` artifacts out of Git, and review the pre-existing unrelated working-tree changes separately.
