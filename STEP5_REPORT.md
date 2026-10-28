# Step 5 implementation report

## Migration rerun fix

The migration now recognizes a compatible existing Step 5 schema and can be rerun without changing saved trip/interest records. It validates column signatures and ownership/interest foreign keys, reuses tables/indexes, replaces its named policies/trigger and functions, reapplies grants, and notifies PostgREST to reload the schema. Unknown or incompatible schemas still fail transactionally. Copy the current file contents into SQL Editor rather than rerunning an older query that contains the original legacy-only guard. See [TRIPS_SETUP.md](TRIPS_SETUP.md).

## Delivery status

The wizard, server operation, migration, user trip pages, and dashboard integration are implemented. Read-only probes now confirm the Step 5 tables/columns and creation function exist in the connected project. **Hosted creation and ownership acceptance remain pending.** This workspace has no database/management credentials or configured Supabase CLI, so the updated rerun fix must be applied through SQL Editor using [TRIPS_SETUP.md](TRIPS_SETUP.md).

The initial project inspection found an older `trips` table. The migration preserves that legacy shape as a private archive instead of deleting records or inventing missing requirements. Those legacy rows do not automatically appear as Step 5 trips.

## Files created

Paths below are relative to `client`.

Database and domain:

- `supabase/migrations/20261028000100_create_trips.sql`
- `src/lib/supabase/database.types.ts`
- `src/lib/trips/options.ts`
- `src/lib/trips/dates.ts`
- `src/lib/trips/validation.ts`
- `src/lib/trips/mapping.ts`
- `src/lib/trips/actions.ts`
- `src/lib/trips/queries.ts`

Trip components:

- `src/components/nomvira/trips/create-trip-wizard.tsx`
- `src/components/nomvira/trips/trip-wizard-progress.tsx`
- `src/components/nomvira/trips/wizard-navigation.tsx`
- `src/components/nomvira/trips/wizard-field.tsx`
- `src/components/nomvira/trips/option-cards.tsx`
- `src/components/nomvira/trips/trip-card.tsx`
- `src/components/nomvira/trips/trip-summary.tsx`
- `src/components/nomvira/trips/steps/destination-step.tsx`
- `src/components/nomvira/trips/steps/dates-step.tsx`
- `src/components/nomvira/trips/steps/travelers-step.tsx`
- `src/components/nomvira/trips/steps/budget-step.tsx`
- `src/components/nomvira/trips/steps/interests-step.tsx`
- `src/components/nomvira/trips/steps/preferences-step.tsx`
- `src/components/nomvira/trips/steps/review-step.tsx`

Routes, tests, documentation:

- `src/app/(app)/trips/error.tsx`
- `src/app/(app)/trips/[tripId]/not-found.tsx`
- `tests/trips.test.mjs`
- `TRIPS_SETUP.md`
- `STEP5_REPORT.md`

Temporary QA scripts, browser bundles, isolated PostgreSQL/bundler dependencies, results, staged application, and screenshots are under the existing ignored `.qa` directory. They are not application dependencies or an authentication bypass.

## Files modified

- `package.json`, `package-lock.json`: React Hook Form 7.91.0, Zod resolver 6.0.2, and `test:trips` script. Existing Zod 4.6.7, Supabase JS 2.118.0, and SSR 0.12.7 were reused. No Calendar or date-fns existed; neither was added.
- `tsconfig.json`: permits explicit `.ts` imports for native Node domain tests; application type checking remains strict with no emit.
- `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`: use the shared database type.
- `src/lib/supabase/proxy.ts`: allows a trip action to return an expired-session error without discarding the form; GET protection and action authentication remain enforced.
- `src/lib/travel-format.ts`: decimal-safe display of stored budgets with explicit currency code.
- `src/lib/mock/dashboard.ts`: removes fake upcoming-trip data and obsolete fixture-route definitions; sample recent durations are inclusive.
- `src/app/(app)/trips/new/page.tsx`: real authenticated wizard with optional destination prefill.
- `src/app/(app)/trips/page.tsx`: real user trip list and first-trip empty state.
- `src/app/(app)/trips/[tripId]/page.tsx`: dynamic session/RLS-backed UUID overview, replacing static sample routes.
- `src/app/(app)/page.tsx`: real upcoming-trip query and clean query-failure handling.
- `src/components/nomvira/layout/page-header.tsx`: wraps long user-entered destination titles safely.
- `src/components/nomvira/dashboard/home-dashboard.tsx`: live upcoming data, error handling, and accurate sample labels.
- `src/components/nomvira/dashboard/upcoming-trip-card.tsx`: actual saved requirements, without fabricated weather/spending/activities.
- `src/components/nomvira/dashboard/recent-trips.tsx`: sample labeling and removal of dead fixture-ID links.
- `README.md`: Step 5 behavior, setup, and verification commands.

## Database

The migration creates `public.trips` and `public.trip_interests`. Full column names, types, constraints, policies, and deployment instructions are in [TRIPS_SETUP.md](TRIPS_SETUP.md).

