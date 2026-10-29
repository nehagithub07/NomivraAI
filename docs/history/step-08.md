# Step 8 — Food & Restaurant Recommendation Engine

Implemented on 29 October 2026. Code, mocked integration checks, PostgreSQL policy tests and responsive UI checks are complete. **Live Geoapify search and hosted saved-place persistence still require external configuration**: no Geoapify key is configured, and a read-only hosted schema probe returned `404 / PGRST205` for `trip_food_selections`. No live provider credits were spent and no hosted database changes were made.

## Provider

- `FoodProvider` defines the provider-independent search contract. `GeoapifyFoodProvider` uses `GET /v2/places`; `FixtureFoodProvider` provides explicitly fictional, coordinate-relative development examples.
- Initial categories are restaurant, cafe, bar, pub, fast food and food court. Dessert normalization is also supported without requesting it by default. Cuisine names use centralized mappings, with readable labels retained for additional provider cuisine categories.
- Geoapify credentials live exclusively in FastAPI settings as `SecretStr`. The outbound request uses HTTPS, finite HTTP timeouts and disabled redirects. Existing HTTP logging suppresses provider URLs, which can contain API credentials. No browser provider calls or public environment keys were added.
- Searches normally request **20** places, with an internal maximum of **40** and a radius default of **5 km**, bounded to **15 km**. There is no pagination or automatic Place Details fan-out. The details sheet displays fields already supplied by search and makes no provider request.
- Dietary searches send Geoapify conditions. If fewer than five eligible confirmed matches are found, a non-strict search can make **one** supplemental general search, still limited to 20 places in the normal BFF flow. Unknown dietary information is labeled honestly. Strict dietary matching disables that supplemental search. Explicit negative metadata is excluded.
- Identical searches reuse bounded process memory for 15 minutes and coalesce concurrent loads. A cache miss permits six searches/minute/user and two concurrent searches/process. Auth and quota errors pause live searches for 60 seconds. No Redis or retry storm was added.
- Fixture mode is explicit through backend `FOOD_PROVIDER=fixture`, or the development UI's **Browse demo food spots** action after an error. Production rejects fixtures in both FastAPI and the BFF. An unavailable live provider never silently becomes demo data.
- Optional Overpass food fallback was omitted. Step 6's destination/attraction integration remains unchanged.

