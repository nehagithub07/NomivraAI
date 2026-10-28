# Step 6 — Open destination intelligence

Updated 28 October 2026. The earlier Google travel-data integration has been replaced with Open-Meteo Geocoding and OpenStreetMap Overpass. The Next.js app stays at the root and the existing FastAPI foundation is reused. No Step 7 features are implemented.

## Migration from Google

Removed production `GooglePlacesProvider`, its timezone model, Google field masks and mapping-key settings. Removed the old autocomplete/resolve/nearby handlers, Google session-token lifecycle, Google attribution SVG and the reference-only saved-card flow. Removed Google mapping secrets from local app environments, and ensured `.env.example` files contain placeholders only. Google OAuth authentication, user avatars and Geist font loading are unrelated and remain unchanged. No Google Cloud account or billing settings were modified.

Retained shared HTTPX lifespan, settings/error/logging foundations, internal-key authentication, Supabase SSR/RLS, signed canonical data, trusted database persistence and the existing seven-step wizard. The temporary separate trip-name workaround is removed; new trips store the canonical destination name. Existing user trip names are preserved.

Historical migration `20261028000200_destination_intelligence.sql` remains intact for databases that installed it. New forward migration `20261028000300_open_destination_providers.sql` converts its schema/functions. Fresh installations apply all migrations once in order; existing installations apply only missing migrations.

## Backend

Main created/modified files:

- `backend/app/providers/geocoding/base.py`, `open_meteo.py`: `GeocodingProvider` interface; normalized search and optional numeric-ID lookup.
- `backend/app/providers/places/base.py`, `overpass.py`: `PlacesProvider.discover_nearby`, bounded QL, node coordinates, way/relation centers, category mapping, metadata allowlist, stable OSM IDs, duplicate suppression and Haversine distance.
- `backend/app/schemas/destination.py`, `place.py`: typed canonical destination and POI models and independent Pydantic validation.
- `backend/app/api/dependencies.py`, `api/v1/destinations.py`, `api/v1/places.py`, `api/router.py`: authenticated routes and provider injection.
- `backend/app/core/config.py`, `provider_http.py`, `rate_limit.py`, `logging.py`, `app/main.py`: configuration, safe errors, bounded network calls and public-service backstops.
- `backend/tests/test_open_providers.py`, `.env.example`, `README.md`: mocked coverage and current setup/terms.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Public service health; `nomivra-api` payload |
| `GET /api/v1/destinations/search` | Open-Meteo search; q 3–100 characters, optional language/country, 1–10 results |
| `GET /api/v1/destinations/{provider_location_id}` | Optional canonical ID lookup |
| `POST /api/v1/places/discover` | Owned-trip BFF supplies coordinates; default 10km/20 POIs, max 20km/30 POIs |

Open-Meteo provides canonical name, display name, string-compatible numeric location ID, country/code, admin1/admin2, coordinates, IANA timezone, feature code and optional population. Missing fields are null. No second provider request is made on normal selection: the BFF signs each canonical search result, providing a tamper-resistant trust boundary.

Overpass sends a constructed query for named tourism attractions, museums, viewpoints, galleries, historic sites/monuments, parks and arts centres. No restaurants or lodging queries. Raw output is bounded to at most 180 objects; normalized output is ≤30. Only useful tags are returned/persisted. Incomplete or unnamed records, outside-radius centers and duplicate IDs are removed; same-name objects within 50m are suppressed. Distance is straight-line and is stored on the trip association, not globally on places.

Shared HTTPX client: 3s connect/pool, 10s ordinary read/write; 12s absolute geocoding budget. Overpass: provider query timeout 18s, HTTP read/write 22s, absolute budget 25s; BFF allows 30s. Errors include safe handling for 400, 429, 5xx/504, network timeout, invalid JSON and Overpass partial-result error remarks. No automatic retries or endpoint rotation.

Public-service protection: 60 geocoding calls/minute/process; one Overpass call in flight per backend process and a 10s start cooldown. BFF prevents concurrent duplicate trip discovery and reuses persisted results. Development limits are process-local; deployment should use one worker until shared rate coordination is designed. No Redis, Celery, ORM or extra paid-provider dependency is added.

## Frontend

- New authenticated BFF handlers: `src/app/api/destinations/search/route.ts` and `src/app/api/trips/[tripId]/discover-places/route.ts`.
- Updated `src/lib/destinations/{validation,backend,bff,proof}.ts`; added `persistence.ts` for owned candidate reads.
- Updated destination step, trip summary, discovery cards, overview page, trip validation/mapping/query helpers and Supabase types. The logo added by the user remains in use.

The destination combobox waits for three characters and debounces 300ms. It supports idle/typing/loading/results/empty/error/selected states, Arrow Up/Down, Enter, Escape and Tab. Stale responses are aborted/ignored; clear/reselect discards old canonical data and proof. Selection uses the signed search result immediately with no UUID billing session or Details request. A single wizard form preserves it through Back and Review edits. Review shows canonical destination, country and timezone, without internal IDs.

