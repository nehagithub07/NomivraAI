# NomviraAI destination intelligence — open providers

Python **3.12+**; verified with Python 3.13 on Windows. Next.js remains at the project root. FastAPI owns travel providers; Supabase continues to handle authentication, RLS and trip persistence. No Google Maps key, Google Cloud billing or paid mapping API is required by this implementation. Existing Google OAuth sign-in is unrelated and remains available.

## Providers and access terms

| Responsibility | Adapter | Public endpoint |
| --- | --- | --- |
| Destination search, coordinates and timezone | `OpenMeteoGeocodingProvider` | `https://geocoding-api.open-meteo.com/v1/search` |
| Optional canonical ID lookup | Same geocoding adapter | `https://geocoding-api.open-meteo.com/v1/get?id=…` |
| Attractions, museums, parks and historic POIs | `OpenStreetMapOverpassProvider` | Configurable `https://overpass-api.de/api/interpreter` |

**Free/no-key public access suitable for current non-commercial development, subject to provider usage and licensing policies.** This is not an unlimited-free production service claim.

[Open-Meteo's terms](https://open-meteo.com/en/terms) restrict free service access to non-commercial use and list limits below 10,000 calls/day, 5,000/hour and 600/minute; review the current terms before deployment. Data is provided under CC BY 4.0 and the geocoding source is GeoNames. A commercial product, advertising, subscriptions or higher traffic requires a suitable provider plan, licensed service or self-hosted alternative. This step does not add weather.

[Public Overpass infrastructure](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) is shared, subject to rate limits, overload and timeouts, and has no production SLA. The operator discourages treating its public instance as the backend for a broadly deployed app. Keep current use to development; review/self-host or select an appropriate service before scaling. Set an identifying `PROVIDER_USER_AGENT`, ideally including a real project contact/URL; never invent contact details. Instances can be changed through configuration, not browser input. No automatic endpoint rotation or retry storm is implemented.

[OSM data is ODbL](https://www.openstreetmap.org/copyright). Attribution and applicable share-alike obligations apply to distribution/adapted databases. UI credits link to the provider/source and license:

- Search, selection, Review and saved destination: **Open-Meteo / GeoNames · CC BY 4.0**.
- Discovered and persisted cards: **© OpenStreetMap contributors · ODbL**.

No public Nominatim autocomplete, maps, tiles, routing, ratings, reviews, fabricated photos, hotel availability or AI content is used.

## Run locally

From the repository root in PowerShell:

```powershell
py -3.13 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
# Only if the real environment files do not already exist:
Copy-Item backend/.env.example backend/.env
```

Preserve existing `.env` files instead of overwriting configured values. Generate an internal secret if you do not already have one:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the **same** value in root `.env.local` and `backend/.env`. This is your application secret, not a provider API key. It is also needed in the restricted database configuration below. Do not commit real values.

Root `.env.local` (retain existing Supabase settings):

```dotenv
NOMVIRA_API_URL=http://127.0.0.1:8000
NOMVIRA_INTERNAL_API_KEY=<random secret of at least 32 characters>
```

`backend/.env`:

```dotenv
NOMVIRA_INTERNAL_API_KEY=<same internal secret>
FRONTEND_ORIGIN=http://localhost:3000
OPEN_METEO_GEOCODING_URL=https://geocoding-api.open-meteo.com/v1
OVERPASS_API_URL=https://overpass-api.de/api/interpreter
PROVIDER_USER_AGENT=NomviraAI/0.1
DEFAULT_POI_RADIUS_METERS=10000
MAX_POI_RADIUS_METERS=20000
```

Terminal 1:

```powershell
npm.cmd install
npm.cmd run dev
```

Terminal 2:

```powershell
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload --reload-dir backend
```

Next.js runs at http://localhost:3000 and FastAPI at http://127.0.0.1:8000. On macOS/Linux use `python3`, `backend/.venv/bin/python` and `npm`. `tzdata` supplies IANA timezone definitions on Windows. Restart FastAPI after changing `backend/.env`: Python code reload does not reload environment-only edits. Restart Next.js after server environment changes if they are not picked up automatically.

Health is public and does not contact providers: `GET /health` returns `{"status":"ok","service":"nomivra-api"}`. Provider endpoints fail closed without the internal key. Keep FastAPI private/loopback, restrict deployment ingress to Next.js and use TLS between deployed services. Browser code never receives the internal key. No CORS middleware is needed; `FRONTEND_ORIGIN` records deployment intent rather than granting browser access.

## Database migration and deployment

Apply migrations **once in timestamp order**, through the existing Supabase migration workflow:

1. `20261028000100_create_trips.sql` — Step 5.
2. `20261028000200_destination_intelligence.sql` — historical Step 6 foundation, needed by the forward migration.
3. `20261028000300_open_destination_providers.sql` — provider-neutral/open-provider replacement.

If 1 and 2 are already installed, apply only 3. Do not rerun old migrations after the new schema is installed. No connected production schema is modified automatically by this code change.

For a local app whose database is still at Step 5 or the historical Step 6 schema, run `npm.cmd run db:prepare` from the repository root. It creates ignored `.qa/setup-trip-database.sql` using the internal key already in `.env.local`. Run that complete file in the matching project's Supabase SQL Editor as database owner. It installs only the missing Step 6 stages, sets the private database key, and reloads the REST schema in one transaction. It preserves existing trips and can be rerun after a successful setup. The generated file contains a real secret; keep it private. Do not commit or paste it into chat. `db:prepare` only prepares the file; it does not connect to or modify Supabase.

The forward migration renames `destination_place_id` to `destination_provider_id` and formatted address to `destination_display_name`; it adds provider, country/code, admin1/admin2, feature code and population. Existing coordinates/timezone/enrichment fields are reused. New trips save canonical `destination_name`, display name and all useful normalized Open-Meteo metadata. The Google-only workaround requiring a separate trip-name field is removed. Older trips keep their names and data; previous IDs are tagged as legacy Google IDs and never sent to open-provider endpoints. Unresolved/legacy destinations remain readable with discovery disabled. Re-confirming a saved legacy trip's destination is not added here.

`places` retains its provider/ID unique key and gains `category` (renamed from primary type) and filtered `metadata`. New OSM records require names, coordinates, stable `node/…`, `way/…` or `relation/…` IDs and recognized categories. Older expired Google reference rows may retain nullable fields; conditional constraints preserve them without weakening new OSM requirements. Trip candidates retain category `attraction` as a pool grouping, source `overpass`, and trip-specific straight-line `distance_km`. Actual museum/park/etc. category lives on the place.

Open-provider metadata is persisted and reused on reload; no Google-style 30-day expiry applies to new rows. Historical Google cache cleanup, if installed, is retained and explicitly scoped to legacy Google rows. It cannot erase Open-Meteo/OSM enrichment. Continue any existing legacy retention job while it is needed; no such job is required for new open-provider rows. Historical migration 2 remains immutable.

### Trusted writes with the existing user-scoped Supabase client

Global `places` and candidate tables have SELECT-only application grants. Candidate RLS requires an owned parent trip; place reads require a visible candidate association. Direct trip INSERT is revoked, and normal user-authored UPDATE columns remain explicitly granted; browser credentials cannot overwrite canonical provider metadata. Existing ownership policies and normal trip reads/edits/deletes remain in force.

The BFF signs canonical provider results with HMAC-SHA256. `create_resolved_trip` verifies user, purpose and expiry, then reuses Step 5's atomic trip/interests function. `persist_trip_place_candidates` verifies a short-lived signed batch and parent ownership, filters metadata and upserts places/candidates transactionally. Both are narrow `SECURITY DEFINER` functions with empty search paths and no PUBLIC/anonymous execution. No Supabase service-role key is introduced.

As database owner, securely set the same internal secret used by both apps:

```sql
insert into nomvira_private.application_secrets(name,value)
values ('internal_api_key','<same random internal secret>')
on conflict(name) do update set value=excluded.value;
```

The private schema/table are inaccessible to application roles and must not be added to exposed Supabase schemas. Restrict administrative SQL/history access. Rotate all copies together; in-progress proofs then expire immediately. A missing database secret allows search but prevents trip/candidate saves safely.

## Request flow and limits

| Endpoint | Access and behavior |
| --- | --- |
| `GET /api/v1/destinations/search?q=Tok&language=en&limit=8` | Internal key; 3–100 characters; limit 1–10; optional uppercase ISO country code |
| `GET /api/v1/destinations/{provider_location_id}` | Internal key; optional canonical lookup for a numeric ID |
| `POST /api/v1/places/discover` | Internal key; latitude/longitude; default 10km and 20 results; max configured radius ≤20km and max 30 results |
| `GET /api/destinations/search` | Browser-facing authenticated Next.js BFF; validates/sanitizes query and returns signed canonical suggestions |
| `POST /api/trips/[tripId]/discover-places` | Authenticated BFF; derives coordinates from the owned trip, reuses persisted candidates, otherwise discovers and saves |

Search uses 300ms debounce and starts at three characters. Abort/sequence guards discard stale requests. The wizard reuses recent signed suggestions in component memory for one minute (at most 32 queries); a repeat query appears immediately without a request. The backend caches public normalized results for five minutes (at most 128 queries) and coalesces identical in-flight searches. Failures are not cached. Browser proofs stay user-bound and are signed separately from the shared public cache. Each BFF request verifies identity and refreshes cookies once in its route handler; these API paths avoid a duplicate Proxy authentication lookup. No session token, provider billing key or second Details call is needed: selection uses the canonical signed result immediately. Proofs last 24 hours and are reverified at save. Editing/clearing discards the selection/proof. The server/database ignore browser-modified canonical coordinates and name.

Autocomplete queries are not persisted or DB-cached. All search caches are bounded, expire, and clear on process/component teardown. First-time searches still depend on the upstream provider's availability and latency. Destination IDs are provider-compatible strings. Country/admin/timezone/population fields may be null. Display names join distinct name/admin1/country parts. Invalid/unavailable IANA timezone becomes null; PostgreSQL computes a date-specific UTC offset from the selected start date when the timezone is available.

Discovery sends a constructed Overpass QL query with `around`, relevant tourism/historic/park/arts-centre tags, an 18s provider timeout and an 8MiB provider memory request. Node output includes coordinates; way/relation output requests center+tags, not full geometry/member lists. Raw output is bounded to at most 60 of each object type (180 total); the normalized app result is ≤30. Unnamed/incomplete records and centers outside the radius are filtered. Categories and metadata tag allowlists are centralized. Results deduplicate by stable provider ID and suppress same-name objects within 50m; the bounded candidate batch is ordered by Haversine distance. Distance is straight-line, not routing/travel time. No expensive entity-resolution engine is added.

Guards: authenticated access, server-derived coordinates, strict Zod/Pydantic input, 4KiB POST bodies, 2KiB query strings, a process-local BFF in-flight set, backend-wide single Overpass request at a time with a 10s start cooldown, and 60 geocoding requests/minute per backend process. No automatic retries, endpoint rotation or page-load discovery occurs. Existing saved candidates are returned without another provider call. These development guards are process-local; run one backend worker and coordinate limits centrally before multi-instance scaling. Redis is not added.

HTTPX uses one shared lifespan client (3s connect/pool, 10s read/write), retaining at most 10 idle connections for up to 60s to reduce repeated TLS connections while typing; geocoding has a 12s absolute budget. Overpass overrides read/write to 22s with a 25s absolute budget; Next allows 30s. Provider 400/429/5xx/timeouts/malformed responses and Overpass partial-error remarks map to safe application errors. Logs contain generated request ID, method, status and elapsed time, not keys, cookies, raw provider bodies or URLs. Cards remain honest: names/categories and distance, without fake ratings, prices, photos or open-now status.

## Validation

From repository root:

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
backend/.venv/Scripts/ruff.exe check backend
backend/.venv/Scripts/ruff.exe format --check backend
npm.cmd run test:auth
npm.cmd run test:trips
npm.cmd run test:destinations
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Provider calls are mocked in Python tests and public Overpass is never required in CI. Node tests execute actual BFF/action/domain code with transport adapters; PGlite runs the real PostgreSQL migrations, HMAC functions and RLS locally. Existing ignored `.qa` tooling supplies browser interaction/accessibility checks. See `STEP6_REPORT.md` for exact results, live-provider observations and limits. A live provider smoke test is distinct from a live Supabase trip-creation end-to-end test.

Primary references: [Open-Meteo geocoding fields and lookup](https://open-meteo.com/en/docs/geocoding-api), [Open-Meteo terms](https://open-meteo.com/en/terms), [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL), [public Overpass guidelines](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), [OSM licensing](https://www.openstreetmap.org/copyright). Stop at destination intelligence; weather, maps, routing, hotels, food recommendations and AI remain later steps.
