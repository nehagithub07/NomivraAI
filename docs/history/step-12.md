# Step 12 implementation record

Implemented 30 October 2026. This record covers the requested final report.
The implementation extends the existing trip application and unfinished companion
scaffold. No hosted database migration, deployment, booking or paid provider call
was performed during verification.

## 1. Files created

```text
backend/app/api/v1/companion.py
backend/app/services/companion_service.py
backend/app/services/companion_edit_service.py
backend/tests/test_companion.py
src/app/(app)/trips/[tripId]/companion/page.tsx
src/app/api/trips/[tripId]/companion/messages/route.ts
src/app/api/trips/[tripId]/companion/actions/[actionId]/confirm/route.ts
src/app/api/trips/[tripId]/companion/actions/[actionId]/cancel/route.ts
src/components/nomvira/companion/companion-workspace.tsx
src/components/nomvira/companion/companion-cards.tsx
src/lib/companion/actions.ts
src/lib/companion/context.ts
src/lib/companion/retention.ts
src/lib/companion/server.ts
src/lib/companion/tools.ts
src/lib/companion/validation.ts
supabase/migrations/20261030000900_ai_companion.sql
tests/companion.test.mjs
tests/companion-bff.test.mjs
tests/companion-db.test.mjs
docs/features/ai-companion.md
docs/architecture/system-architecture.md
docs/history/step-12.md
```

## 2. Files modified

```text
README.md
backend/app/api/router.py
backend/app/main.py
backend/app/companion/permissions.py
backend/app/companion/prompts.py
backend/app/companion/tool_registry.py
backend/app/companion/tool_executor.py
backend/app/providers/llm/base.py
backend/app/providers/llm/gemini.py
backend/app/schemas/accommodation.py
backend/app/schemas/food.py
backend/app/schemas/companion.py
backend/app/services/companion_context_service.py
backend/app/services/food_recommendation_service.py
backend/app/services/hotel_recommendation_service.py
src/app/(app)/companion/page.tsx
src/components/nomvira/trips/trip-navigation.tsx
src/components/nomvira/itineraries/itinerary-workspace.tsx
src/lib/accommodations/server.ts
src/lib/destinations/backend.ts
src/lib/food/server.ts
src/lib/itineraries/validation.ts
src/lib/supabase/database.types.ts
package.json
scripts/prepare-trip-database.mjs
tests/trip-database-setup.test.mjs
docs/setup/integrations.md
docs/deployment/deployment.md
```

The pre-existing companion registry/schema/date helpers were completed rather
than introducing competing abstractions. Generated `.next` files and local QA
logs are ignored; no secrets or root-level Step 12 report were added.

## 3. Migration

`20261030000900_ai_companion.sql` adds three RLS-protected companion tables,
owner-scoped message reservations, signed assistant/action writes, atomic action
claim/cancel/result RPCs, and immutable `companion_edit` itinerary completion.
It extends the existing version reason constraint; it does not copy trip, hotel,
food, budget or weather tables. `db:prepare` includes it and upgrades all nine
supported schema stages with rerun coverage.

## 4–6. Architecture, Gemini and registry

The authenticated BFF builds scoped context and executes existing services.
FastAPI owns the versioned prompt, bounded Gemini loop, function declarations,
Pydantic/date/permission validation and safe response shaping. It never owns a
database client. `LLMProvider.chat` and `GeminiLLMProvider.chat` extend the existing
provider. Automatic SDK execution and HTTP retries are disabled. Chat uses
`GEMINI_MODEL=gemini-3.8-flash`, independently of the existing itinerary override.

`backend/app/companion/tool_registry.py` explicitly registers 18 application tools.
The separate `respond` function carries the final response structure. The original
SDK model content/signatures stay only in a bounded transient backend turn.

## 7–8. Exact tools and permissions

READ:

```text
get_trip_overview
get_itinerary
get_weather
get_budget_summary
get_selected_hotel
get_saved_food
get_discovered_places
get_trip_preferences
find_trip_places
find_food_options
find_hotel_options
```

WRITE_CONFIRMATION_REQUIRED:

