# Steps 16–17 verification and release assessment

Updated 2026-11-09. **Status: BLOCKED.** No infrastructure deployment, secret
rotation or live migration was performed. Offline checks do not establish a
successful hosted end-to-end journey.

## Implemented and checked

- Shared Overpass discovery deadline includes Geoapify; per-endpoint HTTP/QL
  timeouts leave response headroom. Failures never return fixture attractions.
- Hotel lookup uses the canonical destination with country/region context.
  Older food provider constraints produce a safe setup error.
- Structured private logs, request IDs, timings, provider/cache/error counters,
  protected diagnostics, optional Gemini token-cost estimates and usage limits.
- Tests cover missing pricing/token breakdowns, cached/thinking tokens, UTC daily
  limits, timeouts/rate guards, private logs, coalescing and quota-free health.
  Smoke guards cover remote-origin rejection, credential echo prevention and
  preserving preexisting trips during failure cleanup.

## Executed checks

| Check | Result |
| --- | --- |
| JavaScript/TypeScript/PostgreSQL tests, Node 24 | 198 passed; ownership/RLS, signatures, preferences, retrieval, deletion and sharing revocation included |
| Python tests | 364 passed |
| ESLint, Next.js type generation and TypeScript | Passed |
| Next.js production build | Passed |
| Ruff, changed Python files | Passed |
| `npm audit --omit=dev --audit-level=high` | No reported vulnerabilities |
| Python `pip check` | Passed; `pip-audit` absent, so no Python advisory audit is claimed |
| Local health/readiness/authorized diagnostics | HTTP 200; unauthorized diagnostics HTTP 401; no provider probes |
| Deployment validators, current local environment | Blocked: development origins/backend environment require production values |

## Real endpoints reached

Earlier checks reached Open-Meteo geocoding/weather, Geoapify places/food,
StayAPI hotels (50 parsed records), configured Google Maps food (5 records),
ORS walking routes, OpenFreeMap styles, Gemini generation/768-dimensional
embeddings, Supabase login and anonymous isolation. Companion returned real
content through configured model failover. These are historical request results,
not ongoing availability claims.

Latest signed-in local-production BFF journey, 2026-11-09:

| Feature | Observed result |
| --- | --- |
| Confirmed account login, signed trip creation, places | Passed |
| Hotel / configured food search | Failed: real StayAPI HTTP 402; selections not verified in this run |
| Itinerary generation | Failed: real Gemini HTTP 503; an earlier signed-in generation succeeded |
| Budget create/read, weather refresh | Passed |
| Companion | Blocked: `COMPANION_SETUP_REQUIRED` |
| Walking-route BFF | Requires itinerary after failed generation; earlier live route/BFF checks passed |
| Preferences/Memory and Sharing state | Graceful unavailable fallback; storage not verified |
| Export and private-field allowlist | Passed for available data; full populated PDF acceptance pending |
| New test-trip cleanup | Passed; existing trips preserved |

Direct Overpass probes previously timed out on two hosts and received HTTP 406
on the third; real Geoapify-first discovery succeeded. An earlier standalone
primary Gemini probe failed without a confirmed status. The itinerary HTTP 503
above was explicitly observed. No provider bodies or private identifiers are
recorded here.

Prior Step 15 browser checks exercised actual export/share components at mobile,
tablet and desktop sizes and PDF output with fixtures, not a live trip.
[Mobile screenshot](../assets/export-mobile.png) is labeled accordingly in README.
Signup/email delivery, second-account live RLS isolation, full signed-in browser
acceptance, hosted behavior and post-migration consent/deletion/retrieval/revocation
remain unverified. Offline RLS tests do not replace these.

## Release gates

1. Connect supported Supabase admin access and verify intended project, live
   schema/history and recoverable backup before conditionally authorized Companion,
   Memory/RAG and Sharing migrations. No admin connection or recovery evidence is
   available. Review rated-food constraint support separately.
2. Resolve StayAPI HTTP 402 and Gemini HTTP 503; verify Overpass/network recovery
   or reliable real-provider discovery failover, then repeat affected tests.
3. Configure production origins/environment, provider budgets, log/backup retention;
   verify migrations, ownership, deletion and revocation.
4. Obtain explicit deployment authorization, deploy and pass the full hosted journey
   and mobile/PDF checks before marking READY.

See [operations and recovery](../deployment/deployment.md#operations-and-recovery-steps-16-17)
for diagnostics, limit caveats, migration safety, rollback and incidents.
