# Smart budget engine

Open an owned trip and choose **Budget** at `/trips/[tripId]/budget`.
The engine uses the saved trip budget, currency, dates, traveler count and budget
style. Gemini is never called for budget calculations.

## Request and persistence boundary

```text
Browser → authenticated Next.js BFF → owned Supabase trip/expenses
        → internal-key FastAPI budget service → validated decimal-string summary
```

Next.js retains database access, as in itinerary generation. FastAPI remains
stateless and has no Supabase credentials. Browsers cannot supply a trip total,
provider price, provenance, ownership or an entire summary. Manual entries are
saved with the authenticated Supabase client and independently protected by RLS,
column permissions, constraints and database triggers.

## Allocation policy

All percentages live in `backend/app/services/budget_service.py`.

| Style | Accommodation | Food | Activities | Transport | Other |
| --- | ---: | ---: | ---: | ---: | ---: |
| Budget | 30% | 25% | 15% | 20% | 10% |
| Balanced | 35% | 25% | 20% | 12% | 8% |
| Premium | 45% | 25% | 15% | 10% | 5% |

Each policy totals exactly 100%. Allocations use Python `Decimal`, round down to
two decimal places, and assign the remaining cents to Other. Allocated money
therefore always sums to the canonical trip total, including very small budgets.
Zero category allocations have no percentage denominator and return `null` for
category utilization. Amounts remain decimal strings across the API boundary;
browser conversion is used only for display and progress bars.

## What is counted

- **Known:** the real selected StayAPI hotel's comparable total price, only when
  selection/search context matches the current trip, the quote is unexpired,
  and currencies match. This is a quote, not a booking or confirmed payment.
- **Planned:** manually entered expected costs.
- **Actual:** manually recorded payments. These are shown separately from plans.
- **Committed:** known + planned + actual, after accommodation reconciliation.
- **Remaining:** total budget − committed. Negative remaining funds are preserved.
- **Actual-only remaining:** total budget − actual payments, also exposed by the API.

The provider's existing hotel total is used directly; it is never multiplied by
nights or inferred from an itinerary. A missing, expired, non-comparable, demo or
foreign-currency hotel quote is not counted. Saved hotel identifiers do not contain
a permanent price, and the budget engine does not persist provider quotes.

Food and attraction provider amounts are `null`/unknown. Category totals contain
only amounts actually known or entered by the user; zero unrecorded spending does
not mean free food or free admission. No price classification is converted to money.

## Planned payments and double counting

Use **Mark actual** or edit an existing plan when it is paid. This updates the same
row rather than adding another copy of its amount. Separate payments or different
costs can be entered as separate rows.

Any manual accommodation entry replaces the **entire** automatic hotel quote.
Enter the full expected accommodation cost yourself, splitting actual payments
and unpaid planned balances into separate rows if needed. For example, a $200
deposit and $400 remaining hotel balance are $200 actual + $400 planned; the $600
provider quote is excluded. A zero manual accommodation cost also explicitly
replaces the quote. Removing all manual accommodation entries restores a current
valid automatic quote if one is still available.

Every create request carries a client-generated UUID retained after uncertain
responses. The primary key prevents the same request being inserted twice. A
duplicate returns HTTP 409 with instructions to refresh; there are no automatic
mutation retries. Descriptions are not used for deduplication because different
real expenses may share a description.

## Dates, daily guidance and budget health

- Trip days are inclusive; hotel nights are checkout − checkin.
- Before a trip, remaining days equal the full inclusive duration. During a trip,
  the calculation includes today in the destination timezone. After the trip,
  daily guidance is `null`. An unavailable timezone falls back to UTC with a warning.
- Recommended daily flexible spend is max(remaining budget, 0) ÷ remaining trip
  days, rounded down. Already planned amounts have been reserved first.
- Per-traveler budget is total ÷ travelers; daily per-traveler guidance divides
  the daily flexible amount by travelers. Both are derived values, rounded down.
