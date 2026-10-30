# Weather intelligence and adaptive itineraries

Step 11 adds real Open-Meteo forecasts, deterministic outdoor-disruption guidance,
and optional weather adaptation of the current itinerary. Weather is optional;
provider failures do not block trip, hotel, food, itinerary or budget access.

## Architecture and trust

```text
Authenticated browser → Next.js BFF → owned saved trip + current itinerary
    → internal-key FastAPI → weather adapter → normalized forecast
    → deterministic risk/conflicts → explicit Adapt itinerary
    → existing Gemini provider + semantic validation + one repair
    → signed new itinerary version
```

Coordinates, timezone, dates, candidate IDs and itinerary contents are loaded on
the server. Browser requests supply only optional itinerary/version IDs and action
identifiers, never authoritative coordinates, forecast snapshots or candidates.
FastAPI rechecks weather availability using its own provider/cache before planning.
Gemini receives normalized data only, with no tokens, internal key, user ID, raw
provider JSON or database row internals. The trip ID is excluded from its context.

## Provider and forecast coverage

`WeatherProvider` separates acquisition from planning. `OpenMeteoWeatherProvider`
uses the configurable `/forecast` endpoint and the existing server HTTP client.
Provider requests have a 12-second total timeout, no immediate retries, bounded
response size, unit/array validation, and safe timeout/429/connection/payload errors.

