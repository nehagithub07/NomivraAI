# Step 10 implementation report

Implemented a deterministic Smart Budget Engine with Python Decimal arithmetic,
authenticated BFF endpoints, trip-owned expenses, and a budget dashboard.
See [budget engine](../features/budget-engine.md) for complete semantics, APIs,
migration instructions, request formats, limitations and manual acceptance steps.

## Files introduced for Step 10

- Backend: `backend/app/schemas/budget.py`, `backend/app/services/budget_service.py`,
  `backend/app/api/v1/budget.py`, `backend/tests/test_budget.py`.
- Database: `supabase/migrations/20261029000700_trip_budget_entries.sql`.
- BFF: `src/lib/budget/validation.ts`, `src/lib/budget/server.ts`, and the route
  handlers under `src/app/api/trips/[tripId]/budget/` (summary, collection, entry).
- UI: `src/app/(app)/trips/[tripId]/budget/page.tsx` and
  `src/components/nomvira/budget/budget-workspace.tsx`.
- Frontend/database tests: `tests/budget.test.mjs`, `tests/budget-bff.test.mjs`,
  `tests/budget-db.test.mjs`.

## Existing files extended

`backend/app/api/router.py`, `src/lib/destinations/backend.ts`,
`src/lib/supabase/database.types.ts`,
`src/components/nomvira/trips/trip-navigation.tsx`, `package.json`,
`scripts/prepare-trip-database.mjs`, `tests/trip-database-setup.test.mjs`, and budget
documentation in `README.md`, `backend/README.md` and `docs/features/budget-engine.md`.
The new history/report documentation follows the current `docs/` structure.

Authentication, provider integrations, proof signing and itinerary generation are
preserved. No keys, dependencies, LLM calls, currency services or workers were added.

## Core decisions

- Allocation percentages are centralized: Budget 30/25/15/20/10, Balanced
  35/25/20/12/8 and Premium 45/25/15/10/5. Rounding preserves the total exactly.
- Only real, current, comparable, same-currency hotel totals are known costs;
  quote provenance is transient and no price is invented or stored as a booking.
- Food and attraction prices stay unknown without user-entered values.
- Remaining = total − known − planned − actual. Health thresholds are 75% and
  100%. Inclusive remaining days and exclusive hotel nights are distinct.
- Marking a plan actual updates one record. Manual accommodation rows replace
  the entire automatic hotel quote; partial payments require an explicit planned
  balance. A create UUID prevents duplicate insertion of the same request.
- CRUD stays in the authenticated Supabase BFF; FastAPI computes/validates only.
  RLS, restricted column grants, currency guards and a bounded row count protect
  direct database access too.

## Validation

Focused tests cover allocation policies and cents, real/missing/expired hotel
prices, unknown food/activity prices, planned/actual aggregation, exact remaining
funds, health boundaries, per-person and daily guidance, invalid/zero amounts,
duplicate IDs, hotel reconciliation, currency restrictions, ownership/RLS and CRUD.
Existing database setup tests upgrade stages 1–7 and verify safe reruns.

Final verification:

| Check | Result |
| --- | --- |
| Backend `pytest -q` | 213 passed, including 39 budget cases |
| Backend `python -m ruff check .` | Passed |
| Frontend `node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs` | 130 passed; also verified on Node 24.22.1 |
| `npm run test:budget` | 13 passed, including PostgreSQL ownership/CRUD subtests |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; budget page and all three BFF routes included |
| `npm run db:prepare` | Prepared private SQL with the budget migration |
| `git diff --check` | Passed |

On Windows, these commands used `npm.cmd` and the existing
`backend/.venv/Scripts/python.exe`. The Node 24 suite used the existing local
runtime in `.qa/runtime/node-v24.22.1-win-x64/`; no packages were installed.
Automated tests use mock providers and local PostgreSQL; they do not call live
Gemini, StayAPI, Geoapify, Overpass or a hosted Supabase project.

Browser verification uses the actual BudgetWorkspace, shared components,
production styles, and Python budget service with local test data. Database/BFF
boundaries are verified separately. It checks CRUD, duplicate submission,
mark-actual reconciliation, manual hotel replacement, safe errors, responsive
layout and WCAG accessibility at 320, 375, 768, 1024 and 1440 pixels. These checks
passed with no browser runtime errors, no horizontal overflow and no detected
WCAG A/AA violations. The test fixture results/screenshots stay ignored under `.qa/`.

The hosted migration still needs to be applied before deployment. Existing
process-local hotel quote retention means quotes may be absent on another
serverless instance. Manual expenses persist independently.

Recommended commit message:

```text
feat(budget): add deterministic trip budgets and owned expense tracking
```
