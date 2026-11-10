# Steps 16–17 verification and release assessment

Updated 2026-11-10. **Status: BLOCKED.** No infrastructure deployment, secret
rotation or live migration was performed. Offline checks do not establish a
successful hosted end-to-end journey.

## Implemented and checked

- Shared Overpass discovery deadline includes Geoapify; per-endpoint HTTP/QL
  timeouts leave response headroom. Failures never return fixture attractions.
- Hotel lookup uses the canonical destination with country/region context.
  Older food provider constraints produce a safe setup error.
- Structured private logs, request IDs, timings, provider/cache/error counters,
  protected diagnostics, optional Gemini token-cost estimates and usage limits.
- Tests cover missing pricing/token breakdowns, cached/thinking tokens, UTC daily
  limits, timeouts/rate guards, private logs, coalescing and quota-free health.
  Smoke guards cover remote-origin rejection, credential echo prevention and
  preserving preexisting trips during failure cleanup.
- Provider observations include UTC completion times, consecutive failures and
  upstream 429 counts. Offline tests cover timeout/failure tracking and recovery
  for both HTTP providers and the Gemini SDK without making extra live calls.

## Executed checks

| Check | Result |
| --- | --- |
| JavaScript/TypeScript/PostgreSQL tests, Node 24 | 203 passed, including trip-deletion BFF, readiness SQL, ownership/RLS, signatures, preferences, retrieval, deletion and sharing revocation |
| Python tests | 366 passed |
| ESLint, Next.js type generation and TypeScript | Passed |
| Next.js production build | Passed with normal local configuration and with application environment variables blank for CI; final configured build restored |
| Ruff, entire backend application/tests/smoke scripts | Passed after fixing two import blocks and a long attribution string |
| `npm audit --omit=dev --audit-level=high` | No reported vulnerabilities |
| Python `pip check` | Passed; `pip-audit` absent, so no Python advisory audit is claimed |
| Local health/readiness/authorized diagnostics | HTTP 200; unauthorized diagnostics HTTP 401; no provider probes |
| Deployment validators, current local environment | Blocked: development origins/backend environment require production values |

## Real endpoints reached

The monitoring follow-up reused earlier live evidence. A subsequent deep audit
on 2026-11-09 reran the providers, authenticated BFF journey and mobile browser.
It made no live schema changes or hosted deployments.

Earlier checks reached Open-Meteo geocoding/weather, Geoapify places/food,
StayAPI hotels (50 parsed records), configured Google Maps food (5 records),
ORS walking routes, OpenFreeMap styles, Gemini generation/768-dimensional
embeddings, Supabase login and anonymous isolation. Companion returned real
content through configured model failover. These are historical request results,
not ongoing availability claims.

Latest signed-in local-production BFF journey, 2026-11-09:

| Feature | Observed result |
| --- | --- |
| Confirmed account login, signed trip creation, places | Passed |
| Hotel / configured food search | BFF journey returned StayAPI HTTP 402; subsequent provider recheck recovered hotels (50 parsed records), while food returned no usable results; selections still need retesting |
| Itinerary generation | Passed with real Gemini and signed Supabase persistence in the latest run |
| Budget create/read, weather refresh | Passed |
| Companion | Blocked: `COMPANION_SETUP_REQUIRED` |
| Walking-route BFF | Passed for the new saved itinerary |
| Preferences/Memory and Sharing state | Graceful unavailable fallback; storage not verified |
| Export and private-field allowlist | Passed for real saved itinerary/available budget data; populated hotel/food PDF acceptance pending |
| New test-trip cleanup | Passed; existing trips preserved |

Latest direct Overpass probes returned HTTP 504, a timeout and HTTP 406; real
Geoapify-first discovery succeeded. Primary Gemini `gemini-3.8-flash` returned
SDK HTTP 504; `gemini-3.6-flash` generation and 768-dimensional embeddings passed.
Companion provider failover returned real content after about 29 seconds, while
the actual Companion BFF remains blocked by missing tables. The authenticated
model catalog lists both configured generation models, so an invalid model name
was not established. Historical HTTP 503 failures remain evidence of intermittent
availability, not the latest itinerary result. No private payloads are recorded.

Prior Step 15 browser checks exercised actual export/share components at mobile,
tablet and desktop sizes and PDF output with fixtures, not a live trip.
[Mobile screenshot](../assets/export-mobile.png) is labeled accordingly in README.
Signup/email delivery, second-account live RLS isolation, full signed-in browser
mutation acceptance, hosted behavior and post-migration consent/deletion/retrieval/revocation
remain unverified. Offline RLS tests do not replace these.

## Environment, browser and repository audit

