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
4. `20261028000400_accommodation_selections.sql` — Step 7 owned stay selections and restricted signed RPC.
5. `20261029000500_food_selections.sql` — Step 8 multiple saved food associations and restricted signed RPC.

Apply only the migrations that are not already installed, in timestamp order. Do not rerun old migrations after the new schema is installed. No connected production schema is modified automatically by this code change.

For a local app whose database is still at Step 5 or an earlier Step 6/7/8 schema, run `npm.cmd run db:prepare` from the repository root. It creates ignored `.qa/setup-trip-database.sql` using the internal key already in `.env.local`. Run that complete file in the matching project's Supabase SQL Editor as database owner. It installs only the missing Step 6/7/8 stages, sets the private database key, and reloads the REST schema in one transaction. It preserves existing trips and can be rerun after a successful setup. The generated file contains a real secret; keep it private. Do not commit or paste it into chat. `db:prepare` only prepares the file; it does not connect to or modify Supabase.

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

Discovery retains the lighter Overpass QL query: a bounding box capped at 5 km, relevant named tourism/historic/park/arts-centre objects, a 25s provider query timeout and a 32MiB memory request. `out center qt` retrieves at most 50 raw objects without full geometry; normalization returns at most 20 places. The API reports the effective radius. Unnamed/incomplete records and centers outside the circular radius are filtered using Haversine. Category/tag allowlists, stable-ID deduplication and suppression of same-name objects within 50m remain in place. Distance is straight-line, not routing/travel time.

Guards: authenticated access, server-derived coordinates, strict Zod/Pydantic input, 4KiB POST bodies and 2KiB query strings. Persisted candidates are checked first. Concurrent requests for the same authenticated user/trip share one BFF request and signed persistence operation. FastAPI serializes Overpass calls with at most four pending acquisitions, an 8s total acquisition/cooldown deadline and a 2s minimum interval between starts. Ownership and cancellation-safe cleanup prevent stuck or incorrectly released locks. Geocoding remains separately limited to 60 requests/minute. No automatic retries, endpoint rotation or page-load discovery occurs. These guards are process-local; run one backend worker and coordinate limits centrally before multi-instance scaling. Redis is not added.

HTTPX uses one shared lifespan client (3s connect/pool, 10s read/write), retaining at most 10 idle connections for up to 60s; geocoding has a 12s absolute budget. Overpass retains its existing 5s connect/pool, 40s read and 10s write settings with a 45s total provider budget. The discovery BFF allows 60s, covering the 8s acquisition deadline plus that provider budget. Provider failures and partial-error remarks remain safe application errors. Structured discovery logs identify waiting/acquisition/release, endpoint hostname, normalized count, timeout and failure code. They omit URL queries, credentials, cookies and raw provider bodies.

Discovery retains separate `PLACES_RATE_LIMITED` (local queue/deadline) and `PLACES_PROVIDER_RATE_LIMITED` (actual upstream HTTP 429) codes through the BFF and UI. Provider outages, expired sessions, missing destination details and persistence failures retain safe recovery messages. No 429 is retried immediately. Public-provider outages can still prevent first discovery; saved trips and candidates remain intact. See [DISCOVER_PLACES_FIX_REPORT.md](../DISCOVER_PLACES_FIX_REPORT.md) for the diagnosis, tests and live-provider limitation.

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

## Accommodation Engine

Step 7 adds `AccommodationProvider`, `StayApiAccommodationProvider`, `FixtureAccommodationProvider`, typed neutral candidates, hard eligibility filters and deterministic recommendation scoring. The Hotels page is `/trips/[tripId]/hotels`; Overview and Hotels are the only trip navigation tabs. This step searches, compares and saves a preference. It does not create reservations, collect payments or use an LLM.

### StayAPI setup and quota

