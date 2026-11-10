# Supabase database setup

For the current Companion/Memory/Sharing setup errors, follow
[current-project diagnosis and repair](#current-project-diagnosis-and-repair).
The Step 5 foundation and historical schema notes below describe earlier setup.

## Apply the migration

Migration: [`supabase/migrations/20261028000100_create_trips.sql`](supabase/migrations/20261028000100_create_trips.sql).

This workspace has no configured Supabase CLI, database connection string, or management access token. The publishable key supports session-scoped Data API operations, not schema deployment. Read-only probes now confirm the Step 5 columns, interests table, and creation function exist in the connected project; hosted creation and ownership acceptance still need verification.

For this environment, open the connected project's Supabase SQL Editor, replace the entire query with the **current file contents**, and run it as the project administrator. All SQL is supplied; no schema changes need to be recreated by hand. The updated script supports rerunning against the compatible Step 5 schema, preserving existing trips/interests and refreshing its functions, named policies, trigger, grants, and API schema cache. If using the CLI, retain normal migration history and apply through the project's deployment workflow.

An older copy of the script rejects an already installed Step 5 table with `Existing trips schema is not the recognized legacy schema`. That guard has been replaced: the current file recognizes Step 5, validates column types/nullability/budget precision and ownership/interest foreign keys, and reuses those tables. Do not reuse the old SQL still open in the editor.

### Existing hosted table

Read-only schema probes found a pre-Step-5 `public.trips` table with `user_id` and `destination`, without `owner_id`, dates, or the new budget/preferences fields. No trip records were downloaded during inspection.

The migration recognizes this legacy signature and moves the table intact to `nomvira_legacy.trips`, revoking schema/table access from PUBLIC, anon, and authenticated. Existing rows, indexes, and foreign-key relationships are preserved. Old rows remain available to the administrator and do not appear as new Step 5 trips. No dates or budgets are invented to import them. On a fresh database or a compatible Step 5 rerun, this archive move is skipped. An unrecognized/incompatible table shape or conflicting legacy archive fails the migration. The entire file is transactional, including the archive move. Repeated execution on the compatible schema does not update or delete trip/interest rows.

Keep `nomvira_legacy` outside the exposed API schemas. Review dependencies before deployment if another application still uses the legacy table.

## New tables and columns

`public.trips` contains:

| Columns | Type and behavior |
| --- | --- |
| `id` | Generated UUID primary key |
| `owner_id` | Required UUID FK to `auth.users(id) ON DELETE CASCADE` |
| `destination_name` | Trimmed text, 2–160 characters, no control characters |
| `destination_place_id` | Nullable text, left null |
| `destination_latitude`, `destination_longitude` | Nullable double precision, coordinate bounds checked, left null |
| `destination_timezone` | Nullable text, left null |
| `start_date`, `end_date` | Required dates, ordered range within years 1–9999 |
| `travelers_count` | Integer, 1–20 |
| `budget_total` | `numeric(12,2)`, greater than zero, at most 100,000,000 |
| `currency` | USD, EUR, GBP, INR, CAD, AUD, JPY |
| `budget_style` | budget, balanced, premium |
| `travel_pace` | relaxed, balanced, packed |
| `accommodation_preferences` | Required nonempty text array of supported stay types |
| `dietary_preferences` | Required text array; empty means No preference |
| `special_requests` | Nullable text, at most 500 characters |
| `status` | planning, active, completed, cancelled; default planning |
| `created_at`, `updated_at` | Required timestamptz; defaults and update trigger |

`public.trip_interests` contains `id` (generated UUID primary key), `trip_id` (required UUID FK to trips, cascade delete), `interest` (required supported interest), and `created_at` (required timestamptz). `UNIQUE(trip_id, interest)` prevents duplicates.

Duration is derived, never stored. Calendar arithmetic/formatting uses date-only strings and UTC instants, counting both endpoints. Past-date validation uses today in the browser's IANA time zone, checked again on the server and in the RPC. This time zone is validation context and is not stored as the unresolved destination time zone.

## RLS, grants, functions, and indexes

Both tables enable RLS and have explicit SELECT, INSERT, UPDATE, and DELETE policies for `authenticated`. Trip policies require `(select auth.uid()) = owner_id`, including a check on the updated row. Interest policies require ownership of the parent; UPDATE checks the old and new parent. Policies do not recurse.

PUBLIC and anon receive no table privileges. Authenticated receives only SELECT/INSERT/UPDATE/DELETE. The `(owner_id, start_date)` index covers ownership and upcoming queries. The unique `(trip_id, interest)` index already indexes `trip_id`; no duplicate index is added.

`set_trip_updated_at()` is a trigger function with an empty search path and restricted direct execution. `create_trip_with_interests(...)` is an authenticated-only **SECURITY INVOKER** RPC with an empty search path: table grants and RLS remain active. It derives ownership from `auth.uid()`, forces Planning, validates the caller/time zone/past dates/budget precision/interest count/preference duplication, and relies on table constraints for the remaining ranges and known values. A failed interest insert rolls back the trip insert. Ownership is never an RPC argument.

The Server Action reuses the verified Step 4 helper and server client, validates Zod input, explicitly maps fields, calls the RPC, and invalidates `/trips` and `/`. The wizard navigates to the returned UUID. No direct browser insert or privileged Supabase client is added.

Patterns follow the official [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) and [database function security guide](https://supabase.com/docs/guides/database/functions).

## Type alignment

`src/lib/supabase/database.types.ts` manually describes the tables, relationship, and RPC. Both existing clients use it. CLI generation was not previously configured. When available, generate types from the migrated project, verify numeric argument/return representation, and replace the manual definitions through the normal workflow.

## Hosted acceptance after migration

1. As User A, create a trip and verify its exact budget, inclusive duration, preferences, and Planning status. Refresh; check My Trips and Home.
2. As User B, verify User A's trip is absent and its UUID route shows the same not-found state as an unknown trip.
3. Check own CRUD, denied ownership reassignment, denied access to another user's trips/interests, and denied anonymous table/RPC access.
4. Verify interest failure rolls back the parent; trip/account deletion cascades to interests.
5. Verify real expired sessions and network failures preserve the wizard and allow retry after sign-in. Local contract/offline checks do not establish hosted provider/cookie behavior.

The original Step 5 scope excluded later planning/provider features. See README
for the current application feature set.

## Current-project diagnosis and repair

Verified 2026-11-09: login, signed trip creation and the core trip tables work.
The Data API cannot find Companion, preferences/memories or sharing objects.
This causes `COMPANION_SETUP_REQUIRED` and unavailable Memory/Sharing states.
REST 404/PGRST205 alone cannot distinguish a missing table from a stale schema
cache; inspect the live catalogs before changing anything.

### 1. Inspect, without modifying data

In Supabase Dashboard, match the project reference to the hostname in
`NEXT_PUBLIC_SUPABASE_URL` from `.env.local`. Open SQL Editor as the project owner
and run [readiness.sql](../../supabase/diagnostics/readiness.sql). It reports
required tables, RLS/policy presence, RPCs, anonymous execution privileges,
extensions and the food-provider constraint. It reads no user records or keys.

If the expected objects already exist with the correct policies/functions, try
the schema-cache refresh below and retest before applying migrations.

### 2. Establish recovery

Confirm the intended project has a restorable backup/PITR point, or a validated
database dump and a tested restore procedure. Record its timestamp. No backup,
admin connection or recovery capability was established from this workspace.
The publishable key and a normal login cannot apply SQL migrations.
Follow [Supabase's backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### 3. Review the pending feature migrations

| File in `supabase/migrations/` | Purpose |
| --- | --- |
| `20261030000900_ai_companion.sql` | Conversations, messages, pending actions, signed RPCs and owner RLS |
| `20261030001000_place_refresh_and_map_backfill.sql` | Signed place refresh/map-related compatibility; inspect whether already installed |
| `20261105001100_rated_food_provider.sql` | Allows saved Google Maps food identities; preserves signed itinerary checks |
| `20261106001200_personalization_memory.sql` | Preferences, memories, pgvector and owner-scoped retrieval/deletion |
| `20261106001300_trip_sharing.sql` | Approved snapshots, expiring tokens and revocation |

Do not replay unconditional create-table migrations against partially installed
objects. Stop on conflicting schema, destructive changes or missing recovery.
Core trip creation already works; there is no reason to reset its tables or RLS.

### 4. Existing supported schema: prepare the reviewed atomic setup

From the repository root in PowerShell:

```powershell
npm.cmd run db:prepare
code .qa/setup-trip-database.sql
```

This command only writes a local file; it does not connect to or modify Supabase.
It was run during this audit and the private file is ready for review. The script
checks the supported existing foundation, installs missing feature groups,
refreshes compatible signed functions/food constraints and maintains owner RLS
inside a transaction. Its upgrade paths are exercised by PostgreSQL tests.

After identity, schema compatibility and recovery checks pass, paste the complete
file into the intended project's SQL Editor and run it once. It contains the
existing internal signing key, so keep it private and outside Git/chat. It does
not contain provider keys. An error must roll back the transaction; do not bypass
its guards or manually delete tables to force it through.

Alternatively, administrators who already maintain CLI migration history can
use the workflow below. Do not use both workflows blindly: SQL Editor changes
may already exist without CLI history entries.

```powershell
npx supabase@latest login
# Only if supabase/config.toml does not yet exist:
npx supabase@latest init
npx supabase@latest projects list
npx supabase@latest link --project-ref YOUR_VERIFIED_PROJECT_REF
npx supabase@latest migration list --linked
npx supabase@latest db push --linked --dry-run
```

Compare the dry run with live objects and reviewed migration history. If it lists
already installed migrations, stop and reconcile that history after inspecting
their actual definitions; marking migrations applied does not execute SQL.
Only after recovery and compatibility are established should an administrator run
`npx supabase@latest db push --linked`. The audit did not execute any of these
remote commands. CLI flags are documented in the [official reference](https://supabase.com/docs/reference/cli/supabase-db-push).

### 5. Refresh and verify

Run in SQL Editor after successful setup, or when objects exist but REST is stale:

```sql
NOTIFY pgrst, 'reload schema';
```

Run `readiness.sql` again: required tables must exist with RLS and policies,
write RPCs must deny anonymous execution, and `vector` must be installed.
`get_shared_trip` intentionally allows anonymous read-only token lookup.
Verify signed-in Companion, preference save/reset, consented retrieval/deletion,
share creation/revocation and isolation using two accounts. No RLS policy should
be disabled to make a failing request succeed.

Reload the app. Database-only updates do not require changing API keys. Restart
FastAPI only when changing backend environment values. StayAPI HTTP 402 and
upstream Gemini/Overpass failures require provider recovery independently of SQL.

Older trips can also return `WEATHER_CONTEXT_CHANGED` when their original creation
did not capture a confirmed provider ID, latitude/longitude and timezone. One such
trip was verified in this audit. Creating a new trip through destination search
supplies validated metadata. Updating an old trip in place needs a validated,
ownership-checked re-resolution workflow; do not invent coordinates/timezones in SQL.

The latest provider checks support these optional local configuration choices:

```dotenv
# Verified working generation model; avoids the currently slow primary failover.
GEMINI_MODEL=gemini-3.6-flash
GEMINI_ITINERARY_MODEL=gemini-3.6-flash
# Tested alternative to Google Maps food while StayAPI access is unavailable.
FOOD_PROVIDER=geoapify
```

These are explicit choices for `backend/.env`, not changes made by the audit.
They change the model/food source and do not fix hotel account access or database
migrations. Restart FastAPI after changing them; existing provider facts and saved
selections must retain their source. No availability guarantee follows from one test.