```text
add_budget_entry
move_itinerary_activity
replace_itinerary_activity
create_itinerary_version
adapt_itinerary_for_weather
select_hotel
save_food_selection
```

No generic code/SQL/database/URL tool or automatic write permission exists.

## 9–10. Confirmation and pending actions

A write request validates current references and creates a five-minute stored
proposal. The preview describes the current/proposed state; move/replacement
plans pass the existing itinerary validator before review. Confirm/Cancel sends
only an action UUID and empty JSON. The database rechecks parent ownership, expiry
and the saved trip/itinerary/hotel snapshot before atomically claiming an action.
Service execution revalidates current candidates and provider proofs.

Duplicate confirmation returns the existing status/result and never dispatches
again. Cancellation/expiry blocks execution. Action IDs also serve as budget and
itinerary request identities. Status/timestamps/result provide the mutation audit.
Confirmed writes use the existing budget, food, hotel, planning and weather services.

## 11–12. Conversation storage and RLS

One `companion_conversations` row per owned trip stores the turn lease.
`companion_messages` stores visible text, reply UUIDs and small UI/audit metadata.
`companion_pending_actions` stores validated arguments, preview, context snapshot,
lifecycle, expiry and safe result. User request IDs and assistant reply identities
make persistence/retry idempotent.

RLS ties all reads to `auth.uid()` owning the parent trip. Direct authenticated
INSERT/UPDATE/DELETE and anonymous table/RPC access are revoked. Restricted RPCs
verify ownership; assistant/action writes require existing HMAC application proofs.
Deleting the trip cascades chats/actions. Hidden reasoning and raw SDK content
are never persisted. Hotel/food retention restrictions are preserved in history;
live provider details remain transient.

## 13–15. Context, hallucination and injection protection

Compact context supplies trip dates/timezone, travelers, preferences, selected-stay
availability, current-version availability, authoritative budget totals, weather
availability and food/place counts. Internal user/trip IDs, raw providers, every
candidate, free-text special requests and secrets are excluded from model context.
Detailed facts require scoped tools. The budget service remains authoritative.

Tool projections strip raw payloads, signatures, headers and unrelated identifiers.
Function results are bounded and checked for forbidden keys. Prompts separate
system instructions from structured facts, history, user text and result data.
Permissions, schema validation and resource checks remain outside Gemini.
Pending writes receive a deterministic “nothing has changed” response. Unsupported
transactions are refused before a model call. Natural-language explanations can
still be imperfect, so the UI shows source cards and honest missing-data states.

## 16–17. Limits and rate protection

Five application calls, one write proposal and one malformed-model repair per
message. Recent history is capped at 12 messages; the UI fetches 40. Gemini has a
20-second attempt timeout and 50 seconds cumulative model time; backend turns
expire at 85 seconds. Read tools/context are bounded to 18 seconds; provider-cache
hydration to five seconds. Pending actions expire after five minutes.

The database serializes per-user rate checks, allows six new messages/minute and
enforces a three-second trip cooldown plus a 100-second active-turn lease. Backend
user/trip cooldowns provide additional protection; there is no single discovery
lock serializing all users. Transient turns/rate keys have bounded capacity.

## 18–19. Routes and UI

| Layer | Routes |
| --- | --- |
| Authenticated BFF | GET/POST `/api/trips/[tripId]/companion/messages` |
| Authenticated BFF | POST `/api/trips/[tripId]/companion/actions/[actionId]/confirm` |
| Authenticated BFF | POST `/api/trips/[tripId]/companion/actions/[actionId]/cancel` |
| Internal FastAPI | POST `/api/v1/companion/chat` |
| Internal FastAPI | POST `/api/v1/companion/actions/validate` |
| Internal FastAPI | POST `/api/v1/companion/itinerary/edit` |

The page uses the existing shell, typography, cards, buttons and trip navigation.
It adds an accessible transcript/composer, five initial prompts, normalized budget/
weather/hotel/itinerary/option cards and explicit confirmation/cancel controls.
The global Companion page chooses a trip. Itinerary history labels companion edits.
Browser requests contain no trusted trip context or editable pending arguments.
Message/confirmation routes declare 120-second hosting limits; text is non-streaming.