Create an account through [StayAPI's developer site](https://stayapi.com/developers), obtain a key from its dashboard and follow the [authentication documentation](https://stayapi.com/docs/authentication). As checked on 28 October 2026, the developer page describes **50 one-time evaluation requests**, not a recurring monthly free allocation. Check your actual account allowance before using live search. Nothing here subscribes to a plan or purchases credits.

Set these in **backend/.env only**, preserving the existing internal key and destination settings:

```dotenv
APP_ENV=development
ACCOMMODATION_PROVIDER=stayapi
STAYAPI_API_KEY=<your StayAPI key>
STAYAPI_BASE_URL=https://api.stayapi.com
ALLOW_DEMO_ACCOMMODATIONS=true
ACCOMMODATION_CACHE_TTL_SECONDS=900
ACCOMMODATION_CACHE_MAX_ENTRIES=128
```

Restart FastAPI after changing environment settings. The real key is sent only from FastAPI to the configured HTTPS StayAPI host using `X-API-Key`; redirects are disabled. It never enters Next.js, root `.env.local`, browser requests, examples or logs.

The adapter uses the documented [destination lookup](https://stayapi.com/docs/endpoints/booking/destinations-lookup) and [hotel search](https://stayapi.com/docs/endpoints/booking/search). It resolves the canonical location name/country/region to a source ID, checks labels against the canonical trip, and rejects ambiguous or wrong-country matches. The Open-Meteo ID is never used as a StayAPI ID or overwritten. Only the first result page is requested, with at most 50 candidates; details/reviews/photos are not fetched for every card. A new location can therefore cost two requests; a recent mapping can reduce that to one.

### Explicit demo mode

For development without credentials, choose:

```dotenv
APP_ENV=development
ACCOMMODATION_PROVIDER=fixture
ALLOW_DEMO_ACCOMMODATIONS=true
```

The local environment is configured this way. Fixture properties, prices, reviews and amenities are fictional and labeled **Demo accommodation data**; availability stays unknown. No external request is sent. Fixture monetary units are demo constants, not exchange rates or market price estimates. The sample set covers property classes, multiple property types, low/high review counts, missing data, distance and budget edge cases.

When live requests fail, development offers an explicit **Browse demo stays** action if permitted. It sends `demo: true`; it never silently replaces live inventory. Backend authorization requires the development/test environment and `ALLOW_DEMO_ACCOMMODATIONS=true`. Production (`APP_ENV=production`) rejects all fixture searches even with that flag; the production Next.js BFF independently rejects fixture responses and selections. Backend defaults fail closed to production/StayAPI with no key. No OSM lodging fallback is added: its Step 6 public provider was unavailable in live checks, and it cannot supply live hotel prices or availability.

### Trusted request flow and endpoints

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v1/accommodations/search` | Internal key required; typed trusted trip context, adult count, rooms, currency and preferences; returns normalized ranked candidates |
| `GET /api/trips/[tripId]/hotels` | Verified user and owned trip; reads in-memory results only; cache miss makes no provider request |
| `POST /api/trips/[tripId]/hotels` | Accepts only optional `refresh`/development `demo`; loads authoritative trip through Supabase/RLS, then calls FastAPI |
| `POST /api/trips/[tripId]/accommodation-selection` | Verifies a user/trip/context-bound signed candidate and calls the restricted selection RPC |
| `DELETE /api/trips/[tripId]/accommodation-selection` | Removes only the owned trip's expected selection |

All browser-facing responses are private/no-store. A browser cannot override owner, destination, dates, travelers, rooms, budget or currency. Travelers are treated as adults; no children are inferred. Rooms use `ceil(travelers / 2)`, centralized in `src/lib/accommodations/context.ts`. Hotel nights are checkout minus check-in, not inclusive trip days: April 12–18 is six nights. Stays require 1–90 nights and a check-in no earlier than the current date in the canonical destination timezone. Same-day and unresolved trips show a disabled search state.

### Normalization and display honesty

Money uses Python `Decimal` and decimal strings in JSON. The adapter keeps provider-reported guest score/scale, review count and star class separate. Booking source scores use their ten-point scale; an explicitly supplied rating scale is preserved. Missing metadata remains null; malformed IDs/coordinates/money/ratings are rejected or omitted. Unknown/unsupported property types are not forced into `hotel`.

`price.total_price_value`, when returned, is a quoted displayed stay total. It may exclude local charges; no all-in claim is made. `price.amount` without a stay basis is shown as an **advertised price**, never multiplied into a stay total or treated as a nightly rate. Missing nightly prices remain null. Tax inclusion is not assumed from a tax amount. An absent total cannot earn a price/value comparison, and currencies are never converted or mixed in price filtering/sorting. Availability is shown only from an explicit provider flag for the searched stay; saving a preference does not promise bookability.

Source photo rights are not assumed, so the initial adapter leaves photos unset and uses a local, code-rendered accommodation placeholder. The UI supports validated HTTPS source image URLs for a future permitted adapter. A provider booking button appears only for an actual supplied HTTPS Booking.com link; no link is fabricated from a property ID. Live cards credit **StayAPI · Booking.com source**. No review text, guest identity, scraped hotel pages or payment details are collected.

### Recommendation policy

All scores are product heuristics in `app/services/hotel_policy.py` and `hotel_recommendation_service.py`, not trained values. Hard filters run first: sold-out properties, known star classes outside 3–5, supplied guest scores below 0.70, known incompatible accommodation types and known distances over 30km are excluded. Unclassified hostels, apartments and other stays remain eligible with adequate supplied guest scores; unknown rating/class fields remain honestly unknown. Missing type does not invent a match but receives less preference credit.

| Budget style | Suggested accommodation allocation |
| --- | --- |
| Budget | 28% of total trip budget |
| Balanced | 35% |
| Premium | 48% |

The normal price pool allows 20% above that target. Higher-priced properties can remain when they qualify for Premium using class ≥4, normalized guest score ≥0.80, review confidence ≥0.40 and distance ≤15km. A zero trip budget does not invent an allocation or exclude every property.

| Best Match signal | Weight |
| --- | --- |
| Budget fit | 30% |
| Guest quality | 25% |
| Location | 20% |
| Property preference | 15% |
| Property quality | 10% |

Guest scores normalize by the source scale for scoring only. Review confidence is `min(1, log(1 + count) / log(1001))`; guest quality shrinks toward a 0.70 prior when counts are small or absent. Missing ratings receive a conservative internal signal, never a fabricated displayed rating. Location decays with straight-line Haversine distance. A property's class contributes separately from guest reviews.

One highest overall score receives **Best Match**. **Best Value** combines quality, confidence, distance and relative total cost. **Budget Friendly** needs acceptable quality/confidence and proximity before choosing a low known total. **Best Rated** uses confidence-adjusted guest quality. **Premium** uses class, guest quality and location, never price alone. Ties use stable provider/ID ordering. Explicit guest-rating sort uses normalized numeric rating with confidence as a tie-breaker; recommended/Best Rated use confidence-adjusted quality. Price sorts place unknown or non-comparable currencies last in both directions. All five browser sorts and filters use the loaded pool and make no new search requests.

### Caching, selection storage and provider rights

[StayAPI terms](https://stayapi.com/terms), reviewed 28 October 2026, permit integrating output into customer products within the rights StayAPI holds; third-party material can have separate rights. The implementation chooses conservative storage: no permanent live hotel names, addresses, review scores, photos, prices or availability. Provider destination mappings and normalized inventory stay in bounded process memory, with a default 15-minute lifetime; inventory TTL is configurable from 1 to 30 minutes. Cache keys include verified user, canonical destination, dates, travelers, rooms, currency and actual provider mode. Budget/preference changes can re-rank cached inventory. Concurrent identical searches coalesce; failed requests are not cached as inventory.

UI page loads/reloads, server rendering, selection, sorting and filtering never call StayAPI. Explicit **Find stays** uses recent cache if present. **Refresh prices** deliberately bypasses inventory cache, still reusing the location mapping. Refresh has a 30-second cooldown; cache misses allow six loads/minute/user and two concurrent loads per process. Quota/auth failures pause additional live attempts for 60 seconds, without blocking permitted explicit demo use. HTTPS calls use 3s connect/pool, 15s read/write, 18s per-request and 35s overall search budgets. The Next BFF allows 40s. These controls are process-local; use one backend worker and shared coordination before scaling. No Redis is introduced.

Migration `20261028000400_accommodation_selections.sql` stores a unique primary selection per trip: provider/ID, user-owned search context, selected time and optional **fixture-only** display name. Dynamic prices and availability are absent. Parent-ownership RLS protects reads/deletes; authenticated direct INSERT/UPDATE is revoked. The signed RPC checks verified identity, purpose, expiry and current trip context, locks the parent row, and replaces only the expected existing selection. A changed selection in another tab returns conflict. Invalid input rolls back atomically, and deleting a trip cascades its selection. A browser cannot use a signed candidate for another trip or after changing dates/budget/preferences.

Live selections remain saved after prices expire; their latest name can be shown from valid server cache. Without that cache, the UI shows the saved choice and asks for a deliberate new search for current details. It never refreshes implicitly or presents an old price as current. Fixture selections remain explicitly labeled on Hotels and Overview. Apply the new migration before saving; `npm run db:prepare` produces a single atomic setup file for supported Step 5/6/7 database states and configures the existing internal database secret. The prepared local file contains a secret and must remain private.

### Step 7 verification

Run `npm.cmd run test:accommodations` in addition to the validation commands above. Python tests mock all StayAPI calls; no unit or browser test consumes the evaluation quota. PostgreSQL tests execute the real migration chain, signed selection function, RLS, replacement conflicts, rollback and cascades. Browser evidence under ignored `.qa` covers all five sorts, no-network filtering, demo/quota/empty/error/expired/selected states, keyboard dialogs and six responsive widths. See [STEP7_REPORT.md](../STEP7_REPORT.md) for the final counts, exact files and remaining external setup. A real StayAPI search cannot be claimed until credentials are configured and the integration is smoke-tested with that account.

Primary destination references: [Open-Meteo geocoding fields and lookup](https://open-meteo.com/en/docs/geocoding-api), [Open-Meteo terms](https://open-meteo.com/en/terms), [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL), [public Overpass guidelines](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), [OSM licensing](https://www.openstreetmap.org/copyright). Weather, maps, routing and AI planning remain later steps.

## Food engine

Step 8 adds `POST /api/v1/food/search`, protected by the existing `X-Nomvira-Internal-Key` dependency. Only the authenticated Next.js BFF calls it. The BFF independently loads the owned trip and uses its canonical destination coordinates and saved dietary preferences. Browser input cannot override ownership, coordinates, budget or provider limits.

Add `GEOAPIFY_API_KEY` to **backend/.env only**, choose `FOOD_PROVIDER=geoapify`, and restart FastAPI. Copy variable names/defaults from `backend/.env.example` while preserving existing secrets. Never add a public Geoapify key or copy this key into the root environment. HTTPS and disabled redirects protect the outbound credential. Provider request URLs are not logged.

Without credentials, development can select `FOOD_PROVIDER=fixture` or deliberately choose **Browse demo food spots** after a live search error. `APP_ENV=production` rejects fixture data regardless of the selected source, and the production Next.js BFF rejects it too. No silent live-to-fixture substitution occurs.

Search defaults are 20 results and 5 km. The internal result maximum is 40 and radius maximum is 15 km. Configure the default radius with `DEFAULT_FOOD_RADIUS_METERS`, and the bounded process-memory cache with `FOOD_CACHE_TTL_SECONDS` (default 900) and `FOOD_CACHE_MAX_ENTRIES` (default 128). Identical concurrent loads coalesce; cache misses permit six searches/minute/user and two concurrent searches/process. Geoapify auth/quota failures pause new live searches for 60 seconds. One optional supplemental search can relax missing dietary information; strict dietary mode disables it. Details do not request additional API data.

The provider normalizes restaurants, cafes, bars, pubs, fast food, food courts, cuisines, genuine dietary metadata, names, locations, addresses, and available hours/websites. Ratings, review counts and prices stay null. Haversine supplies provider-independent straight-line distance. Deterministic ranking combines dietary match, cuisine match, distance, category and useful supplied metadata, removing inactive dietary/cuisine weights before normalization. There are no AI/ML calls or guessed dietary guarantees.

The [Geoapify Free plan](https://www.geoapify.com/pricing/) currently advertises 3,000 daily credits and no credit card requirement. [Places credit costs](https://www.geoapify.com/pricing-details/) depend on result count; this integration does not request hundreds of places. Review current terms and limits for deployment. The [Places documentation](https://apidocs.geoapify.com/docs/places/) identifies OSM as its source and permits caching/storage; saved display names retain Geoapify/OSM attribution. No unlimited-free or image/review rights are assumed.

Apply `20261029000500_food_selections.sql` after migrations 1–4 before saving food. It creates `trip_food_selections`, an idempotent unique trip/provider/place constraint, owned-trip RLS and the signed `save_trip_food` RPC. Only saved identifiers, names, category and save time persist; unsaved searches remain transient. `npm run db:prepare` includes this migration and retains the existing private database-key workflow. The generated SQL is private and ignored by Git; run it in the matching Supabase project's SQL Editor without sharing it.

Run `npm run test:food` from the root, and `.venv/Scripts/python.exe -m pytest -q` plus Ruff from `backend`. All provider calls in tests are mocked. See [STEP8_REPORT.md](../STEP8_REPORT.md) for the file list, score weights, browser evidence, security checks and outstanding live activation requirements. Optional Overpass food fallback and on-demand provider Place Details are not needed by this version and were not added.
