# Step 7 — Hotel Recommendation Engine

Implemented on 28 October 2026. The local app uses **explicit fixture mode** because no StayAPI key is configured. Demo accommodation results work through the running FastAPI service. Live StayAPI inventory and hosted Supabase selection persistence require the external setup listed below; neither is claimed as a completed live account round trip.

## Provider

- `AccommodationProvider` defines provider-neutral search. `StayApiAccommodationProvider` implements the current destination-lookup and hotel-search REST contracts with backend-only `X-API-Key`. `FixtureAccommodationProvider` supplies clearly fictional development cases without network requests.
- The Open-Meteo destination remains canonical. StayAPI lookup checks city/country/region labels and uses its own destination ID. Ambiguous or wrong-country responses fail safely. Mappings stay in a short-lived server cache.
- Supported configured modes are `stayapi` and `fixture`. No silent substitution occurs. Development can deliberately choose **Browse demo stays** after a live failure, guarded by `ALLOW_DEMO_ACCOMMODATIONS`. Backend production mode and the production BFF reject fixtures. Fixtures never report confirmed availability.
- 401/403, 429, timeouts, malformed responses and 5xx become safe application errors. Quota/auth failures pause live attempts for 60 seconds. Existing results and selections remain usable. No automatic fallback calls consume additional quota.
- StayAPI's current [developer page](https://stayapi.com/developers) describes a one-time 50-request evaluation allocation. A cold lookup/search can consume two requests; subsequent mapped searches can consume one. Filters and sorts consume none. No live quota was spent by implementation tests.
- Optional OSM lodging is deliberately omitted. Its public Step 6 instance remained unreliable in live checks and cannot supply price, guest reviews or availability.

## Backend

| Files | Responsibility |
| --- | --- |
| `backend/app/providers/accommodations/base.py` | Accommodation provider interface |
| `backend/app/providers/accommodations/stayapi.py` | Secure requests, destination matching, normalization and error handling |
| `backend/app/providers/accommodations/fixture.py` | Fictional classes, property types, missing fields and budget/distance/review cases |
| `backend/app/schemas/accommodation.py` | Typed trusted requests, Decimal money, neutral inventory, scores and responses |
| `backend/app/services/hotel_policy.py` | Central weights, budget allocations, quality and occupancy assumptions |
| `backend/app/services/hotel_recommendation_service.py` | Provider orchestration, eligibility, scores, badges, deterministic sorting, quota protection |
| `backend/app/core/accommodation_cache.py` | Bounded expiring memory and shared in-flight loads |
| `backend/app/api/v1/accommodations.py` | `POST /api/v1/accommodations/search`, internal-service authentication |
| `backend/app/core/config.py`, `main.py`, `api/router.py`, `.env.example` | Explicit provider configuration and shared HTTPX lifecycle |
| `backend/tests/test_accommodations.py` | Mocked provider, normalization, ranking, security and cache behavior |

Hotel nights are checkout minus check-in, independently of inclusive trip days. Travelers are adults; rooms use `ceil(travelers / 2)`. Stays require 1–90 nights, with today's date interpreted in the canonical destination timezone. All money uses `Decimal`; JSON uses decimal strings. Guest scores retain the original scale and never become star classifications. Missing values are omitted, not invented. A source display amount with an unspecified basis remains an advertised amount, not a nightly rate or calculated stay total. Different currencies are not converted or mixed in budget comparisons.

Provider requests have finite connect, read and overall budgets. Cache misses allow six searches/minute/user and two concurrently per process. Same-search loads coalesce. A manual refresh has a 30-second cooldown. No Redis, background retries, scraping, reservations, payment handling or LLM calls were added.

## Frontend