The supported window is today through today + 15 days in the destination timezone,
following [Open-Meteo's forecast documentation](https://open-meteo.com/en/docs).
Only the intersection of that window and the saved trip is requested. Returned
dates with no actual daily measurements are excluded. Missing values stay `null`.

| Availability | Meaning |
| --- | --- |
| `available` | Every requested trip date has daily data |
| `partially_available` | Some dates have data; uncovered ranges are explicit |
| `not_yet_available` | The trip starts beyond the supported window; no provider or Gemini call |
| `past_trip` | The trip has ended; no live forecast or Gemini call |
| `unavailable` | No cached/current data is loaded or the provider returned no covered days |

Provider failures use safe application errors. Partial coverage is not extended
using seasonal averages, historical observations or model-generated predictions.
Daily coverage does not imply every variable/hour is available: incomplete periods
show limited data, and missing conditions are never assumed clear.

### Exact variables and normalization

Daily: `weather_code`, `temperature_2m_max`, `temperature_2m_min`,
`apparent_temperature_max`, `apparent_temperature_min`,
`precipitation_probability_max`, `precipitation_sum`, `wind_speed_10m_max`,
`sunrise`, `sunset`.

Hourly: `temperature_2m`, `apparent_temperature`, `precipitation_probability`,
`precipitation`, `weather_code`, `wind_speed_10m`.

Units are explicitly Celsius, millimeters and km/h. Unix timestamps are converted
with Python `ZoneInfo` to the saved destination timezone, rather than applying one
fixed offset across DST boundaries. No response coordinates replace the saved trip.

`WeatherForecast` contains provider, trusted coordinates/timezone, requested dates,
fetched/expiry timestamps, cache flag, coverage state, normalized daily records and
uncovered ranges. `DailyWeather` exposes nullable daily extrema/precipitation/wind,
sunrise/sunset and three `WeatherPeriod` records. A period has nullable measurements,
a friendly condition/icon, completeness, and machine-readable risk/reason codes.

### Period aggregation

Definitions live once in the Python adapter:

- Morning: hourly timestamps from 08:00 inclusive to 12:00 exclusive.
- Afternoon: 12:00 inclusive to 17:00 exclusive.
- Evening: 17:00 inclusive to 22:00 exclusive.

For those timestamps, temperature/apparent temperature use an arithmetic mean,
precipitation probability and wind use maxima, precipitation uses a sum, and the
weather condition uses the most disruptive supplied WMO code. Apparent-temperature
extrema are retained separately so a brief extreme is not hidden by an average.
These are approximate planning periods, not activity-specific conditions or routing
forecasts. Unknown codes retain an unknown label; no raw code is shown to users.

## Deterministic risk and place suitability

Thresholds, classification and compatibility scores live in
`backend/app/services/weather_risk_service.py`. They describe travel disruption,
not official warnings or guaranteed venue safety.

| Signal | Moderate | High |
| --- | --- | --- |
| Precipitation | Rain/drizzle/showers codes, probability ≥60%, or period sum ≥2 mm | Heavy-rain/showers codes or period sum ≥8 mm |
| Wind | ≥35 km/h | ≥50 km/h |
| Apparent temperature | Minimum ≤0°C or maximum ≥32°C | Minimum ≤−10°C or maximum ≥38°C |
| Snow/ice | Light/moderate snow codes | Heavy snow or freezing-precipitation codes |
| Thunderstorms | — | WMO 95/96/97/99 |

Any high signal wins, otherwise moderate wins. A complete period without those
signals is low. Incomplete periods without a known disruption signal are unknown.
Friendly labels and severity ordering follow the documented WMO interpretation table.

Museums, galleries and arts centres are generally classified indoor; parks and
viewpoints outdoor; historic sites and monuments mixed; generic attractions unknown.
Food, hotel and free-time references remain neutral/unknown and are not moved by
weather adaptation. These are category heuristics, not a claim that every venue is
covered or open. Ambiguous categories are never manufactured into indoor alternatives.

Compatibility scores (planning preferences, not safety probabilities):

| Setting | Low | Moderate | High | Unknown weather |
| --- | ---: | ---: | ---: | --- |
| Indoor | 100 | 100 | 100 | Unknown |
| Outdoor | 100 | 40 | 0 | Unknown |
| Mixed | 80 | 60 | 30 | Unknown |
| Unknown | Unknown | Unknown | Unknown | Unknown |

Outdoor attractions conflict with moderate/high periods. Mixed attractions receive
a cautious conflict only at high disruption. Indoor and unknown attractions do not
produce unsupported outdoor conflicts. Records contain date, period, candidate ID,
version-scoped item locator, classification, score, reasons and deterministic text.

## Cache, refresh and UI behavior

The bounded backend cache retains normalized forecasts for 30 minutes, with at
most 128 entries. Keys include coordinates, timezone, complete trip range and the
destination's current date. Identical concurrent loads share one provider task;
cancelling one waiter does not cancel other waiters. At most four provider requests
run concurrently; there is no unbounded waiting queue. Provider attempts are limited
to once per key per minute and 60 per process per minute, including failed attempts.

Opening Weather or Itinerary reads the cache only. A cache miss displays **Load
forecast**. Only explicit load/refresh or adaptation can fetch provider data.
**Refresh forecast** revalidates while respecting cooldown. Successful fetches
expose `fetched_at`/`expires_at`; the UI identifies cached data and shows its timestamp.
Expired cache entries are never returned as current. Refresh errors may leave an
earlier displayed snapshot visible with its original timestamp and an error.

`/trips/[tripId]/weather` shows daily cards, expandable periods, coverage gaps,
conflicts and Open-Meteo attribution. Itinerary days show compact weather when
available and explicit unavailable messages otherwise. Forecast loading is
asynchronous and optional, so it cannot prevent the saved plan rendering.
No load, refresh, effect or tab switch automatically changes an itinerary.

## Explicit adaptation

The current, non-stale itinerary can be adapted when forecast-covered conflicts
exist. The engine rebuilds trusted candidates and validates the original plan,
then supplies normalized weather, computed conflicts, candidate settings and
slot compatibility scores to the existing LLM provider.

The dedicated system prompt is versioned `weather-v1`. Gemini uses the same
async `google-genai` adapter, configured model, structured `GeneratedItinerary`
schema, timeout, concurrency/rate protection and single semantic repair as Step 9.
There is no second AI client, framework, factual prose generator or arithmetic path.

Validation preserves all unaffected activities and the day/period of food, hotel
and free-time references. A conflicted attraction may move only to fully covered
weather with a strictly better computed score, or be replaced by a supplied indoor
candidate in its original slot. Unrelated additions and dropping an activity
without such a replacement are rejected. Existing date, numbering, candidate-ID,
duplicate, pace, reason and dietary checks still apply. Uncovered or unknown
weather cannot be used as a loophole for moving an outdoor activity.
Unchanged choices retain their saved reason/notes; factual fields still come from
the current trusted candidates and remain subject to database validation.

Structurally valid but semantically invalid output gets one repair; a second
failure returns a safe error and preserves the current version. Malformed output,
provider timeouts/429 and authentication errors follow existing safe failure paths.
No conflicts/no coverage skips Gemini. An unchanged valid result is explained and
does not publish a duplicate version. Unresolved conflicts remain visible/warned.
The explicit development fixture planner keeps the original plan and cannot run
in production; it never fabricates weather.

## Persistence and concurrency

`20261030000800_weather_adaptation.sql` adds only `generation_reason`,
`parent_version_id`, and `weather_fetched_at` to the existing version table, plus
restricted reservation/completion RPCs. Existing rows default to `initial`.

Completion shares Step 9's full signed document/ID/date/capacity validation through
a private implementation. The initial-completion wrapper cannot complete a weather
reservation. Weather completion verifies the signed source version and original
document digest, current-parent identity, and forecast timestamp freshness, then
atomically creates the next ready version/current switch. Metadata cannot be
changed directly by authenticated clients. Previous days/items remain intact.
RLS, ownership, HMAC proofs, generation leases and rate limits remain in force.

There is no raw forecast history table. No adaptation code inserts, deletes, edits
or duplicates budget expenses. A moved/replaced activity may require a manual
budget review; adaptation never treats unknown venue prices as authoritative.
Unchanged/failed attempts use the existing failed-reservation lifecycle; version
numbers may have gaps, while previous ready versions remain accessible.

## Endpoints and deployment

Authenticated BFF:

- `GET /api/trips/[tripId]/weather` — cache-only read; optional `version_id` query.
- `POST /api/trips/[tripId]/weather/refresh` — JSON `{}` or owned `version_id`.
- `POST /api/trips/[tripId]/itinerary/adapt-weather` — JSON `request_id` UUID and
  `expected_version_id` UUID; never a client-authored plan or weather snapshot.

Internal-key FastAPI:

- `POST /api/v1/weather/forecast` — normalized trusted request and optional owned
  scheduled items; forecast/risk/conflict response.
- `POST /api/v1/itineraries/adapt-weather` — trusted planning input, original plan
  and destination context; weather is fetched/verified server-side.

Backend/Render configuration, with defaults and matching `backend/.env.example`:

```dotenv
WEATHER_PROVIDER=open_meteo
OPEN_METEO_FORECAST_URL=https://api.open-meteo.com/v1
```

No frontend key or new dependency is needed. Existing `GEMINI_API_KEY` and
`GEMINI_MODEL` remain FastAPI-only. Apply the new migration after Steps 1–10, or
run `npm run db:prepare` and apply its private ignored SQL in the matching Supabase
project. Do not share that generated file; it contains the existing signing secret.
Preparing the SQL never alters the hosted database. Restart/redeploy FastAPI and
Next.js after deploying the schema. Existing Render services can use the defaults.

The public Open-Meteo endpoint has usage/non-commercial restrictions; review the
[provider terms](https://open-meteo.com/en/terms) before commercial scaling.
Data attribution links to Open-Meteo and CC BY 4.0 are visible in the UI.

## Manual verification and limits

1. Apply the migration, start both services, sign in and open a confirmed trip.
2. Open Weather: a cold cache should offer Load forecast without a provider call.
3. For a trip within the supported window, load the forecast and inspect real
   daily/period values, timestamp, gaps and attribution.
4. Check a far-future trip and a past trip: no invented temperatures or AI calls.
5. Open the current itinerary. If conflicts exist, explicitly choose Adapt itinerary.
   Confirm the previous version stays available and the new version is labeled
   Weather adaptation. With no useful improvement, the saved plan stays unchanged.
6. Double-click refresh/adapt, simulate provider failure, and verify bounded
   requests, safe errors, unchanged previous content and usable trip navigation.
7. Confirm manual budget entries are unchanged; a second account cannot access
   the first account's weather/itinerary through a forged trip/version ID.

Caches and rate limits are per backend process, cleared on restart and not shared
across multiple Render workers/instances. Venue exposure remains a heuristic;
microclimates, official alerts, routes, historical/climate forecasts, live alerts,
receipt/expense reconciliation and automatic scheduling are outside this step.
The app does not guarantee conditions, suitability or safety. Follow local official
authorities for severe-weather information.
