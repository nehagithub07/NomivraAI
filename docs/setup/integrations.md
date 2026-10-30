## AI Travel Companion (Step 12)

Reuse backend-only `LLM_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.8-flash` and
`GEMINI_API_KEY`. Chat extends the existing Gemini provider; no new AI SDK,
credential, browser key or database service-role client is introduced. The
existing `GEMINI_ITINERARY_MODEL` override remains available for planning.

Apply `20261030000900_ai_companion.sql` after migrations 1–8. The private
`npm run db:prepare` output includes the upgrade and uses the existing matching
internal key. Redeploy both services after applying the schema. Chat calls
internal-key FastAPI routes only through the authenticated Next.js BFF.

Hotel/food reads use existing caches, including bounded cache-only backend reads
across Vercel route instances; misses never trigger a live search. Search from
the existing trip tabs to populate recommendations. Weather reads are also
cache-only. Confirmed adaptation uses the existing Step 11 provider pipeline.
See [AI companion](../features/ai-companion.md) for the tool and confirmation design.

## Open-Meteo forecast integration

Step 11 calls weather providers only from FastAPI. Add these public configuration
values to `backend/.env` or Render if overriding the defaults:

```dotenv
WEATHER_PROVIDER=open_meteo
OPEN_METEO_FORECAST_URL=https://api.open-meteo.com/v1
```

The base URL appends `/forecast`; a complete `/forecast` URL is also supported.
HTTPS is required, with no embedded credentials/query/fragment. No frontend API
key is needed. Existing Gemini credentials remain FastAPI-only; weather alone does
not need Gemini. No `NEXT_PUBLIC_*` secret is added.

Open-Meteo provides up to 16 days of forecast coverage. Beyond that window, or for
past trips, NomivraAI shows explicit availability states without invented weather.
See [weather intelligence](../features/weather-intelligence.md) for exact variables,
cache/rate policies, attribution and provider terms. Adaptation also requires the
Step 11 migration and a current Step 9 itinerary using trusted candidates.
