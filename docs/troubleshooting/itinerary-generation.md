# Itinerary generation latency

The failing local request reached Gemini but exhausted the 120-second application
deadline. Inspection found that generation sent every saved attraction (up to 30),
every eligible saved food option (up to 20), and 60 proximity pairs. The request
included duplicate trip/budget fields, nulls, opening-hours text, provider names,
hotel provider IDs, quote timestamps and ratings that the ID-only output cannot use.
Gemini 3.8 Flash already used low thinking, but allowed 8,192 output tokens and
shared its model setting with future AI features. Increasing deadlines had not
addressed this workload.

## Request changes

- Attractions: `min(20, max(10, trip_days * daily_capacity + 5))`, limited to the
  available inventory. Daily capacities remain relaxed=2, balanced=3, packed=4.
- Attraction order: supported interest matches first, then the existing discovery
  distance/ID ranking. The interest mapping is shared with the semantic validator.
- Food: filter explicit dietary conflicts first, retain the cached deterministic
  recommendation score, then distance/name/ID ties. Select
  `min(12, max(10, trip_days * 2 + 2))` available food options.
- Compute proximity only over shortlisted attractions and keep the closest 30 pairs.
- An explicit payload allowlist sends IDs, names, categories, coordinates, relevant
  tags, ordinal ranks and trip constraints. Full source facts stay on the server
  for validation, display hydration and retention rules. JSON whitespace is removed.
- Existing saved itineraries can contain IDs outside the new shortlist. Weather
  adaptation retains its full validated candidate pool and verified weather inputs
  so those original choices remain available. Its candidate facts use the same
  compact projection.

## Model and deadlines

Backend configuration:

```dotenv
GEMINI_MODEL=gemini-3.8-flash
GEMINI_ITINERARY_MODEL=gemini-3.6-flash
```

The itinerary setting also applies to weather adaptation. `GEMINI_MODEL` remains
independent for future complex AI features. Restart FastAPI to load changed settings.
The new itinerary default applies even when the private environment only sets the
general model.

Gemini 3.6 Flash uses `thinking_level="minimal"`. Selecting Gemini 3.8 Flash uses
`thinking_level="low"`. Both retain the structured JSON schema and use
`max_output_tokens=6144`, without temperature/top_p/top_k. Google documents
[3.6 Flash as production-supported](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
and the [model-specific thinking controls](https://ai.google.dev/gemini-api/docs/thinking).

One provider attempt is bounded to 60 seconds. The entire generation/repair flow
has a 75-second deadline, inside the BFF's 90-second limit and leaving room for
weather adaptation's optional 12-second forecast request. The SDK allows one
transport attempt. No timeout, authentication, quota, configuration or unavailable
provider error triggers repair or fallback. A structurally valid response runs the
existing semantic validator; only semantic failures get one controlled repair,
within the remaining total budget. A second semantic failure is final.

Pydantic output validation, candidate-ID/date/pace checks, semantic rules,
server-generated factual display fields, internal authentication, ownership,
rate limits and signed atomic persistence remain enforced.

## Local measurements (2026-10-30)

These are individual live calls with synthetic saved-candidate data, not latency
percentiles or a guarantee for every provider request. All successful plans passed
the application's strict structural and semantic validation without a repair.

| Three-day balanced trip | Previous payload | Optimized payload |
| --- | ---: | ---: |
| Attractions | 30 | 14 |
| Food options | 20 | 10 |
| Proximity pairs | 60 | 30 |
| Prompt bytes | 19,030 | 8,192 |

This is a 57.0% prompt reduction. Prompt bytes mean UTF-8 system instruction plus
serialized content; they exclude the separately transmitted response schema. The
previous payload is reconstructed from the same candidate fixture using the old
full-context serialization and closest-60 proximity calculation.

| Live model / workload | Thinking | Elapsed | Result |
| --- | --- | ---: | --- |
| Gemini 3.8 Flash / optimized three-day balanced | low | 57.050 s | Valid, no repair |
| Gemini 3.6 Flash / optimized three-day balanced | minimal | 7.434 s | Valid, no repair |
| Gemini 3.6 Flash / optimized fourteen-day packed | minimal | 16.067 s | Valid, no repair |

The fourteen-day request used 20 attractions, 12 food options, 30 pairs and a
9,527-byte prompt. The model comparison supports choosing 3.6 Flash for this
latency-sensitive workload; it does not isolate prompt-size effects from provider
variability.

Before each call, safe logs contain only model, trip days, candidate/pair counts
and prompt bytes. Completion logs record elapsed milliseconds and response bytes.
Provider errors log status/type only, without raw bodies, tracebacks, keys or user
payloads.

## Changed files

- `backend/app/services/itinerary_context_service.py`: bounded deterministic shortlist.
- `backend/app/providers/llm/context.py`: compact payload allowlist.
- `backend/app/providers/llm/gemini.py`: model/thinking/output limits, metrics and safe errors.
- `backend/app/providers/llm/prompt.py`: rank guidance and prompt version `v2`.
- `backend/app/core/config.py`, `backend/.env.example`: independent itinerary model.
- `backend/app/schemas/itinerary.py`, `src/lib/itineraries/server.ts`: trusted food ranking signal.
- `backend/app/services/itinerary_generation_service.py`: total deadline and model attribution.
- `backend/app/services/weather_adaptation_service.py`: original candidate preservation/model attribution.
- `src/lib/destinations/backend.ts`: BFF deadline aligned to the bounded backend flow.
- `backend/tests/test_itineraries.py`, `backend/tests/test_weather.py`,
  `tests/itineraries-bff.test.mjs`: shortlist, ranking, IDs, caps, payload/log safety,
  strict validation, model configuration, deadlines/cancellation and no error repairs.
- `docs/troubleshooting/itinerary-generation.md`: investigation, measurements and validation.

## Validation

- `backend/.venv/Scripts/python.exe -m pytest -q --tb=short`: 280 passed.
- `npm.cmd run test:itineraries`: 17 passed, including actual database migration/RLS tests.
- `npm.cmd run typecheck`: passed (`next typegen` and TypeScript).
- `npm.cmd run lint`: passed (ESLint with no warnings).
- Ruff checks over every changed Python file: passed.
- Full backend Ruff: 45 existing violations in the uncommitted companion files
  (`app/companion/*`, `app/services/companion_context_service.py`); these unrelated
  files were left untouched.

Recommended commit: `fix: reduce itinerary context and use latency-optimized Gemini model`