Search responses carry a user-bound 24-hour HMAC proof. The existing trip action verifies it and the database independently validates it before saving canonical provider data. Displayed browser coordinates cannot override signed coordinates. A separate optional backend ID lookup is available without imposing redundant normal-flow calls.

Trip Overview loads persisted OSM cards first and makes no provider calls on render/reload. Discover places derives trusted coordinates from an owned, Open-Meteo-resolved trip; the browser submits only an empty action body. It saves normalized places/candidates and returns cards with name, category and distance. Loading/error/empty states are inline. Legacy/unresolved trips remain readable, with discovery disabled. Existing saved candidates are reused rather than automatically refreshed. No maps, ratings, prices, photos or opening-status claims are added.

## Database

Migration: `supabase/migrations/20261028000300_open_destination_providers.sql`.

- Renames destination Place ID to `destination_provider_id`, formatted address to `destination_display_name`, and place primary type to `category`.
- Adds destination provider, country/code, admin1/admin2, feature code and population; reuses coordinates/timezone/enrichment fields. Canonical one-character localized names are supported by the revised destination-name constraint.
- Reuses `places`, adds filtered `metadata` JSONB and conditionally enforces required OSM name/coordinates/category/stable ID fields. Nullable historical Google references remain compatible; no legacy trip is deleted.
- Adds candidate `distance_km`; supports source `overpass`. Unique place IDs, candidate uniqueness, foreign keys, indexes and cascade behavior remain.
- Replaces signed trip/candidate functions to accept only the appropriate new provider/purpose. Upserts real names/categories/coordinates/metadata and trip-specific distance atomically.
- Retains parent ownership RLS and read-only browser grants on global provider tables. Only controlled proof-verified server RPCs write shared data; direct trip INSERT/provider-column updates remain denied. Normal user-owned trip field edits, reads and deletes remain available.
- Private application secret remains required for trusted writes; no service-role key is added. Admin setup SQL is in `backend/README.md`.
- New open-provider data has no Google-style expiry. Historical cleanup is scoped to Google rows and cannot expire Open-Meteo/OSM rows.

Migration was executed and verified in local PGlite PostgreSQL, not against the hosted Supabase project. Apply it and configure the private database secret before live trip/candidate saving. No production schema was mutated automatically.

## Providers, attribution and terms

No API key is required for Open-Meteo's current non-commercial development use or the selected public Overpass instance. The internal application key is still required between Next.js/FastAPI and for trusted persistence. Active environment variables are documented in `backend/.env.example` and the backend README.

Attribution appears beside search/selection, Review/saved destination and live/persisted place cards: **Open-Meteo / GeoNames · CC BY 4.0**, and **© OpenStreetMap contributors · ODbL**. Links point to the relevant provider/source/license.