## 20. Tests added

36 backend companion cases cover registry/permissions, malformed/unknown calls,
expense/date validation, destination timezone, compact context, secret stripping,
manual SDK round trips/signatures, pending writes, continuation scope/replay/expiry,
five-call and one-write/repair limits, timeout/429 handling, unsupported bookings,
immutable deterministic edits, internal API auth and cache-only provider misses.

19 frontend/BFF/PostgreSQL companion checks cover owner/non-owner/origin/body
guards, trusted context, normalized domain reads, no pre-confirmation mutation,
one-time confirmation, cancellation/expiry, foreign candidate rejection, safe
provider/persistence failures, bounded history/tool timeouts, genuine hotel/food
metadata, RLS, signed persistence, stale snapshots, immutable versions, cascades
and transient supplier-data retention. Database setup coverage now upgrades all
nine schema stages. Gemini and external providers are mocked.

## 21. Commands executed and results

Commands below use the repository's configured scripts. Windows uses `npm.cmd`.

| Command | Result |
| --- | --- |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass; all companion routes compiled |
| `npm run test:auth` | 26 passed |
| `npm run test:trips` | 9 passed |
| `npm run test:destinations` | 32 passed, including nine schema upgrade stages |
| `npm run test:accommodations` | 19 passed |
| `npm run test:food` | 13 passed |
| `npm run test:itineraries` | 17 passed |
| `npm run test:budget` | 13 passed |
| `npm run test:weather` | 15 passed |
| `npm run test:deployment` | 3 passed |
| `npm run test:companion` | 19 passed |
| Backend `.venv/Scripts/python.exe -m pytest -q` | 316 passed |
| Backend `.venv/Scripts/python.exe -m ruff check app tests` | Pass |
| `npm run check:deployment` | Rejects local development site/API origins |
| Backend `.venv/Scripts/python.exe check_deployment.py` | Rejects development APP_ENV, accommodation/demo mode and local frontend origin |

The two production configuration failures are environment findings; no credentials
or environment values were printed or changed. Unit deployment-policy tests pass.
`git diff --check` also passed. Ruff formatting/import fixes were applied to changed
Python modules. Local domain script output is retained in ignored `.qa/step12-*.log`.

## 22. Deployment changes

Apply the new migration (or current private `db:prepare` output), then redeploy
both services. Reuse the existing matched internal key and private Gemini key.
No dependencies, public keys or additional provider accounts are needed. Keep
one backend worker/instance until transient turn storage is shared. The existing
Render/Vercel configuration files remain unchanged. Confirm the hosting plan's
request-duration support. Production origins/settings must be configured before
the production configuration checks can pass.

## 23. Known limitations and external acceptance

- Responses are non-streaming; natural-language explanations remain probabilistic.
- Action claiming is at-most-once, not a distributed transaction with every domain
  write. A crash/lost response after claim may leave `confirmed` or an uncertain
  outcome. It is never automatically retried; check the relevant trip tab first.
- Gemini turn state/provider caches are process-local. Backend restart loses a
  turn but retains private chat/actions in Supabase. Multi-worker scaling needs
  shared turn coordination before deployment changes.
- Weather reads use existing cached forecasts. Hotel/food tools reload only the
  default current provider cache pool; custom-filter-only pools may be unavailable.
  Cache misses do not silently consume provider quota or fabricate results.
- Current supplier details are transient. Reloaded chat retains permitted saved
  facts and explicit notices instead of permanently storing live hotel quotes or
  unsaved recommendations. Expired hotel details require a new proposal.
- No hosted migration, live Gemini/account-model acceptance, authenticated browser
  smoke test or deployment was performed. Perform a two-account hosted check after
  applying the migration; local mocked/PGlite verification does not establish it.
- No RAG, cross-trip memory, uploads, transactions, payments, routing, voice,
  background actions or multi-agent framework was added. Chat pagination and
  conversation deletion/export UI remain future work.

## 24. Recommended commit

```text
feat: add AI travel companion with safe tool calling
```

No Git commit was created automatically.