- `/trips/[tripId]/hotels` is a real authenticated page. Shared trip navigation exposes **Overview** and **Hotels** only. Overview displays a saved-stay summary when available.
- `src/components/nomvira/hotels/` adds the workspace, cards, filters, skeletons, details, selected-stay summary and accessible replacement confirmation. It reuses the existing light theme, uploaded logo, shell, inputs, buttons and Radix sheet/dialog behavior. The Sheet close label is now customizable with the existing navigation label retained as default.
- Filters cover star class, stay-price range, type, normalized guest-score threshold and distance. Desktop shows a sidebar; mobile uses a keyboard-accessible sheet. Five sorts use the loaded normalized pool. Neither action searches again.
- Cards prioritize a known stay total over nightly price, separate stars from source guest scores/review counts, show only genuine supplied fields, and use a neutral property-photo placeholder. No property images are generated or copied without established source rights. Booking links appear only when actually supplied and validated.
- Explicit initial/loading/results/filtered-empty/provider-empty/unavailable/quota/demo/selected/expired states are implemented. Quote expiry removes dynamic results and prevents selection. A failed replacement preserves the previous choice and current results. A replacement must be confirmed; removal is scoped to the current owned selection.
- `src/lib/accommodations/` supplies shared schemas, integer-minor-unit price comparisons, local filtering/sorting, context, safe error messages and server orchestration. The browser never parses StayAPI's response structure.
- Authenticated BFF handlers are `/api/trips/[tripId]/hotels` and `/api/trips/[tripId]/accommodation-selection`. The browser cannot supply authoritative owner, destination, dates, occupancy, budget or currency. GET/server rendering/cache reads never contact StayAPI; POST is a deliberate action.

## Database

Migration: `supabase/migrations/20261028000400_accommodation_selections.sql`.

- `trip_accommodation_selections` has one unique primary choice per trip, provider/ID, user-owned search context and selected time. A display name is allowed only for fictional fixtures. Live hotel names, addresses, ratings, photos, prices and availability are absent from permanent rows.
- Parent-trip ownership RLS protects SELECT/DELETE. Anonymous access and authenticated direct INSERT/UPDATE are denied. The restricted `select_trip_accommodation` RPC verifies the existing application HMAC proof, user, purpose, trip, expiry and current context. It uses an empty search path and no browser service-role credentials.
- A parent row lock and expected selection ID protect replacement races. Replacements change the version ID; stale tabs receive conflict. Invalid data rolls back, and trip deletion cascades. The canonical Open-Meteo destination is unchanged.
- StayAPI's [terms](https://stayapi.com/terms) permit integration within the rights it holds while reserving third-party rights. Conservative identifier-only live selection storage avoids assuming permanent source-metadata rights. Inventory and mappings stay in bounded short-lived memory. Selected intent remains saved after quotes expire; the user deliberately searches for new current details.
- `scripts/prepare-trip-database.mjs` / `npm run db:prepare` now includes missing Step 6/7 stages and the existing private database key in one atomic, rerunnable local SQL file. Tests cover installed schema stages 1–4, signed trip saving, retained data and reruns.

The hosted project returned **404 / PGRST205** for the new table during a read-only schema probe. Administrative Supabase access is not connected; the previously chosen manual SQL Editor workflow remains necessary. No hosted DDL or user selections were written automatically.

## Recommendation Engine

| Best Match signal | Weight |
| --- | --- |
| Budget fit | 30% |
| Guest quality | 25% |
| Location | 20% |
| Property preference | 15% |
| Property quality | 10% |

Suggested stay allocations are **28% / 35% / 48%** of the total trip budget for Budget / Balanced / Premium, with **20% tolerance** in the normal price pool. These are documented heuristics. Quality-eligible Premium candidates can exceed the target and are labeled above budget. Unknown prices/currencies do not receive fabricated budget suitability.

Hard filters run before scoring: explicit sold-out status, known class outside 3–5, supplied normalized guest score below 0.70, known incompatible type, excessive distance and unsuitable ordinary prices. Unclassified hostels/apartments/homestays/guest houses are not removed merely for missing stars. Missing classifications, ratings or types remain honestly unknown.

Review confidence is bounded logarithmically by count, with a 0.70 prior for sparse scores. Best Match uses the weighted signals. Best Value rewards quality/confidence/proximity and relative stay cost. Budget Friendly requires acceptable quality and distance before choosing a low total. Best Rated uses confidence-adjusted guest quality, independently of stars. Premium requires class, guest quality/confidence and location; expense alone is insufficient. Explicit Guest rating sort uses normalized numeric scores with confidence as a tie-breaker. Stable provider/ID ties make all orders deterministic. The implementation does not use AI or machine learning.

## Testing

**139 passing Python/Node tests**. Tests mock provider network requests and do not consume StayAPI evaluation credits.