- Utilization below 75% is `healthy`, 75–100% is `watch`, and above 100% is
  `over_budget`. Comparisons use exact Decimal values before display rounding.

The dashboard uses deterministic insight templates. Budget outlook reflects the
recorded known, planned and actual costs, and does not predict unknown costs.

## API

| BFF route | Method | Purpose |
| --- | --- | --- |
| `/api/trips/[tripId]/budget` | GET | Load owned data and calculate a summary |
| `/api/trips/[tripId]/budget/entries` | POST | Validate and save a manual expense |
| `/api/trips/[tripId]/budget/entries/[entryId]` | PATCH | Update only supplied fields |
| `/api/trips/[tripId]/budget/entries/[entryId]` | DELETE | Delete the owned expense |

POST requires `id`, `description`, `category`, `entry_type`, `amount` (decimal
string), and `currency`. `expense_date` is optional. PATCH accepts partial mutable
fields. DELETE sends JSON `{}` through the existing `travelRoute` guard.

Internal-only FastAPI endpoints, both protected by the existing internal key:

- `POST /api/v1/budget/summary` accepts only BFF-loaded normalized trip/expense data.
- `POST /api/v1/budget/entries/validate` validates a complete proposed manual entry
  against the canonical trip currency before persistence.

CRUD remains in Next.js/Supabase, following the project's existing ownership
architecture. The backend does not introduce a second database client or accept
browser requests directly.

## Database setup and validation

Apply `supabase/migrations/20261029000700_trip_budget_entries.sql` once, after the
existing migrations. Alternatively, run `npm run db:prepare` and apply its private
`.qa/setup-trip-database.sql` in the matching Supabase SQL Editor. That generated
file includes an internal secret; keep it ignored and do not publish it. Preparing
the file does not modify the hosted database. No new environment variables or
dependencies are required.

`trip_budget_entries` has a cascading trip FK, category/type/source checks, exact
non-negative numeric amounts up to 100,000,000 with at most two decimals, optional
valid dates, timestamps and a trip/creation index. Explicit column grants prevent
clients from changing row identity, trip, provenance or timestamps. Owned-trip RLS
protects reads and writes. Triggers enforce trip currency and a 1,000-entry cap,
and block changing a trip's currency while expenses exist. No implicit FX is used.

Dates can precede the trip because deposits and tickets may be paid in advance.
Zero expenses are supported explicitly. Refunds/negative expenses are not supported.

Run `npm run test:budget`, backend `pytest` and Ruff, plus the existing frontend
regression scripts, lint, typecheck and build. PostgreSQL behavior is tested with
PGlite, including RLS as separate authenticated owners and anonymous denial.

## Manual verification and limitations

1. Apply the migration, start FastAPI and Next.js, sign in, and open a saved trip.
2. Choose **Budget**. Check the five allocations sum to the saved trip total.
3. Refresh/select a real hotel in **Hotels**, then refresh Budget. A current
   same-currency quote may be counted. Missing quotes remain explicitly unknown.
4. Add a planned transport expense. Mark it actual: committed costs should stay
   the same while the planned/actual split changes.
5. Add an actual hotel payment and its remaining planned balance if applicable.
   Confirm the automatic quote is replaced, rather than counted a second time.
6. Edit and remove entries; reload the page to confirm persistence. Double-click
   Save and confirm one row is created.
7. Verify a second account cannot read or modify the first account's budget.
8. Add enough spending to cross 75% and then 100%; verify Watch and Above budget.

Hotel cache entries remain process-local. On Vercel, a different instance or a
cold start may not have the hotel quote; add a manual estimate if it is unavailable.
No durable quote cache, booking confirmation, routing, receipt ingestion, FX,
refund accounting or automatic matching of independently entered expenses is added.
The UI requires an explicit refresh to recalculate daily guidance or quote expiry.