Current development assumptions: Geoapify advertises a free plan with **3,000 credits/day**, no credit card requirement and required attribution. These terms can change; this is not an unlimited-free claim. See [Geoapify pricing](https://www.geoapify.com/pricing/) and [per-API credit costs](https://www.geoapify.com/pricing-details/). The [Places documentation](https://apidocs.geoapify.com/docs/places/) documents category/condition search, OSM sourcing and permission to cache/store results. Geoapify and OSM links appear beside results, in details and beside saved live places.

## Backend

| File | Responsibility |
| --- | --- |
| `backend/app/providers/food/base.py` | `FoodProvider` interface |
| `backend/app/providers/food/geoapify.py` | HTTPS Places search, category/condition requests, defensive normalization, safe error codes |
| `backend/app/providers/food/fixture.py` | Fictional categories, cuisines, diets, distances and missing metadata |
| `backend/app/schemas/food.py` | Bounded request, neutral `FoodCandidate`, scores and response |
| `backend/app/services/food_policy.py` | Category/cuisine/diet mappings, weights and Haversine distance |
| `backend/app/services/food_recommendation_service.py` | Provider selection, cache, filters, scoring, stable sorting, badges and quota backoff |
| `backend/app/api/v1/food.py` | `POST /api/v1/food/search`, protected by the existing internal-service header |
| `backend/app/core/config.py`, `main.py`, `api/router.py`, `.env.example` | Configuration, lifecycle and route registration |

Missing/unusable names, IDs and coordinates are discarded. IDs are rejected rather than truncated. Distance is recomputed from the trusted search center using Haversine. Missing website, hours, price and dietary metadata remain unknown. Geoapify consumer rating, rating scale and review count remain null; no rating filter or rating sort exists. Arbitrary raw provider error bodies are never returned.

## Frontend

- `/trips/[tripId]/food` uses the existing authenticated shell and design. Trip navigation now contains **Overview / Hotels / Food**.
- `src/components/nomvira/food/` provides the workspace, category placeholders, cards, filters, skeletons, attribution and accessible details/removal sheets. No scraped or fabricated restaurant photos are used.
- Filters cover food type, cuisine, dietary preferences, optional provider-indicated matches only, and distance. Multiple trip dietary preferences are preserved. Provider cuisine labels outside the initial list appear as filter choices when returned.
- **Recommended / Distance / Name A–Z** operate locally without provider requests. Filters also refine the loaded pool locally. An explicit **Search food again** action refreshes the provider pool and recommendation scores for changed preferences. Existing badges are hidden while preferences differ from the search that produced them.
- Initial, loading, provider-empty, filtered-empty, unavailable, quota, demo, expired, unresolved-destination, saved and failed-mutation states are implemented. Saving errors retain the current saved list. An ambiguous follow-up read asks the user to reload and check the result.
- Multiple food spots can be saved. Saved names survive reload independently of expiring search results. Removal requires confirmation and deletes one trip association. Details restore keyboard focus to the trigger; successful removal focuses the saved-places heading when its trigger was removed.
- The BFF routes are `/api/trips/[tripId]/food` and `/api/trips/[tripId]/food-selections`. Each independently verifies authentication, same-origin requests, strict bounded input, trip ownership and RLS-backed trip reads. GET and server rendering never initiate a provider search.

`src/lib/food/` owns neutral Zod contracts, filters/sorts, trusted context, safe error messages, backend orchestration and HMAC selection proofs. The frontend has no Geoapify response parsing. Known hours and official HTTPS website links appear in details; there are no guessed open/closed claims or dietary guarantees.

## Database

Migration: `supabase/migrations/20261029000500_food_selections.sql`.

- `trip_food_selections` stores ID, trip ID, provider, provider place ID, saved display name, normalized category and save time. Unsaved search results are not persisted. No coordinates, ratings, prices, photos, reviews or opening hours are copied into this table.
- Saved display names are provider metadata, stored under the Places API's documented OSM caching/storage permission with visible attribution; applicable ODbL obligations remain relevant to distributed data. Search-result metadata otherwise stays transient.
- `UNIQUE(trip_id, provider, provider_place_id)` makes repeated saves idempotent while allowing different places. Owned trip deletion cascades.
- Parent-trip ownership RLS protects SELECT/DELETE. Anonymous access and authenticated direct INSERT/UPDATE are revoked.
- `save_trip_food` uses an empty search path, the existing private HMAC verifier, current authenticated identity, purpose, expiry, parent ownership and current canonical destination/diet context before writing. It locks the parent trip to serialize saves and protect destination-change races.
- `npm run db:prepare` now includes Step 8. The private ignored `.qa/setup-trip-database.sql` has been regenerated without printing its secret. Tests execute upgrades from all five supported migration stages and reruns, preserving trips.

The hosted table was absent during the read-only check. Apply the migration through the established migration workflow, or run the complete prepared private SQL file in the matching Supabase project's SQL Editor. Administrative database access is not connected here; hosted persistence is not claimed as verified.

## Ranking

| Signal | Initial weight |
| --- | --- |
| Dietary match | 30% |
| Cuisine match | 25% |
| Distance | 25% |
| Category preference | 10% |
| Data completeness | 10% |

Inactive dietary and cuisine dimensions are removed and remaining weights normalize to one. Confirmed requested diets score above unknown metadata; missing metadata does not imply incompatibility. Vegan metadata also supports vegetarian matching. Cuisine matching uses supplied categories, distance decays smoothly, and data completeness has a limited influence.

Hard filters run before scores: usable name/location, requested category, radius, explicit dietary conflicts and optional strict dietary matching. Duplicate provider IDs collapse. Score, distance, name and stable provider IDs give deterministic ordering.

The winner receives **Nomivra Pick / Best Match**. Other deterministic badges include **Diet-Friendly**, **Cuisine Match**, **Nearby Pick** and **Cafe Pick**. Nearby Pick requires nearby coordinates and useful supplied metadata; it does not imply consumer-review quality. Nomivra Pick is explicitly explained as the deterministic ranking winner. There are no LLM or ML calls.

## Testing

**180 passing Python/Node tests** across the application, including **27 Food backend tests** and **13 Food domain/BFF/database tests**. All external provider calls in tests are mocked.

| Check | Result |
| --- | --- |
| Backend pytest | 107 passed |
| Food domain/BFF/PostgreSQL tests | 13 passed |
| Destination and database-setup regression tests | 23 passed |
| Accommodation regression tests | 19 passed |
| Trip / authentication regression tests | 9 / 9 passed |
| Python Ruff lint and formatting | Passed |
| Frontend lint and type checking | Passed |
| Next.js production build | Passed, including Food and selection routes |
| Responsive browser / WCAG axe checks | Passed at 320, 375, 768, 1024, 1280, 1440px |
| FastAPI ASGI fixture endpoint | 200, explicitly demo, 11 eligible candidates |
| Live Geoapify account search | Not run: key absent; no live credits consumed |
| Hosted Food table | Missing at read-only probe; SQL prepared for deployment |

Backend coverage includes restaurant/cafe/bar/multiple-category search, all dietary conditions, no results, partial records, new cuisine categories, geometry fallback, unsafe websites, invalid IDs, null ratings, timeout, 401/403, 429, 5xx, redirects, filtering, scores, dynamic weights, labels, stable sorting, strict diet, controlled fallback, cache coalescing and fixture production guards. The required vegetarian-vs-nearby-unknown, Japanese-without-diet and no-preferences ranking cases pass.

Database/BFF coverage executes real PostgreSQL migration/HMAC/RLS behavior: multiple saved places, duplicate saves, signed name/category identity, forged/expired/wrong-purpose/current-context proofs, other-user and anonymous isolation, direct-write denial, scoped removal, rollback and cascade deletion. BFF tests also reject browser ownership/coordinate/budget overrides, hide raw errors, enforce internal-service authentication, validate provider contracts and disable production fixtures.

Browser checks use actual production UI components with fixture output from FastAPI; framework and API transport are mocked. They verify skeletons, demo labels, no fake ratings or rating sorts, all three sorts, category/cuisine/diet/distance controls without searches, details focus, multiple saves, saved-state reload without search, confirmation/cancel/remove, failed save preservation, empty/error/quota recovery, expiry, all six widths and accessible mobile sheets. There were no page errors, console warnings, horizontal overflow or WCAG axe violations. This is not a live authenticated Supabase/Geoapify round trip.

Ignored browser evidence is under `.qa/verify-step8-browser.cjs`, `.qa/step8-browser-results.json`, `.qa/food-browser-fixture.json` and `.qa/screenshots/step-8/`. Repeatable domain/security/database tests are included under `tests/food*.mjs` and `backend/tests/test_food.py`.

## Security

- Geoapify key: backend environment only. New environment placeholders exist only in `backend/.env.example`.
- Internal key: existing server-only `X-Nomvira-Internal-Key`, never sent to browsers. Selection proofs contain signatures, not secrets.
- Trusted location: browser supplies trip ID and bounded preferences; the BFF loads owner-verified canonical trip coordinates through Supabase/RLS.
- Saved selections: both BFF and PostgreSQL validate signed identities/context; anonymous users and other owners cannot access associations.
- Provider responses: safe normalized error codes; no raw responses, request URLs or credentials in application logs.
- No Google Places, Yelp scraping, restaurant-site scraping, fabricated consumer ratings, guessed open/closed status or dietary guarantees.

## External activation

1. Apply migration 5 after the preceding migrations, or run the already prepared private `.qa/setup-trip-database.sql` in the matching Supabase SQL Editor. Do not share or commit that generated file.
2. Set `GEOAPIFY_API_KEY` and `FOOD_PROVIDER=geoapify` only in `backend/.env`, then restart FastAPI. Retain the existing internal key and other provider settings. No real environment files were overwritten.
3. Open a saved trip, choose **Food**, and click **Find food spots**. Complete one deliberate live search/save/reload/remove smoke test after both external setup steps.
4. For development without a key, choose `FOOD_PROVIDER=fixture` or use the explicit **Browse demo food spots** action in development. Production disables demo food data.

Work stops at Step 8. No itinerary scheduling/generation, reservations, payments, chatbot, weather, routing, budget optimizer, RAG, voice or PDF work was added.
