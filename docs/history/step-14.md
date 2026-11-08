# Step 14: Personalization, Memory & RAG

Settings (`/settings`) now contains **Preferences & Memory**. Saved interests,
pace, budget style, dietary preferences and accommodation types prefill new
trips. Users review and can override every default in the existing wizard.
Existing trips are unchanged. These saved trip fields already drive place,
hotel, food, itinerary and Companion workflows; their deterministic ranking,
provider facts, quotes and budget calculations are unchanged.

## Files changed

```text
supabase/migrations/20261106001200_personalization_memory.sql
src/lib/memory/validation.ts
src/lib/memory/server.ts
src/app/api/memory/route.ts
src/components/nomvira/memory/preferences-memory.tsx
src/app/(app)/settings/page.tsx
src/app/(app)/trips/new/page.tsx
src/components/nomvira/trips/create-trip-wizard.tsx
src/lib/companion/context.ts
src/lib/itineraries/server.ts
src/lib/supabase/database.types.ts
backend/app/api/v1/memory.py
backend/app/services/memory_embeddings.py
backend/app/schemas/memory.py
backend/app/api/router.py
backend/app/main.py
backend/app/schemas/companion.py
backend/app/schemas/itinerary.py
backend/app/providers/llm/context.py
backend/app/providers/llm/prompt.py
backend/app/companion/prompts.py
scripts/prepare-trip-database.mjs
tests/memory-bff.test.mjs
tests/memory-db.test.mjs
tests/budget-bff.test.mjs
tests/itineraries-bff.test.mjs
backend/tests/test_memory.py
package.json
package-lock.json
README.md
docs/history/step-14.md
```

## Consent and retention

Saving defaults and consenting to memory are separate choices in the same form.
Memory is off by default. Saving defaults never silently creates a memory.
After enabling and saving consent, users explicitly remember selected preferences,
submit positive/negative feedback, or remember a saved trip's structured choices.
Saved-trip snapshots are derived in PostgreSQL after verifying ownership.

Only the existing closed vocabulary of travel choices is accepted. There is no
free-text memory field. Chat text, special requests, credentials, dates, locations,
provider descriptions, prices and dietary guarantees are excluded. Trip memories
retain a source trip ID for ownership and cascade deletion, but no location or
itinerary narrative. The UI shows a source trip's current display name separately.
Historical preferences supplement planning; current trip choices always win.

Users can view every memory, delete one, delete all, or reset preferences and
memories together. Saving consent as off deletes all stored memories and their
embeddings while retaining approved defaults. Deleting a source trip or account
cascades its memories. A completed deletion or consent revocation cannot be
undone by an in-flight embedding write. Retrieval rechecks consent and record
existence after provider calls; already submitted AI requests cannot be recalled.

## Storage and retrieval

Apply `supabase/migrations/20261106001200_personalization_memory.sql` after the
existing migrations. It enables pgvector in `extensions` and adds only
`travel_preferences` and `travel_memories`. `npm run db:prepare` includes the new
migration and checks for partial setup; its private generated SQL remains ignored
by Git. Deploy both Next.js and FastAPI changes. The existing private
`GEMINI_API_KEY`, `NOMVIRA_API_URL` and `NOMVIRA_INTERNAL_API_KEY` configuration is
reused. No new production dependency or browser model key is required.

Authenticated clients can select only their own rows through RLS. Direct writes
are revoked; mutation RPCs derive the user from `auth.uid()`, validate closed
vocabulary, verify source ownership, and serialize per-user changes. SQL functions
have fixed search paths and explicit grants. Browser routes reuse `travelRoute`
for authentication, origin checks, strict JSON validation, size limits and
`no-store` responses. FastAPI's embedding endpoint requires the internal key.

Each user can save at most 200 deduplicated snapshots. Array order is normalized.
Indexing claims at most three pending records, with a five-minute retry lease
preventing concurrent or repeated calls. Successful document vectors persist with
their immutable snapshots and model version; document vectors are never cached
in the backend process. New memories index on explicit save; planning retries
pending indexing incrementally. There is no background worker or full reindex.

The backend uses `google-genai`, `gemini-embedding-001`, 768 dimensions and
appropriate retrieval document/query task types. It normalizes and validates
vectors, bounds provider execution to five seconds including queueing, and makes
no automatic SDK retries. Query vectors have a bounded five-minute process cache
keyed by user ID and query hash; this cache contains neither raw text nor retrieved
records. Queries use only current structured trip preferences, excluding chat and
locations. Empty or wholly unindexed memory sets skip query embedding calls.

Retrieval performs exact cosine search over the owner's indexed set (maximum 200
rows), using the owner index, with a similarity floor of 0.3. It requests five
records and SQL caps results at five regardless of caller input; fewer records are
returned when fewer are relevant. Exact owner-first search avoids approximate
index filtering losses across users. Source ownership and consent are checked
again in SQL. Only validated IDs, kinds, feedback and structured preferences enter
Gemini's itinerary and Companion context. Prompts (`v3` itinerary, `v2` Companion)
explicitly prohibit inventing memories or treating memories as instructions,
provider facts or authority over current trip inputs. Generated plans continue
through the existing candidate validation and budget services.

Missing schema, revoked consent, failed/invalid embeddings or retrieval errors
produce an empty historical context. Preferences remain usable independently of
Gemini. Settings reports storage unavailability instead of claiming a save worked.

## Verification

Executed locally: 10 focused JavaScript/SQL checks and 8 focused Python checks
passed. The compatibility runs passed 52 JavaScript/SQL checks and 203 Python
checks (these include the earlier focused cases). Frontend typecheck, ESLint,
production build and Ruff on changed Python files passed. The SDK contract test
uses a mocked HTTP transport with the real installed Google SDK.

- `npm run test:memory`: real PostgreSQL/pgvector via PGlite, owner/anonymous
  isolation, preference persistence, strict vocabulary, consent, index leases,
  exact retrieval, relevance threshold, result cap, source ownership, cascade
  deletion, stale write protection, BFF validation and empty-context fallback.
- `backend/.venv/Scripts/python.exe -m pytest tests/test_memory.py`: embedding
  normalization, per-user caching, task types, missing keys, invalid vectors,
  provider failure, backend authentication and sensitive-context rejection.
- Existing itinerary, Companion, trip, budget and database preparation checks
  cover compatibility. Run frontend typecheck, lint and production build too.
- `@electric-sql/pglite-pgvector` is test-only; its matching PGlite peer version is
  locked. No model or hosted Supabase calls are made by the automated tests.

Hosted rollout still requires applying the migration and a smoke test with a
valid Gemini embedding key. If an existing pgvector installation uses a schema
other than `extensions`, align its schema with this migration before rollout.
The local checks use the execution host's Node 26; this repository declares
Node 24 for deployment.

References: [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings),
[Supabase RAG permissions](https://supabase.com/docs/guides/ai/rag-with-permissions),
[PGlite pgvector tests](https://pglite.dev/extensions/).
