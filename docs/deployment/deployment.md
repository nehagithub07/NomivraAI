# Deploy NomviraAI with Vercel and Render

Step 15 adds Export & Share at `/trips/[tripId]/export` and public read-only
snapshots at `/share/[token]`. Apply all migrations in order, including Step 14's
`20261106001200_personalization_memory.sql` and Step 15's
`20261106001300_trip_sharing.sql`, before redeploying Next.js and FastAPI.
`npm run db:prepare` includes both upgrades. No new production dependencies,
service-role key, PDF service or environment secrets are required.

Keep one Render worker/instance: bounded Gemini turn state and provider caches
are process-local. Next.js companion message/confirmation routes declare
`maxDuration=120`; verify that the selected Vercel plan/runtime permits that
duration. Conversation/action records and rate/claim guards persist in Supabase.
Cache-only backend reads recover hotel/food recommendations across Vercel route
instances without running new provider searches. See [the companion deployment
and limitations](../features/ai-companion.md#verification-and-remaining-limits).

Deploy the repository root to **Vercel** (Next.js), and `backend/` to **Render**
(FastAPI). Keep your existing **Supabase** project for authentication and data.
Browser requests continue through the authenticated Next.js BFF. They never call
FastAPI directly or receive provider keys.

This repository contains the deployment configuration; a successful local build
does not establish that the hosted services, account settings or providers work.

## 1. Prepare credentials and the database

Use a random internal key of at least 32 characters. The **exact same value** must
be configured in Vercel, Render, and `nomvira_private.application_secrets` in your
Supabase database. Independently generated values cause authentication or signed
persistence failures. Before public deployment, rotate the real credentials that
were shared in chat or previously stored in source through their provider dashboards.

Keep the chosen internal key in the ignored root `.env.local` while preparing the
database. Do not upload this file or commit it. On Windows, use `npm.cmd` if
PowerShell blocks the `npm.ps1` wrapper.

For a new Supabase database, apply `supabase/migrations/20261028000100_create_trips.sql`
first. For an existing project, retain installed migrations and data. Then run:

```sh
npm run db:prepare
```

Run the generated **private** `.qa/setup-trip-database.sql` in that project's
Supabase SQL Editor. It upgrades supported existing schemas and configures the
database secret atomically. It retains trips and the signed RPC/RLS protections.
The generated SQL contains the internal key; do not share, commit or attach it.
See [database setup](../../backend/README.md#database-migration-and-deployment).

## 2. Deploy FastAPI to Render

Push the prepared changes to your GitHub repository. In Render, create a
**Blueprint**, connect this repository and use the root `render.yaml`.
It creates only the Python API, using:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Python | Latest Python 3.13 patch, from `backend/.python-version` |
| Build command | `pip install -r requirements.txt` |
| Start command | `python check_deployment.py && exec python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1 --no-access-log` |
| Health check | `/ready` |
| Instances / workers | **1 / 1** |

Render prompts for these environment values. Enter them in the dashboard:

| Variable | Value |
| --- | --- |
| `NOMVIRA_INTERNAL_API_KEY` | The same private key as Vercel and the database |
| `FRONTEND_ORIGIN` | Your planned Vercel HTTPS origin; update it if the assigned domain differs |
| `STAYAPI_API_KEY` | Your live StayAPI key |
| `GEOAPIFY_API_KEY` | Your Geoapify key |
| `GEMINI_API_KEY` | Your private Gemini key; FastAPI only |
| `OPENROUTESERVICE_API_KEY` | Your OpenRouteService routing key |

The Blueprint sets `APP_ENV=production`, live accommodation/food providers, demo
accommodations disabled, and the configurable Open-Meteo/Overpass endpoints.
It also sets `LLM_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.8-flash` for Companion,
and `GEMINI_ITINERARY_MODEL=gemini-3.6-flash` for itinerary generation.
For an existing Render service, add `GEMINI_API_KEY` manually before redeploying:
Blueprint secret prompts apply only during initial service creation. The itinerary
database migration is included by `npm run db:prepare`; apply the generated SQL.
Set `PROVIDER_USER_AGENT` to an identifying value such as `NomviraAI/0.1` plus your
actual website/contact once available. No secrets belong in this header.
The startup check reports missing/mistyped settings without printing their values.

Open `https://YOUR_API.onrender.com/health`, substituting your assigned domain.
It must return `{"status":"ok","service":"nomivra-api"}`. Copy the **HTTPS
origin**, without `/health` or `/api/v1`, for Vercel's `NOMVIRA_API_URL`.
This health check confirms the API is running; it does not contact providers.
`/ready` must return HTTP 200 and `{"status":"ready"}` after application startup;
it returns 503 before initialization and after its HTTP client closes. It checks
local services without consuming provider quota. Startup environment validation
remains mandatory; neither health endpoint validates provider credentials.

The Blueprint specifies Render's paid **Starter** plan for an always-on production
API. Review its current price before applying the Blueprint. A free preview can
sleep and wake too slowly for request deadlines; selecting free compute changes
the reliability expectations. Keep one instance/worker while the limiter is in memory.
Do not add automatic HTTP retries to compensate for a sleeping service.
See [Render's free-instance limits](https://render.com/docs/free).

## 3. Deploy Next.js to Vercel

Import the **same GitHub repository** into Vercel:

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Root directory | Repository root (`.`), **not** `src` or `backend` |
| Node.js | 24.x, selected by `package.json` |
| Install command | `npm ci` |
| Build command | `npm run check:deployment && npm run build` |
| Fluid compute | Enabled; discovery exports `maxDuration = 120` |

The commands/framework are also declared in `vercel.json`. Add these variables
for the **Production** environment before deploying:

| Variable | Value | Exposure |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your existing Supabase project's HTTPS origin | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Its `sb_publishable_...` key | Public |
| `NEXT_PUBLIC_SITE_URL` | Your final Vercel/custom-domain HTTPS origin | Public |
| `NOMVIRA_API_URL` | Your FastAPI HTTPS origin on Render | Server only |
| `NOMVIRA_INTERNAL_API_KEY` | The same private key as Render and the database; also seals sharing tokens | Server only |
| `NEXT_PUBLIC_MAP_STYLE_URL` | Public HTTPS MapLibre style; defaults to the OpenFreeMap style in `.env.example` | Public |

Use real origins, without paths or queries. Do not use localhost, the Render
internal hostname, a Supabase dashboard URL or a Supabase secret/service-role key.
Keep StayAPI and Geoapify keys only in Render. Never prefix private keys with
`NEXT_PUBLIC_`.
Keep `GEMINI_API_KEY` only in Render too. The itinerary generation function uses a
180-second execution limit around its bounded backend call and signed persistence.

The build check rejects missing settings, localhost URLs, placeholder credentials
and known private keys exposed through public variables. It does not log values
or test provider connectivity. Public variables are embedded at build time:
**redeploy Vercel after changing them**. If the initial assigned domain differs
from your planned domain, update `NEXT_PUBLIC_SITE_URL`, Render's
`FRONTEND_ORIGIN`, and Supabase's settings below, then redeploy.

For a Vercel Preview environment, use its own intended canonical origin and
matching Supabase redirect entries. Do not give untrusted pull-request previews
production secrets. See [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
and [function duration](https://vercel.com/docs/functions/configuring-functions/duration).

## 4. Configure Supabase authentication

In Supabase **Authentication > URL Configuration**:

- Set **Site URL** to your final Vercel/custom-domain HTTPS origin.
- Add that origin's `/auth/callback` and `/auth/confirm` redirect URLs, with the
  query-parameter matching described in [authentication setup](../setup/authentication.md).
- Retain localhost redirect entries only if you still use local development.

Keep the existing Email/Google provider and confirmation/recovery email-template
configuration from [authentication setup](../setup/authentication.md). Google Cloud's OAuth callback
remains the **Supabase** callback URL, not the Vercel URL. No auth redesign,
service-role credential or RLS bypass is required.

## 5. Verify the hosted application

1. Check Render `/health` returns 200. For a Free instance, wait until it is awake.
2. Open the final Vercel URL and sign in. Refresh to verify cookie sessions.
3. Create a trip by selecting a real destination, then reopen the saved trip.
4. Click **Discover places** once. Expect one normal client request, a backend
   discovery slot, an Overpass call, signed persistence, and HTTP 200 in Vercel.
5. Reload the trip. Saved places should display without another Overpass request.
6. Verify live hotels/food and saved selections; production must never use fixtures.
7. Sign in as another user and verify they cannot read the first user's trip.
8. Open **Itinerary**, generate once, reload, then deliberately generate a new
   version after the cooldown. Verify old versions remain and no extra request
   occurs on rendering. See [itinerary acceptance steps](../features/ai-itinerary.md).
9. Record a budget entry; verify planned/actual totals and unknown costs remain
   deterministic. Load weather explicitly and verify a provider failure leaves
   the saved itinerary and budget usable.
10. Ask Companion a read question and request a change. Verify a write executes
    only after structured confirmation. Open Maps and calculate a route once;
    missing coordinates must not be filled with invented locations or durations.
11. Open Settings, edit defaults, opt into memory, explicitly remember choices,
    create a new trip and verify defaults. Delete a memory and turn consent off;
    later planning must not retrieve it. A stalled optional memory read now has
    an eight-second total deadline and cancels its requests before falling back.
12. Open Export & Share on mobile, tablet and desktop. Download the actual PDF,
    use Print / Save PDF, and check selected hotel, food and budget availability.
    Verify map links only exist for known coordinates. Missing detail must remain
    unavailable and export must not generate another Gemini itinerary.
13. Preview sharing with extras unchecked: hotel and food items must be omitted
    from the day plan too, and budget totals must be absent. Approve and create a
    link. Open it in an incognito window without signing in; check that no profile,
    memories, chat, special requests, expense descriptions or internal IDs appear.
14. Re-copy the link after a reload, replace it and verify the previous link fails.
    Revoke and verify new incognito requests fail. A second account must not
    export, publish, revoke or edit the first account's trip. Existing downloaded
    copies and already rendered pages cannot be recalled.

If discovery fails, inspect the safe error code in Vercel/Render logs:

| Code | Meaning / next check |
| --- | --- |
| `auth_unavailable` | Vercel cannot verify the Supabase session; check its configured project/connectivity |
| `unauthorized` (401) | Sign in again; backend-only 401s also require checking the matching internal keys |
| `PLACES_RATE_LIMITED` | The backend's bounded discovery queue is saturated |
| `PLACES_PROVIDER_RATE_LIMITED` | Overpass returned 429; wait before another deliberate attempt |
| `PLACES_PROVIDER_CONNECT_TIMEOUT` / `PLACES_PROVIDER_CONNECTION_ERROR` | Render cannot connect to `OVERPASS_API_URL`; inspect provider/network availability |
| `PLACES_PROVIDER_UNAVAILABLE` | Provider response/read timeout or upstream service failure |
| `persistence_unavailable` | Check installed migrations and the matching private database signing secret |

The local machine previously timed out connecting to Overpass and intermittently
failed DNS resolution. Hosting changes where that connection originates; it does
not guarantee the provider is reachable. Verify the hosted request before calling
discovery fixed. Public Overpass can throttle or fail, and Open-Meteo's public
service has usage restrictions; retain the protections and review the existing
[provider guidance](../../backend/README.md#providers-and-access-terms) before scaling.

## Export, sharing and release checks

PDF downloads are generated locally from a strict export document using the
browser's font fallback, supporting international place names. The downloadable
PDF uses high-resolution page images with clickable map/directions annotations;
use **Print / Save PDF** for selectable text and the accessible HTML document.
No Chromium server or PDF dependency is deployed. Export uses saved itinerary and
food data, cached hotel facts where present, and the existing budget engine.
It never refreshes live quotes or calls Gemini. Periods such as morning are not
verified venue hours. Food lists include up to 50 most recently saved spots, with
that bound shown on documents reaching the limit. Directions links connect the
first and last mapped stops;
they are not a calculated full-day route or a promise about travel time.

Sharing is a fixed snapshot, not live access to a trip. The owner explicitly
approves destination, dates and activities and can separately include hotel,
food and aggregate budget information. It expires after 1, 7 or 30 days. One link
per trip is active at a time. Tokens have 256 bits of randomness, are hashed for
lookup, and have an AES-GCM encrypted owner copy bound to the trip. Before
rotating the internal key, revoke existing links and create replacements after
updating the same key on all services and in the database.

`trip_shares` has owner-only RLS and no direct client writes. Its write RPC verifies
an application-signed exact document, current ownership, allowed fields and
sharing options. Its revision check prevents an older in-flight creation from
undoing revocation. Revoke clears the snapshot and encrypted token; trip/account
deletion cascades shares. Expired snapshots are inaccessible; the owner can use
Revoke to remove them. The anonymous read RPC can return only the approved
snapshot for an unexpired token, never a table row or private trip context.

Public rendering uses a cookie-free Supabase publishable client. Shared pages are
dynamic, `no-store`, `noindex` and `no-referrer`; errors distinguish temporary
service failure from an unavailable link without exposing database details.
Framing and MIME sniffing are disabled. Treat sharing URLs as bearer credentials
and restrict access to platform request logs; Next request logging suppresses
their paths. Render uses application status/request-ID logging without access
URLs, credentials, request bodies or raw unexpected exceptions. CORS remains
closed because browsers use the authenticated Next BFF.

The production dashboard now uses the owner's saved upcoming/completed trips.
Presentation fixtures require an explicit development preview. Existing provider
fixture guards remain active, and PDF/shared exports exclude fixture itineraries,
hotels and food. Common loading/error states, horizontally scrollable trip tabs,
bounded Supabase requests and synchronous route/share/download submission locks
provide recovery without automatic provider or Gemini retries.

Run `npm run typecheck`, `npm run lint`, `npm run test:sharing`, the existing
domain suites and `npm run build`; run `python -m pytest -q` in `backend/` and
`python -m ruff check` for changed Python files. `npm run check:deployment` and
`python backend/check_deployment.py` validate production settings without printing
values. They intentionally reject local development origins/settings.

Local verification for Step 15: 197 JavaScript/SQL checks on Node 24 and 340 Python checks
passed, including signup/authentication contracts, trip creation, places, hotels,
food, itinerary, budget, weather, Companion, routing, memory and sharing. After
the optional-memory deadline change, its affected 18 BFF checks and health tests
were rerun. Typecheck, ESLint and production build passed. Browser checks at 360,
768 and 1440 pixels verified export/share rendering, no horizontal overflow,
explicit approval, duplicate-click suppression, copy/revoke controls, real PDF
download and print controls; sharing API responses were mocked in that component
smoke test. A local production server returned 401 for anonymous export, share
management and memory APIs and 404/no-store for invalid public links. Browser PDF
rendering was inspected with Japanese, Devanagari and accented Latin text. A
14-day document with long activity names also downloaded and rendered across
multiple PDF pages. Final targeted checks verified recovery of the active link's
sharing options after reload and the 50-food-spot document bound.

These checks are not a hosted deployment or a live authenticated acceptance run.
Before release, run the complete hosted journey above with a confirmed account,
applied migrations and live provider credentials. Verify Vercel execution limits,
Supabase auth redirects/RLS advisers and the paid Render plan. The local execution
host uses Node 26; Node 24.22.2 was also used for the JavaScript suite, ESLint and
production build. No live provider, email verification or hosted deployment success
is claimed by the automated checks.

Reference: [Render Blueprint specification](https://render.com/docs/blueprint-spec).

## Step 11 weather deployment

Apply `supabase/migrations/20261030000800_weather_adaptation.sql` after the existing
migrations. `npm run db:prepare` includes it in the private ignored setup SQL and
remains safe to rerun against the supported schema. The command prepares a file;
it does not apply changes to the hosted database.

Render now declares `WEATHER_PROVIDER=open_meteo` and
`OPEN_METEO_FORECAST_URL=https://api.open-meteo.com/v1`. These are also backend
defaults, so existing services need no new secret. Keep the existing Gemini key
only on Render. Vercel adds no new environment variable and continues using the
existing BFF/internal-key connection. Redeploy both services after the migration.

Weather caches and rate limits are process-local. Cold starts or multiple backend
workers may have empty/independent caches; loading a trip tab never forces a
provider fetch. Use Load/Refresh forecast explicitly. Forecast failure leaves the
trip, itinerary and budget available. Follow [manual weather verification and
limits](../features/weather-intelligence.md#manual-verification-and-limits) before
claiming hosted acceptance.
