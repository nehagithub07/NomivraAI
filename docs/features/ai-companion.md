# AI Travel Companion

Step 12 adds private, trip-specific conversation at `/trips/[tripId]/companion`.
The existing application shell and trip navigation remain in use. The global
Companion tab is a trip picker; it cannot operate across trips.

## Architecture

```text
Browser message → authenticated Next.js travelRoute → owned trip + recent chat
  → compact context → internal-key FastAPI CompanionService → existing LLMProvider.chat
  → Gemini function call → explicit Python registry + argument/date validation
  → Next.js service executor → normalized tool result → Gemini grounded answer
  → signed Supabase message persistence → source cards + optional confirmation
```

FastAPI has no Supabase client. Gemini receives declarations, never Python
callbacks, credentials or a database interface. `GeminiLLMProvider.chat` extends
the existing provider using `google-genai`; automatic function execution is
explicitly disabled. Chat uses `GEMINI_MODEL=gemini-3.8-flash`. The existing
`GEMINI_ITINERARY_MODEL` override continues to control itinerary planning.
`COMPANION_PROMPT_VERSION` is `v1`. No new dependencies or environment secrets
are required. [Google's manual function calling documentation](https://ai.google.dev/gemini-api/docs/function-calling)
describes the function-call/result exchange used by the adapter.

## Tools and permissions

| Permission | Exact tools |
| --- | --- |
| READ | `get_trip_overview`, `get_itinerary`, `get_weather`, `get_budget_summary`, `get_selected_hotel`, `get_saved_food`, `get_discovered_places`, `get_trip_preferences`, `find_trip_places`, `find_food_options`, `find_hotel_options` |
| WRITE_CONFIRMATION_REQUIRED | `add_budget_entry`, `move_itinerary_activity`, `replace_itinerary_activity`, `create_itinerary_version`, `adapt_itinerary_for_weather`, `select_hotel`, `save_food_selection` |

`respond` is a structured response function, not an application execution tool.
It supplies a response intent, grounded explanation and successful call references.
The application attaches cards from real tool results. A pending write always
overrides the answer with “Review the proposed change… Nothing has changed yet.”

Every tool has a Pydantic schema with unknown fields forbidden. The Next.js
executor also validates read filters, dates and expense inputs. Provider IDs are
accepted only when present in the current trip's saved itinerary, persisted place
candidates or current recommendation cache. Tool names cannot select modules,
queries, URLs or executable code.

Retrieval supports literal name/category filters, bounded result counts, cuisine
and known dietary metadata. Vegan metadata also matches vegetarian filters using
the existing food policy. Hotel price filters require a comparable quote in the
trip currency. Food near a selected hotel requires real current coordinates,
uses Haversine distances, sorts within 5 km and labels distances as straight-line.
Unknown dietary suitability and unavailable coordinates remain unknown.

## Confirmation and audit

1. Validate the model's tool arguments, current message intent and referenced
   resources. Ambiguous questions and a conversational “yes” cannot authorize a write.
2. Build a factual preview. Itinerary edits are semantically checked before review.
3. Store a five-minute action through a signed RPC. The browser receives its ID,
   preview, status and expiry, never a provider persistence proof or editable arguments.
4. Confirm/Cancel submits `{}` to a trip-owned action route. The database locks
   the trip and action, checks ownership, expiry and the saved trip/itinerary/hotel
   snapshot, and atomically claims an eligible action once.
5. Revalidate current arguments/candidates and execute the existing domain service.
   Persist an executed/failed result. Repeated confirmation returns the existing
   state and never dispatches the service again.

Statuses are `pending`, `confirmed`, `executed`, `cancelled`, `expired`, `failed`.
The pending action itself is the mutation audit: tool, trip, status, created,
confirmed/completed timestamps and a small safe result. Cancelled/expired actions
cannot be claimed. Stale context requires a fresh proposal.

Execution uses an at-most-once claim across processes. A crash or lost response
after claim can leave `confirmed` without a terminal result, or an uncertain result
after a domain write. Such actions are never automatically reclaimed: inspect the
relevant trip tab before proposing another change. This deliberately avoids
duplicate expenses or itinerary versions; it is not a distributed transaction
between the action audit and every domain RPC. Budget identities and itinerary
request identities also use the stored action UUID.

Moves/replacements are deterministic and reuse `build_planning_context`,
`semantic_errors` and `resolve_itinerary`. Completion reuses the private signed
itinerary document validator, requires the expected current parent/digest and
creates a new `companion_edit` version. Earlier version days/items remain intact.
Generation and weather adaptation call the existing Step 9/11 services.

## Context, privacy and grounding

The initial context contains destination/timezone, dates, travelers, pace, budget
style, interests/preferences, current-itinerary availability, selected-hotel
availability, compact authoritative budget totals, weather availability and
food/place counts. It excludes provider payloads, expense rows, every candidate,
special-request free text, authentication and unrelated database identifiers.
The internal current-version UUID is removed before context reaches Gemini.

Detailed facts come through explicit tools. Budget totals come from the Decimal
budget service; Gemini does not calculate authoritative remaining money. Weather
comes from the Step 11 cache and risk/conflict service. No forecast is invented
for missing dates. Venue prices/ratings/dietary labels come only from normalized
provider data. Booking/payment/reservation requests receive an explicit unsupported
response before a Gemini call.

System instructions, structured context, user/history content and function results
are separate SDK content objects. Venue names and other text are untrusted data.
Tool permissions and execution are enforced outside the model. Results use explicit
field projections, a 32 KB bound and a recursive forbidden-key check; provider
proofs, headers, raw payloads, owners and API credentials never enter tool context.
Model explanations remain probabilistic; the UI displays source facts for checking.

Only the most recent 12 visible messages reach Gemini. The UI loads the latest 40.
The Step 7/8 retention policy also applies to chat: live hotel names, quotes,
ratings and unsaved food recommendations are returned for the current response
but omitted from durable assistant text/cards. Reloaded history shows an explicit
provider-detail notice; saved food retains only permitted saved names/categories.
Hotel confirmation names are rehydrated from current cache, never permanently
copied into pending previews. An expired cache disables that confirmation card.
No raw SDK content, hidden reasoning or opaque thought signatures are persisted.
The original SDK model content is kept only in a short-lived backend turn so the
function response preserves required opaque Gemini signatures.

Relative dates resolve with Python `ZoneInfo` and saved trip bounds. `today`,
`tonight` and `tomorrow` use the destination date. `day_2` uses trip start; weekdays
must identify exactly one trip date. `next day` needs the last server-resolved
reference date, persisted as small visible-response metadata. Missing timezone or
ambiguous/out-of-trip references require clarification.

## Persistence and RLS

Apply `20261030000900_ai_companion.sql` after migrations 1–8, or prepare the
current private database setup file. New tables:

| Table | Contents |
| --- | --- |
| `companion_conversations` | One conversation per trip, owner, message lease and timestamps |
| `companion_messages` | Visible user/assistant text, reply identity and bounded UI/audit metadata |
| `companion_pending_actions` | Validated operation, snapshot, preview, expiry, lifecycle and result |

All three tables enable RLS. SELECT requires `auth.uid()` to own the parent trip;
messages join through the conversation. Anonymous access and direct authenticated
INSERT/UPDATE/DELETE are revoked. User messages enter through the owner-checked
RPC; assistant messages/actions require the existing application HMAC mechanism.
Trip deletion cascades the private chat data. History URLs contain no message text.

Message UUIDs make retries idempotent. A database lease prevents concurrent turns
for one conversation; user-row locking protects the per-user rate check. A failed
model call persists a safe assistant failure response when the database is available.
Persistence failures are reported instead of pretending the chat was saved.

## Limits, timeout and cache behavior

- At most five application tool calls and one write proposal per message.
- At most one malformed-model repair; HTTP provider retries remain disabled.
- Gemini attempt: 20 seconds; cumulative model time: 50 seconds; backend turn: 85 seconds.
- Cache-only hotel/food hydration: 5 seconds each; read tool/context: 18 seconds.
- Database chat lease: 100 seconds; browser request timeout: 115 seconds;
  message/confirmation routes declare a 120-second maximum duration.
- Per-user maximum six new messages/minute; at least three seconds between
  messages on a trip. Backend user/trip cooldown also protects Gemini calls.
- Maximum 128 transient backend turns and 1,024 recent rate keys; expired turns
  are removed. Turn state requires the existing single Render worker/instance.

Weather reads and hotel/food cache hydration never launch live provider searches.
Hotel/food cache-only mode reuses existing backend caches, ranking, normalization
and signed Next.js selection proofs across isolated Vercel route instances. Cache
misses return unavailable; the user searches the existing Hotels/Food tabs.
Only the default search pool is currently reloaded for chat; custom-filter-only
search pools may be unavailable. Provider caches disappear on restart/expiry.
Confirmed weather adaptation can fetch weather through its existing bounded path.

## Routes and UI

| Layer | Routes |
| --- | --- |
| Next.js BFF | GET/POST `/api/trips/[tripId]/companion/messages` |
| Next.js BFF | POST `/api/trips/[tripId]/companion/actions/[actionId]/confirm` and `/cancel` |
| Internal FastAPI | POST `/api/v1/companion/chat`, `/actions/validate`, `/itinerary/edit` |

All browser routes use `travelRoute`, verified Supabase auth, origin/body checks,
`loadOwnedItineraryTrip`, `callTravelApi` and private/no-store responses. The browser
never sends trusted trip facts or calls FastAPI directly. Internal routes require
`X-Nomvira-Internal-Key` and contain no database query interface.

The workspace offers five initial prompts, persistent transcript, budget/weather/
hotel/itinerary/options cards, explicit source attribution, current/proposed change
cards and keyboard-accessible controls. Completion is shown from the saved action
result; a cancelled/expired action remains visibly unavailable for execution.
Text is rendered as escaped React text. Responses are non-streaming.

## Verification and remaining limits

Run `npm run test:companion`, the existing domain scripts, lint/typecheck/build,
and backend pytest/Ruff. Tests mock Gemini and providers; PostgreSQL tests execute
the actual migration chain/RLS/signed RPCs with PGlite. No paid/live Gemini test
requests are made. See [Step 12 implementation record](../history/step-12.md).

Before release, apply the migration and verify both accounts against hosted
Supabase and Gemini with the configured model/account. Configure production
origins and production backend settings. Deployment checks intentionally reject
local development origins. Hosting must permit the declared request duration.

This release has no bookings, payments, RAG, cross-trip memory, uploads, voice,
autonomous background actions, route-duration estimates or agent framework.
Conversation pagination/deletion/export and distributed backend turn storage are
future work. A model explanation is not a guarantee of venue facts or conditions.
