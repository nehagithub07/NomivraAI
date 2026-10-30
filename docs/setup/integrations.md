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