| Check | Result |
| --- | --- |
| Backend pytest, including provider/ranking tests | 80 passed |
| Accommodation domain/BFF/PostgreSQL tests | 19 passed |
| Destination/BFF/database setup regression tests | 22 passed |
| Existing trip tests | 9 passed |
| Existing authentication tests | 9 passed |
| Python Ruff lint and format | Passed |
| Frontend lint and TypeScript | Passed |
| Next.js production build | Passed, including Hotels and selection routes |
| Responsive browser, keyboard and WCAG checks | Passed at all six requested widths |
| Running FastAPI fixture search for Mussoorie | 200, explicitly demo, six nights |
| Live StayAPI account round trip | Not run: no key configured; no live quota consumed |
| Hosted selection table | Missing at read-only probe; prepared SQL requires manual deployment |

- Python coverage exercises lookup/search, matching, no results, partial/malformed data, auth/quota/timeouts/5xx, Decimal normalization, source score scales, review confidence, budget allocations, quality filters, all badges/sorts, occupancy/nights, destination-timezone dates, repeated-search reuse and explicit demo after quota.
- Node tests execute real BFF validation/signing and trusted-context handling, require verified authentication/ownership, reject authoritative browser overrides, preserve safe error codes, disable production fixtures and validate selection proofs before RPC writes. A successful write followed by a failed confirmation read returns an unconfirmed-state message rather than claiming the database was unchanged.
- PGlite PostgreSQL executes the full real migration chain, HMAC, restricted RPC, owner/anonymous isolation, denied direct writes, version conflicts, changed-context/expired/forged proofs, rollback, cascades and the private setup script across schema stages.
- Browser evidence uses actual production UI components and the running FastAPI fixture output with mocked framework/API transport. Checks include no mount search, skeletons, demo labels, five sorts, combined filters without network requests, details focus restoration, confirmation/cancel, selection persistence on remount/reload, failed-save preservation, remove choice, quota/unavailable/demo recovery, expiry, same-day guard, responsive overflow and WCAG axe checks at **320, 375, 768, 1024, 1280, 1440px**. No page errors or console warnings occurred.
- Live local FastAPI returned **200**, provider **fixture**, `demo=true`, **six nights**, eight hotel-preference candidates for Mussoorie, and all five recommendation labels. No live StayAPI request was made.

Evidence: ignored `.qa/hotels-live-fixture.json`, `.qa/hotels-browser-fixture.json`, `.qa/verify-step7-browser.cjs`, `.qa/step7-browser-results.json` and `.qa/screenshots/step-7/`.

## Security

- StayAPI key: backend only, `SecretStr`, HTTPS, no redirect forwarding; never in root/browser environment or browser requests.
- Internal key: server-only Next/FastAPI and inaccessible private database configuration; never included in client proof payloads.
- BFF: independently verified Supabase user, owned trip reads through RLS, bounded strict request bodies, same-origin checks, private/no-store responses and no arbitrary provider proxy.
- Selection: signed canonical provider identity, current user/trip/context and expiry verified independently by BFF and PostgreSQL; no untrusted direct selection writes.
- URLs: HTTPS and known source-domain validation; no arbitrary schemes or embedded credentials. Raw provider/database errors are not shown.
- No direct hotel-site scraping, Google Maps/Hotels billing integration, payment data, Booking.com Demand affiliate API, LLM selection or Step 8 modules.

## Required external setup

1. Run the already prepared private `.qa/setup-trip-database.sql` in the matching Supabase project's SQL Editor, or deploy migration 4 once through your migration workflow if prerequisites and the private key are already installed. Existing trips are preserved. The prepared file contains the internal secret and must not be shared or committed.
2. Open a saved trip, choose **Hotels**, and click **Find stays**. Development demo mode works without StayAPI credentials. Stay selection requires the new schema.
3. For live results, create a StayAPI account, obtain its API key, set backend `STAYAPI_API_KEY` and `ACCOMMODATION_PROVIDER=stayapi`, then restart FastAPI. Perform one deliberate live account smoke test and review the source fields/terms before deployment. No live success, account quota, image permission or production SLA is assumed.

Implementation stops at Step 7. Food, weather, AI itinerary, chatbot, routing, RAG, voice and PDF work remain outside this change.