- Trips has generated UUID, auth-user ownership FK with cascade, text destination, four nullable future location fields, ordered date range, traveler count, numeric total budget/currency/style, pace, stay/dietary arrays, optional special requests, status, and timestamps. Duration is not stored.
- Interests has generated UUID, cascading parent FK, supported interest, creation timestamp, and a unique `(trip_id, interest)` constraint.
- Checks cover destination length/controls, dates, 1–20 travelers, positive bounded budget, supported currencies/styles/pace/status/preferences/interests, special-request length, and coordinate bounds.
- Both tables enable RLS with eight explicit authenticated CRUD policies in total. UPDATE checks prevent ownership reassignment or moving interests to another user's trip.
- PUBLIC/anon grants are revoked. Authenticated has only table CRUD. The RPC has authenticated-only execution and invoker security. No service-role client was added.
- Indexes are the table primary keys, `(owner_id, start_date)`, and the unique `(trip_id, interest)` index, which already supports parent lookups.
- A safe trigger maintains `updated_at`. An invoker RPC atomically inserts the trip and its interests; an interest failure rolls back both.
- The recognized old hosted table is preserved in `nomvira_legacy.trips`; an unexpected schema fails transactionally.

## Wizard, validation, and persistence

All seven steps are implemented: Destination, Dates, Travelers, Budget, Interests, Preferences, Review. One React Hook Form instance maintains values. Continue validates the current step; Back and all nine review Edit actions preserve values. Review edits return directly to Review after validation.

The shared Zod schema runs on client and server. It validates trimmed text, actual calendar dates, inclusive duration, future starts in the user's IANA time zone, bounded integer travelers, exact decimal budget input, centralized enum options, 1–8 unique interests, nonempty stays, optional dietary choices, and 500-character requests. No preference is represented by an empty dietary array.

The Server Action verifies the existing authenticated session, explicitly maps validated fields, and calls `create_trip_with_interests`. The RPC derives `owner_id` from `auth.uid()` and forces Planning. It never accepts browser-controlled ownership. The returned UUID becomes `/trips/{id}`. Errors preserve form values; a busy state and submission lock prevent duplicate clicks. Drafts are in memory only.

## My Trips, overview, and Home

My Trips queries actual owned rows using the existing session client and RLS. The overview retrieves the row and normalized interests, displays all saved requirements, and uses not-found for missing/malformed/inaccessible IDs. Generate itinerary is disabled with a next-step label.

Home uses the nearest future planning/active trip, sorted by start date. No trip uses the existing empty state; database errors show a clean error. Recommendations, insight, and recent-trip examples remain labeled demo content. No AI itinerary, external travel data, budget allocation, edit-trip UI, or delete-trip UI was implemented.

## Verification

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, zero warnings |
| `npm run typecheck` | Passed |
| `npm run test:trips` | 8 passed |
| `npm run test:auth` | 9 passed |
| Production build | Passed; app routes are dynamic, including UUID overview |
| PostgreSQL migration checks | Fresh and legacy schemas passed in isolated PGlite PostgreSQL |
| Migration rerun checks | Two repeats on fresh and legacy installations preserved all rows/timestamps/archive data; RLS and creation still worked; incompatible column types/table shapes/foreign keys were rejected transactionally |
| Authenticated HTTP smoke | Passed using the existing Supabase SDK/proxy/action flow against an isolated PostgreSQL-backed contract fixture: Login → wizard → atomic save → UUID overview |
| Responsive checks | 320, 375, 768, 1024, 1280, 1440px; all seven steps plus My Trips, Trip Overview, Home |
| Responsive findings | No horizontal overflow, action/mobile-navigation overlap, or automated WCAG A/AA violations in the final offline harness |
| Browser failure checks | Real Server Action rejected tampered payload; database failure and expired-session results preserved values; duplicate click created one owned trip |
| Console | Offline harness: zero page errors, console errors, or warnings. Authenticated development smoke: no page/hydration errors; one unused stylesheet preload warning |

Database checks exercised owner CRUD, hidden foreign rows, denied foreign updates/deletes/interest inserts, denied ownership reassignment and interest-parent reassignment, anonymous denial, invalid values, precise budget storage, interest-failure rollback, timestamp updates, cascading deletes, and preservation/private access of the legacy archive.

An accessibility check found a definition-list error in Review; Edit controls were moved inside the appropriate definition value and all six widths passed afterward. Native date inputs were filled and date preservation checked at all widths. No custom calendar popup was introduced.

Browser artifacts are in `.qa/step5-results.json` and `.qa/screenshots/step-5/`. The responsive/failure harness runs real source components, validation, Server Action, and migrated PostgreSQL, with test adapters for Next routing, session identity, and SDK transport. It is not a hosted Supabase acceptance test and does not verify actual email/Google providers or browser-native popup rendering across devices.

Automatic approval review rejected starting the separate production preview server with the reason **“blocked by policy”**, without further detail. Production compilation passed, but a complete production HTTP/browser run could not be performed. The authenticated HTTP smoke used development mode before that rejection. Remaining UI checks used the offline harness rather than retrying the blocked server start.

## Remaining deployment action

Apply the supplied migration to the connected Supabase project, then run the hosted checks in [TRIPS_SETUP.md](TRIPS_SETUP.md). No live database schema or user trip records were changed in this workspace run. Hosted persistence/ownership acceptance is pending until deployment and live verification.

Step 5 implementation stops here.
