"""Explicit, bounded live reads. No deployments, migrations, bookings or fixture fallback."""

import argparse
import asyncio
import getpass
import json
import logging
import os
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from dotenv import dotenv_values
from google import genai
from google.genai import errors, types

from app.core.config import Settings
from app.core.errors import AppError
from app.providers.accommodations.stayapi import StayApiAccommodationProvider
from app.providers.food.geoapify import GeoapifyFoodProvider
from app.providers.geocoding.open_meteo import OpenMeteoGeocodingProvider
from app.providers.llm.gemini import GeminiLLMProvider
from app.providers.places.overpass import OpenStreetMapOverpassProvider, normalize_elements
from app.providers.routing.openrouteservice import OpenRouteServiceProvider
from app.providers.weather.open_meteo import OpenMeteoWeatherProvider
from app.schemas.accommodation import AccommodationSearchRequest
from app.schemas.food import FoodSearchRequest
from app.schemas.routing import RoutePoint, RouteRequest
from app.services.food_recommendation_service import FoodRecommendationService
from app.services.memory_embeddings import EmbeddingRequest, MemoryEmbeddings


async def run_checks(settings, *, ai=False, account=None, overpass=False, selected=None):
    results = []
    responses = []

    async def observed(response):
        responses.append(response.status_code)

    async def check(name, operation):
        if selected and name not in selected:
            return
        before, started = len(responses), time.monotonic()
        try:
            async with asyncio.timeout(55):
                details = await operation()
            result = {"check": name, "status": "PASS", **(details or {})}
        except AppError as exc:
            result = {"check": name, "status": "FAIL", "code": exc.code}
        except errors.APIError as exc:
            result = {
                "check": name,
                "status": "FAIL",
                "code": f"sdk_http_{exc.code}",
                "sdk_response": True,
            }
        except Exception as exc:
            # Exception messages/URLs/bodies can contain keys, prompts or account data.
            code = (
                "timeout"
                if isinstance(exc, (TimeoutError, httpx.TimeoutException))
                else "invalid_response_or_connection"
            )
            result = {"check": name, "status": "FAIL", "code": code}
        result.update(
            elapsed_ms=round((time.monotonic() - started) * 1000),
            http_responses=len(responses) - before,
            endpoint_responded=bool(len(responses) - before) or result.get("sdk_response", False),
        )
        results.append(result)
        print(json.dumps(result), flush=True)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(12, connect=4),
        follow_redirects=False,
        event_hooks={"response": [observed]},
    ) as client:

        async def geocoding():
            places = await OpenMeteoGeocodingProvider(client, settings).search(
                "Berlin", 3, "en", "DE"
            )
            if not places:
                raise AppError("empty_results", "No results")
            return {"records": len(places)}

        await check("open_meteo_geocoding", geocoding)
        today = datetime.now(UTC).date()

        async def weather():
            result = await OpenMeteoWeatherProvider(
                client, str(settings.open_meteo_forecast_url)
            ).forecast(52.52, 13.405, "Europe/Berlin", today, today)
            if not result:
                raise AppError("empty_results", "No results")

        await check("open_meteo_weather", weather)

        async def places():
            result = await OpenStreetMapOverpassProvider(client, settings).discover_nearby(
                52.52, 13.405, 8000, 5
            )
            if not result:
                raise AppError("empty_results", "No results")
            return {"records": len(result)}

        await check("places_application_failover", places)
        if overpass:
            for number, endpoint in enumerate(
                OpenStreetMapOverpassProvider(client, settings).endpoints(), 1
            ):

                async def query(endpoint=endpoint):
                    response = await client.post(
                        endpoint,
                        data={
                            "data": "[out:json][timeout:5];"
                            "node(around:2000,52.52,13.405)[tourism=museum];out 2;"
                        },
                        timeout=9,
                    )
                    if response.status_code != 200:
                        raise AppError(f"http_{response.status_code}", "Provider failure")
                    candidates = normalize_elements(response.json(), 52.52, 13.405, 8000, 2)
                    return {"records": len(candidates)}

                await check(f"overpass_endpoint_{number}", query)

        async def food():
            request = FoodSearchRequest(
                user_id=uuid4(),
                latitude=52.52,
                longitude=13.405,
                categories=["restaurant"],
                limit=5,
            )
            result = await GeoapifyFoodProvider(settings, client).search(request)
            if not result:
                raise AppError("empty_results", "No results")
            return {"records": len(result)}

        await check("geoapify_food", food)

        async def configured_food():
            result = await FoodRecommendationService(settings, client).search(
                FoodSearchRequest(
                    user_id=uuid4(),
                    latitude=52.52,
                    longitude=13.405,
                    destination_name="Berlin",
                    categories=["restaurant"],
                    limit=5,
                )
            )
            if not result.candidates:
                raise AppError("empty_results", "No configured food results")
            return {"records": len(result.candidates), "demo": result.demo}

        await check("configured_food", configured_food)

        async def hotels():
            start = today + timedelta(days=30)
            request = AccommodationSearchRequest(
                user_id=uuid4(),
                destination_key="live-smoke-berlin",
                destination_name="Berlin",
                destination_country="Germany",
                destination_timezone="Europe/Berlin",
                latitude=52.52,
                longitude=13.405,
                check_in=start,
                check_out=start + timedelta(days=1),
                travelers=1,
                rooms=1,
                currency="EUR",
                trip_budget="1000.00",
                budget_style="balanced",
            )
            result = await StayApiAccommodationProvider(client, settings).search(request)
            if not result:
                raise AppError("empty_results", "No results")
            return {"records": len(result)}

        await check("stayapi_hotels", hotels)

        async def routing():
            result = await OpenRouteServiceProvider(settings, client).route(
                RouteRequest(
                    points=[
                        RoutePoint(latitude=52.5163, longitude=13.3777),
                        RoutePoint(latitude=52.5186, longitude=13.3762),
                    ]
                )
            )
            if result.total_distance_meters <= 0:
                raise AppError("invalid_route", "Invalid route")

        await check("openrouteservice_route", routing)

        async def maps():
            response = await client.get("https://tiles.openfreemap.org/styles/liberty")
            if response.status_code != 200 or response.json().get("version") != 8:
                raise AppError(f"http_{response.status_code}", "Invalid map style")

        await check("maplibre_public_style", maps)

        if ai:

            async def companion():
                provider = GeminiLLMProvider(settings)
                result = await provider.chat(
                    [types.Content(role="user", parts=[types.Part(text="Reply exactly OK.")])], []
                )
                if not result.parts:
                    raise AppError("empty_response", "No AI response")
                return {"sdk_response": True, "model": provider.model_name}

            await check("companion_application", companion)
            for model in dict.fromkeys([settings.gemini_model, settings.gemini_itinerary_model]):

                async def generate(model=model):
                    async with genai.Client(
                        api_key=settings.gemini_api_key.get_secret_value(),
                        http_options=types.HttpOptions(
                            timeout=15000, retry_options=types.HttpRetryOptions(attempts=1)
                        ),
                    ).aio as sdk:
                        response = await sdk.models.generate_content(
                            model=model,
                            contents="Reply with exactly OK.",
                            config=types.GenerateContentConfig(
                                max_output_tokens=64,
                                thinking_config=types.ThinkingConfig(thinking_level="LOW"),
                            ),
                        )
                        if not response.text:
                            raise AppError("empty_response", "No AI response")
                    return {"sdk_response": True}

                await check(f"gemini_{model}", generate)

            async def embedding():
                result = await MemoryEmbeddings(settings).embed(
                    EmbeddingRequest(
                        user_id=uuid4(),
                        text="travel interests: museums, relaxed pace",
                        purpose="query",
                    )
                )
                return {"dimensions": len(result["embedding"]), "sdk_response": True}

            await check("gemini_memory_embeddings", embedding)

        root_env = {
            **dotenv_values(Path(__file__).resolve().parents[1] / ".env.local"),
            **os.environ,
        }
        origin, key = (
            root_env.get("NEXT_PUBLIC_SUPABASE_URL"),
            root_env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
        )
        if origin and key:
            parsed = urlsplit(origin)
            if (
                parsed.scheme != "https"
                or parsed.username
                or parsed.password
                or parsed.query
                or parsed.fragment
                or parsed.path not in {"", "/"}
                or not key.startswith("sb_publishable_")
            ):
                raise ValueError("Invalid Supabase configuration")
            headers = {"apikey": key}

            async def public_access():
                response = await client.get(
                    f"{origin.rstrip('/')}/rest/v1/trips",
                    params={"select": "id", "limit": 1},
                    headers=headers,
                )
                if response.status_code == 200 and response.json() == []:
                    return {"private_rows_exposed": False}
                if response.status_code in (401, 403):
                    return {"private_rows_exposed": False}
                raise AppError("unexpected_public_access", "Public access check failed")

            await check("supabase_anonymous_trip_isolation", public_access)

            async def public_sharing():
                response = await client.post(
                    f"{origin.rstrip('/')}/rest/v1/rpc/get_shared_trip",
                    headers=headers,
                    json={"p_token": "invalid"},
                )
                if response.status_code != 200 or response.json() is not None:
                    raise AppError(
                        f"http_{response.status_code}", "Sharing migration or access unavailable"
                    )

            await check("supabase_sharing_migration", public_sharing)
            if account:

                async def authentication():
                    response = await client.post(
                        f"{origin.rstrip('/')}/auth/v1/token?grant_type=password",
                        headers=headers,
                        json=account,
                    )
                    if response.status_code != 200:
                        raise AppError(
                            f"http_{response.status_code}", "Test account authentication failed"
                        )
                    token = response.json().get("access_token")
                    if not token:
                        raise AppError("missing_session", "Test account authentication failed")
                    headers["Authorization"] = f"Bearer {token}"
                    return {"authenticated": True}

                await check("supabase_test_account_login", authentication)
                if "Authorization" in headers:
                    for table in [
                        "trips",
                        "trip_interests",
                        "trip_place_candidates",
                        "trip_accommodation_selections",
                        "trip_food_selections",
                        "itinerary_versions",
                        "trip_budget_entries",
                        "companion_conversations",
                        "travel_preferences",
                        "travel_memories",
                        "trip_shares",
                    ]:

                        async def schema(table=table):
                            response = await client.get(
                                f"{origin.rstrip('/')}/rest/v1/{table}",
                                params={"select": "*", "limit": 0},
                                headers=headers,
                            )
                            if response.status_code != 200:
                                raise AppError(
                                    f"http_{response.status_code}", "Database schema unavailable"
                                )

                        await check(f"supabase_schema_{table}", schema)
        else:
            print(
                json.dumps(
                    {"check": "supabase", "status": "SKIP", "code": "configuration_missing"}
                ),
                flush=True,
            )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live",
        action="store_true",
        help="Authorize real, read-only provider requests; these may consume quota",
    )
    parser.add_argument(
        "--ai", action="store_true", help="Also make bounded generation and embedding calls"
    )
    parser.add_argument(
        "--overpass",
        action="store_true",
        help="Also test each public Overpass endpoint with a small query",
    )
    parser.add_argument(
        "--credentials-stdin",
        action="store_true",
        help="Read a test account JSON object from stdin without writing it to disk",
    )
    parser.add_argument(
        "--providers", help="Comma-separated check names; omitted checks do not make requests"
    )
    args = parser.parse_args()
    if not args.live:
        parser.error("Live requests require --live")
    logging.disable(logging.CRITICAL)
    account = None
    if args.credentials_stdin:
        raw = (
            getpass.getpass("Test account JSON (hidden): ")
            if sys.stdin.isatty()
            else sys.stdin.readline()
        )
        account = json.loads(raw)
        if set(account) != {"email", "password"}:
            parser.error("Expected email and password fields")
    try:
        results = asyncio.run(
            run_checks(
                Settings(),
                ai=args.ai,
                account=account,
                overpass=args.overpass,
                selected=set(args.providers.split(",")) if args.providers else None,
            )
        )
    except Exception:
        print(
            json.dumps(
                {
                    "check": "configuration_or_runner",
                    "status": "FAIL",
                    "code": "invalid_configuration_or_runner_error",
                }
            )
        )
        return 2
    if args.providers:
        missing = set(args.providers.split(",")) - {r["check"] for r in results}
        if missing:
            print(
                json.dumps(
                    {
                        "check": "selection",
                        "status": "SKIP",
                        "code": "not_executed",
                        "count": len(missing),
                    }
                )
            )
            return 2
    if not results:
        return 2
    return 1 if any(r["status"] == "FAIL" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
