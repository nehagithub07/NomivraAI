# Step 9 — AI itinerary generation

Implemented a bounded planning pipeline without changing Supabase authentication,
trip creation, destination discovery, hotel/food provider integrations or their RLS.

## Files created

- `backend/app/providers/llm/{__init__,base,gemini,fixture,prompt}.py`
- `backend/app/schemas/itinerary.py`
- `backend/app/services/itinerary_context_service.py`
- `backend/app/services/itinerary_generation_service.py`
- `backend/app/services/itinerary_validation_service.py`
- `backend/app/api/v1/itineraries.py`
- `backend/tests/test_itineraries.py`
- `supabase/migrations/20261029000600_itinerary_versions.sql`
- `src/lib/itineraries/{context,errors,server,validation}.ts`
- `src/app/api/trips/[tripId]/itinerary/generate/route.ts`
- `src/app/(app)/trips/[tripId]/itinerary/page.tsx`
- `src/components/nomvira/itineraries/itinerary-workspace.tsx`
- `tests/itinerary-fixtures.mjs`
- `tests/itineraries.test.mjs`
- `tests/itineraries-bff.test.mjs`
- `tests/itineraries-db.test.mjs`
- This report. Browser verification assets/results are isolated in ignored `.qa/`.

## Existing files changed

- Backend: `app/core/config.py`, `app/api/router.py`, `app/main.py`,
  `requirements.txt`, `.env.example`, `check_deployment.py`.
- Frontend: `src/lib/destinations/backend.ts` (adds the itinerary endpoint while
  preserving existing search/discovery behavior), `src/lib/supabase/database.types.ts`,
  `src/components/nomvira/trips/trip-navigation.tsx`, trip Overview `page.tsx`.
- Setup/deployment: `scripts/prepare-trip-database.mjs`,
  `scripts/check-deployment.mjs`, `render.yaml`, `package.json`.
- Existing tests: `backend/tests/test_config_secrets.py`,
  `backend/tests/test_deployment.py`, `tests/deployment.test.mjs`,
  `tests/trip-database-setup.test.mjs`.
- Documentation: `README.md`, `backend/README.md`, `DEPLOYMENT.md`.

## Gemini integration and configuration

Uses the official **google-genai 2.34.0** package, pinned in backend requirements,
with `Client(...).aio.models.generate_content`. No deprecated
`google-generativeai` dependency, agent framework, RAG or new frontend package.
The configured default is exactly **`gemini-3.8-flash`**; there is no silent model
or fixture fallback. The provider abstraction can be implemented by another LLM
without changing context construction, validation or persistence.