- Both real environment files exist, are ignored by Git and are not tracked.
  Required frontend variables and backend provider credentials are configured.
  The internal keys match; no provider key is in the frontend environment or
  named with `NEXT_PUBLIC_`. Values were never printed or committed.
  Six frontend and 24 backend variable names were checked; neither file has duplicates.
- Effective local origins are frontend `http://localhost:3000` and FastAPI
  `http://127.0.0.1:8001`. Backend `APP_ENV=development`, StayAPI and Google Maps
  food are selected, and fixture accommodations are disabled. Production validators
  correctly reject these development origins/settings.
- Missing optional food/weather/usage variables use validated defaults.
  In particular, omitted `FOOD_PROVIDER` selects Google Maps via StayAPI, which
  currently returns HTTP 402. Geoapify food separately passed; it is not silently
  substituted. Empty pricing leaves cost estimates unavailable, not zero.
- Geoapify, ORS, Gemini and Supabase credentials were exercised against real
  endpoints. StayAPI initially returned HTTP 402. A subsequent recheck with the
  already configured key returned HTTP 200 for destination lookup and 50 parsed
  hotel records across 14 real responses. Configured food reached its endpoints
  but returned no usable results for the test query (`empty_results`), so food
  recovery is not established. No key values were changed or secrets rotated.
- Shell Node is 26.12.1, while `.node-version`/package engines require Node 24.
  All Node checks used an explicit Node 24 runtime. Python is 3.13.15.
- Signed-in headless Chrome visited Home, Trips, creation, Settings and nine trip
  pages at 390px width: no uncaught JavaScript exceptions or horizontal overflow.
  Expected Companion 503 was observed. An existing trip's weather returned 409
  `WEATHER_CONTEXT_CHANGED`: its provider ID, coordinates and timezone are missing,
  and its provider is not confirmed Open-Meteo data. No old record was modified;
  a new trip through destination search supplies validated metadata and weather
  passed. A missing browser icon was fixed with an App Router SVG icon; the icon
  returns HTTP 200 and login metadata references it.
- CI now separates frontend/backend checks, pins official action revisions,
  grants read-only repository permissions, uses Node 24/Python 3.13, and excludes
  paid probes, production credentials, deployment and remote migrations. YAML was
  parsed locally; GitHub-hosted workflow execution is not claimed.
- Live unauthenticated Companion reads/writes and invalid backend keys return
  HTTP 401; untrusted origins receive no CORS allowance. Authenticated cross-origin
  and cross-user attack cases also have offline regression coverage.
- Repository responsibilities are documented in the architecture guide. Existing
  domain boundaries and routes were preserved; no production data was moved.
- A read-only catalog diagnostic is tested against missing and protected schemas.
  `npm run db:prepare` generated the private atomic setup file locally; it was not
  applied. See [database repair instructions](../setup/database.md#current-project-diagnosis-and-repair).

## Saved-trip deletion verification (2026-11-10)

- Delete actions are available on My Trips cards and the trip overview. The
  confirmation defaults keyboard focus to Keep trip, blocks duplicate submissions
  and stays open with a safe message when deletion cannot be confirmed.
- The authenticated BFF validates the UUID and an empty JSON body, enforces the
  request origin and deletes using both trip ID and verified owner ID. Missing
  and foreign trips share the same 404 response. Dashboard/list data is refreshed.
- PostgreSQL tests verify owner-only deletion and cascading chat, trip-linked
  memory and sharing cleanup, while account-level preferences remain intact.
  These cascade checks are offline; missing live feature tables remain release gates.
- A signed-in mobile Chrome test created one isolated real trip, verified card
  cancellation/default focus, confirmed deletion from the overview, observed one
  DELETE despite a double click, and checked the redirect/refreshed list. The new
  trip was removed, every preexisting trip remained, and no uncaught JS exceptions
  occurred. Failed browser-runner attempts cleaned up only their isolated trips.
- All 203 JavaScript/SQL tests, TypeScript, scoped ESLint and the production build
  passed after implementation. No migration or live infrastructure change was needed.

## Release gates

1. Connect supported Supabase admin access and verify intended project, live
   schema/history and recoverable backup before conditionally authorized Companion,
   Memory/RAG and Sharing migrations. No admin connection or recovery evidence is
   available. Review rated-food constraint support separately.
2. Verify food result availability and signed hotel/food BFF persistence after provider recovery; resolve primary Gemini timeout/intermittent availability and verify Overpass/network recovery
   or reliable real-provider discovery failover, then repeat affected tests.
3. Configure production origins/environment, provider budgets, log/backup retention;
   verify migrations, ownership, deletion and revocation.
4. Obtain explicit deployment authorization, deploy and pass the full hosted journey
   and mobile/PDF checks before marking READY.

See [operations and recovery](../deployment/deployment.md#operations-and-recovery-steps-16-17)
for diagnostics, limit caveats, migration safety, rollback and incidents.