[Open-Meteo terms](https://open-meteo.com/en/terms) and [public Overpass guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) are documented, including non-commercial access limits, attribution/licensing, fair use, lack of public-service SLA and the need for appropriate commercial/high-volume hosting or providers later. No claim of unlimited-free production use is made. OSM license/share-alike obligations remain applicable to distributed/adapted data.

## Verification

| Check | Result |
| --- | --- |
| Backend pytest, mocked external HTTP only | **51 passed** |
| Destination/BFF/PostgreSQL tests | **21 passed**, including nested database checks |
| Existing trip tests | **9 passed** |
| Existing auth tests | **9 passed** |
| Backend Ruff lint/format | Passed |
| Frontend lint/typecheck/production build | Passed |
| Browser flow, keyboard, clear/reselect, all seven wizard steps | Passed with mocked browser API/framework edges |
| Responsive overflow/accessibility | Passed at 320, 375, 768, 1024 and 1440px |
| Persistence/reload behavior | Real SQL tests plus browser remount: cards retained; no repeated discovery |
| Running FastAPI health and key validation | Passed |
| Live Open-Meteo search | **200**, Tokyo ID `1850147` and timezone `Asia/Tokyo` |
| Live Overpass | Public endpoint unavailable from this environment: discovery failed safely; direct requests timed out and status endpoint returned 502 |

Total automated Python/Node checks: **90 passing tests**. Python mocks cover normalization, localized/missing fields, ID lookup, bounds, node/way/relation data, metadata filtering, dedupe, distance, provider errors/timeouts, rate limits and concurrent discovery rejection. Search cache tests cover reuse, authentication on cache hits, concurrent requests, cancelled waiters, expiry, eviction, copy isolation and uncached failures. No public Overpass calls run in CI. PGlite tests execute the actual migration chain, pgcrypto, functions, RLS, tamper/expiry/ownership denial, atomic rollback, metadata persistence and legacy-only cleanup. Setup-file tests upgrade all three supported schema stages, save a signed trip and rerun setup while preserving that trip. BFF tests replace framework/session/transport edges while executing real production validation/signing/handler/action code. Discovery error tests distinguish overload, unavailability and persistence failures without exposing raw details.

### Trip-save and search-latency follow-up

Read-only REST probes found the connected Supabase database lacks the Step 6 `destination_provider`/`destination_provider_id` columns and `places` relation. The application calls a Step 6 save RPC, so the missing database upgrade must be applied before live saves can work. Missing-schema errors now show a specific setup message while preserving form values; safe development logs include only the stage and error code.

`npm run db:prepare` generates ignored `.qa/setup-trip-database.sql` with the configured local internal key. The single transaction detects installed Step 5/6 stages, installs missing Step 6 schema, configures the private secret and reloads the REST schema. It is tested for fresh Step 5, historical Step 6 and current Step 6 databases and safe reruns. The generated file contains a secret and stays local. No hosted SQL was executed: administrative Supabase access is not connected.

Search now avoids duplicate Proxy/BFF identity lookups, refreshes cookies within the authenticated BFF, caches recent component queries for one minute, and caches normalized public results in the backend for five minutes. Concurrent identical backend searches share one provider request. Caches are bounded and ephemeral; user proofs are signed separately. HTTPX retains idle provider connections for up to 60 seconds. Browser verification confirms a repeated case-insensitive query returns results without another request, and the existing keyboard, stale-response, wizard and responsive accessibility checks still pass.

Live backend timing in `.qa/search-latency-results.json`: one upstream failure at 3,145 ms, successful uncached search at 4,122 ms, and repeated cached search at 19.7 ms. This measures the local FastAPI search endpoint, excluding browser debounce and Supabase authentication. First-time searches still depend on upstream availability; this does not establish consistently fast cold searches or a successful live authenticated trip save.

Browser evidence uses existing ignored `.qa` tooling: `verify-step6-browser.cjs`, `step6-browser-results.json` and screenshots under `.qa/screenshots/step-6-open`. Live smoke evidence is `.qa/step6-open-live-results.json`. Browser fixtures are not a live authenticated Supabase end-to-end test. Live Open-Meteo was verified; successful live Overpass discovery was **not verified** because of the external endpoint/network failures. No retry loop or paid fallback was introduced.

### Place-discovery follow-up

Live diagnostics exposed two application bugs as well as an upstream outage. The generated type-filter statements were missing semicolons before their `out` statements; a live Overpass parser rejected each with `';' expected - 'out' found`. The corrected filters end before their output statements. A subsequent live response reported insufficient query memory with the original 8MiB allowance, requiring at least 32MiB. The query now requests a bounded 64MiB. Radius, response-count limits, metadata filtering, timeouts, concurrency/cooldown guards and persisted-result reuse remain enforced. Regression checks cover the corrected query structure and memory budget.

The BFF now distinguishes HTTP 429 from general provider failures, and the browser uses a fixed allowlist of recovery messages for outages, rate limits, expired sessions, unavailable trip details and failed persistence. It never renders raw provider/database messages. Browser checks cover these states, retry availability and accessibility in addition to the existing flow; no page errors or console warnings occurred.

The user identified **Mussoorie, Uttarakhand, India** as the failing destination. Live Open-Meteo search returned canonical ID `1262374`, coordinates `30.45498,78.07068` and timezone `Asia/Kolkata`. The configured Overpass instance timed out, and a separate tiny diagnostic returned HTTP 502 explicitly reporting full query workers/queue. Documented Private.coffee and VK Maps instances were checked manually; corrected live Mussoorie queries still timed out. No alternate endpoint was configured without a successful live result. Evidence is in ignored `.qa/mussoorie-*.json` and the local diagnostic response files. Successful live discovery for Mussoorie remains unverified because of external service availability; no fake places, automatic endpoint rotation or retry loop was introduced. No database migration is needed for these query/UI fixes.

## Security and remaining setup

Internal key stays in server-only environment/private database settings. Examples have placeholders; Google mapping secrets are removed from active files. All BFF routes require verified Supabase identity and validate allowed input; POST bodies and query strings are bounded. FastAPI validates the constant-time-compared internal key. URLs/query construction are server-owned, and discovery coordinates come from an owned protected trip row. No unrestricted provider proxy, service-role exposure or wildcard CORS.

Before live persistence: apply migration 3 (and prerequisites if missing), configure the matching private database secret and run the manual authenticated flow. Public Overpass availability is an external limitation; select an appropriate reachable instance via `OVERPASS_API_URL` or host one for deployment. Changing `.env` requires a backend restart. Google Cloud billing/API keys are no longer part of the app's destination setup; this code does not cancel an existing Cloud billing account.

No hotels, food engine, weather, maps, routing, chatbot, AI itinerary, embeddings/RAG, voice or other Step 7 work was added.