Add only to **backend/.env**, or Render's private environment:

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-private-key
GEMINI_MODEL=gemini-3.8-flash
```

Never add the Gemini key to Next.js or `NEXT_PUBLIC_*`. Production deployment
checks require the private key and Gemini provider. For an existing Render
Blueprint, add the new secret manually in the service's Environment page;
`sync: false` prompts only on initial Blueprint creation. Restart/redeploy FastAPI
after changing environment settings.

For explicit local testing, use `APP_ENV=development` and `LLM_PROVIDER=fixture`.
This deterministic planner schedules supplied candidate IDs, generates no provider
facts, displays a development label and is rejected in production.

## Trusted context and data boundaries

The browser sends only a UUID request ID and an explicit regenerate flag.
The authenticated BFF loads the owned trip, persisted OSM attractions, saved real
Geoapify food associations and selected real StayAPI association. It never accepts
client-provided preferences, candidates, coordinates or ownership claims.

FastAPI validates and trims the BFF's normalized internal context. Gemini receives:

- Destination name/country/timezone, inclusive dates and traveler count.
- Budget/currency/style, pace, interests, accommodation/diet preferences and
  special requests, which are quoted data rather than instructions.
- Up to 30 saved OSM attraction IDs, names, categories, coordinates, distances and
  genuinely available opening-hours strings.
- Up to 20 saved Geoapify food IDs/names/categories; fresh existing server-cache
  cuisine/diet/proximity metadata enriches them when available. Explicit dietary
  conflicts are excluded; unknown suitability is never treated as confirmed.
- The current selected StayAPI selection ID and transient matching cached details
  when available. A missing/expired selection name or quote stays unknown.
- Deterministic capacity, budget summary and up to 60 straight-line proximity pairs.

User identity, trip UUID, cookies, tokens, keys, database row internals, raw provider
JSON and selection proofs are **not** sent to Gemini. The user ID remains outside
the planning context solely for the backend cost limiter.

Only already-saved food spots are scheduled. No implicit food/hotel search or
Overpass request runs during itinerary generation or itinerary-page rendering.
The existing expiring hotel metadata policy remains: itinerary versions retain a
generic selected-accommodation reference, not permanent live names, prices,
reviews, addresses or availability. Fresh hotel quote arithmetic appears only in
the generation response/client memory and disappears on reload.

## Hallucination and semantic protections

The versioned system prompt is `v1`. Gemini produces a strict Pydantic draft with
dates, day numbers, candidate types/IDs, periods, theme enums and reason enums.
It cannot return arbitrary factual prose, extra prices, addresses, ratings,
opening hours or route durations. The server creates readable titles, summaries,
reasons and notes and hydrates facts from trusted candidates. This avoids relying
on a keyword filter to detect fabricated claims in free text.

Semantic validation requires every inclusive trip date exactly once and in order,
consecutive day numbers, valid chronological periods, supplied type-scoped IDs,
the selected hotel ID, no repeated attraction, no duplicate same-day food venue,
and at least one real attraction. Attraction reasons claiming an interest match
must match an actual trip interest/category. Capacity is centralized in Python:
relaxed **2**, balanced **3**, packed **4** main attractions/day; additionally at
most two food stops and one hotel reference/day, with seven total items maximum.

The engine currently supports **1–14 inclusive days** to bound input, output and
cost. This does not change the existing trip-creation rules. Insufficient
attractions produce free/unscheduled time and warnings. Missing attractions stop
before reservation or an LLM call. Missing food/hotel data remains optional.

Distances are Haversine straight-line proximity, never route distance or travel
time. Provider opening-hours strings are not interpreted as verified availability.
Python `Decimal` computes known remaining budget only for an unexpired selected
hotel quote in the trip currency. There is no currency conversion and no invented
attraction/meal cost. A plan is explicitly not a fully priced itinerary.

## Repair, errors and bounded work

Each SDK request has a 30-second timeout and **one HTTP attempt**. SDK retries and
automatic function calling are disabled. A structurally valid draft failing
semantic checks receives concise error codes and its previous draft for exactly
**one repair**. A second failure returns a safe application error. Malformed
JSON/schema, authentication errors, 429, timeout and provider outages do not cause
automatic retries or repair loops. Total generation is bounded to 65 seconds;
the BFF fetch allows 75 seconds and its Vercel route exports 180 seconds for
authentication, reads and persistence around that call.

FastAPI permits two concurrent generations and one generation start per user per
30 seconds, with bounded in-memory bookkeeping. The database also permits only
one pending generation per trip and enforces a 30-second start cooldown. Logs
contain phases, safe codes/counts and provider status, not model content or secrets.

## Database versioning and RLS

Migration `20261029000600_itinerary_versions.sql` adds `itinerary_versions`,
`itinerary_days` and `itinerary_items`, with trip/day/source foreign keys and RLS.
Authenticated users can read only versions belonging to owned trips. Direct
client inserts, updates and deletes are revoked; anonymous clients have no access.

`begin_itinerary_generation` locks the owned trip and reserves a numbered version.
A trip/request UUID is idempotent; an already-ready request is returned without
another model call. An abandoned pending reservation expires after three minutes
and is recovered by the next deliberate request, without a background worker.
Failed attempts may leave gaps in successful version numbers.

`complete_itinerary_generation` verifies the existing application HMAC proof and
the exact document's SHA-256 digest. This keeps the existing 25KB proof-size limit
while allowing a bounded larger itinerary document. It checks the reservation,
unchanged authoritative trip snapshot, inclusive dates, capacity, duplicate IDs,
source membership/names/facts and hotel ownership before atomically storing days
and items. Changes during generation reject the save. Exactly one ready version
is current; older successful versions remain available. Failures cannot replace
or invalidate a ready current version. Deleting a trip cascades through its history.

`npm run db:prepare` now includes Step 9 and remains safe to rerun across supported
schema stages. No historical migration was rewritten. No hosted database was
modified automatically.

## Validation and manual acceptance

Automated checks cover generation, IDs/types, dates, duplicates, all pace limits,
Decimal math, missing/expired data, actual SDK structured request serialization
with a mocked HTTP transport, safe 401/403/404/429/503 errors, timeouts, malformed
output, repair success/failure, fixtures, reservations, version increment,
document tampering, PostgreSQL RLS/ownership and atomic rollback. No live Gemini
API call is made by tests. Existing feature suites run as regression checks.

Commands:

```sh
cd backend
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m ruff check app tests check_deployment.py
python -m ruff format --check app tests check_deployment.py
cd ..
npm run test:itineraries
npm run test:auth
npm run test:trips
npm run test:destinations
npm run test:accommodations
npm run test:food
npm run test:deployment
npm run lint
npm run typecheck
npm run build
```

The complete frontend test set is also exercised together on Node 24. Browser QA
uses the actual production components with mocked API/framework edges and checks
duplicate clicks, pending/reset states, errors, saved-plan preservation, history,
fixtures, long names, mobile layouts and accessibility. These checks do not claim
a live account/Gemini round trip.

Final validation: **174 backend tests** and **116 frontend tests** passed, including
all existing feature suites. Ruff, dependency consistency (`pip check`), ESLint,
TypeScript and Node 24 production compilation passed. Browser audits passed at
320, 375, 768, 1024, 1280 and 1440 pixels with no page errors, accessibility
violations in the tested WCAG checks, or horizontal overflow.

The first normal production build passed. A final rebuild encountered a Windows/
OneDrive read-only generated directory under `.next/static`; the final source was
successfully rebuilt into fresh ignored `.qa/step9-production-check` instead.
Temporary build configuration changes were reverted. The existing local build
artifact still needs ordinary filesystem cleanup before reusing the default
`.next` output for another production build; no application configuration was
changed to work around it permanently. The private `.qa/setup-trip-database.sql`
has been prepared, but no hosted SQL was executed and no live Gemini call was made.

Manual verification:

1. Install backend requirements. Configure the three private Gemini variables.
2. Run `npm run db:prepare`; execute the ignored private generated SQL in your
   Supabase SQL Editor, or apply migration 6 using your normal migration workflow.
3. Start FastAPI and Next.js, sign in, and open a confirmed trip of 1–14 days.
4. Discover real attractions in Overview. Optionally select a real hotel and save
   real food spots. If provider connectivity fails, fix that before planning;
   the engine deliberately does not fabricate a replacement candidate pool.
5. Open **Itinerary** and click **Generate itinerary** once. Check day-by-day
   periods, real names, warnings, unknown prices and the AI-planning indicator.
6. Reload: the current version should remain without another LLM request.
7. After the cooldown, generate a new version; verify old version links still work.
8. Verify changed trip preferences flag an older version and failures retain it.
9. Sign in as another user; the first user's itinerary/UUID routes must remain
   inaccessible. Verify a genuine signed-out generation returns 401.
10. For local offline LLM testing, explicitly choose the fixture planner while
    retaining real persisted candidate IDs. Verify its label and production guard.

Recommended commit:
`feat(itinerary): generate validated Gemini plans with signed versioned persistence`

References: [Google GenAI SDK](https://googleapis.github.io/python-genai/),
[structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[SDK package](https://pypi.org/project/google-genai/).
