# Deploy NomviraAI with Vercel and Render

Step 12 requires `20261030000900_ai_companion.sql` after migrations 1–8. The
current `npm run db:prepare` includes this upgrade. Apply it before redeploying
Next.js and FastAPI. No new dependencies or environment secrets are needed;
`GEMINI_MODEL=gemini-3.8-flash` is used for chat through the existing provider.

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
See [database setup](backend/README.md#database-migration-and-deployment).

## 2. Deploy FastAPI to Render

Push the prepared changes to your GitHub repository. In Render, create a
**Blueprint**, connect this repository and use the root `render.yaml`.
It creates only the Python API, using:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Python | Latest Python 3.13 patch, from `backend/.python-version` |
| Build command | `pip install -r requirements.txt` |
| Start command | `python check_deployment.py && exec python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1` |
| Health check | `/health` |
| Instances / workers | **1 / 1** |

Render prompts for these environment values. Enter them in the dashboard:

| Variable | Value |
| --- | --- |
| `NOMVIRA_INTERNAL_API_KEY` | The same private key as Vercel and the database |
| `FRONTEND_ORIGIN` | Your planned Vercel HTTPS origin; update it if the assigned domain differs |
| `STAYAPI_API_KEY` | Your live StayAPI key |
| `GEOAPIFY_API_KEY` | Your Geoapify key |
| `GEMINI_API_KEY` | Your private Gemini key; FastAPI only |

The Blueprint sets `APP_ENV=production`, live accommodation/food providers, demo
accommodations disabled, and the configurable Open-Meteo/Overpass endpoints.
It also sets `LLM_PROVIDER=gemini` and `GEMINI_MODEL=gemini-3.8-flash` for Step 9.
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

The Blueprint starts on Render's **Free** compute plan for an initial preview.
Free instances sleep after 15 idle minutes and can take about a minute to wake,
which can exhaust the BFF's 60-second discovery timeout. For reliable production
use, select an always-on paid compute plan in Render and update `plan` in the
Blueprint accordingly. Keep one instance/worker while the limiter is in memory.
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
| `NOMVIRA_INTERNAL_API_KEY` | The same private key as Render and the database | Server only |

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
  query-parameter matching described in [AUTH_SETUP.md](AUTH_SETUP.md).
- Retain localhost redirect entries only if you still use local development.

Keep the existing Email/Google provider and confirmation/recovery email-template
configuration from [AUTH_SETUP.md](AUTH_SETUP.md). Google Cloud's OAuth callback
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
   occurs on rendering. See [Step 9 acceptance steps](STEP9_REPORT.md#validation-and-manual-acceptance).

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
[provider guidance](backend/README.md#providers-and-access-terms) before scaling.

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
