import asyncio
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
import pytest
from pydantic import ValidationError
from test_itineraries import KEY, USER, ScriptedProvider, planning, sdk_transport

from app.core.config import Settings
from app.core.errors import AppError
from app.main import create_app
from app.providers.llm.gemini import GeminiLLMProvider
from app.providers.weather.codes import condition
from app.providers.weather.open_meteo import (
    DAILY_VARIABLES,
    HOURLY_VARIABLES,
    OpenMeteoWeatherProvider,
    normalize_forecast,
)
from app.schemas.itinerary import GeneratedItinerary
from app.schemas.weather import (
    DailyWeather,
    ScheduledWeatherItem,
    WeatherAdaptationRequest,
    WeatherForecast,
    WeatherPeriod,
    WeatherRequest,
)
from app.services.itinerary_generation_service import ItineraryGenerationService
from app.services.weather_adaptation_service import WeatherAdaptationService
from app.services.weather_risk_service import classify_setting, detect_conflicts, evaluate_risk
from app.services.weather_service import WeatherService

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)


def raw_weather(day=None, timezone="UTC", count=1):
    day = day or NOW.date()
    zone = ZoneInfo(timezone)
    first = datetime.combine(day, datetime.min.time(), zone)
    hours = [first + timedelta(hours=i) for i in range(24 * count)]

    def epoch(value):
        return int(value.timestamp())

    daily_values = {
        "weather_code": 63,
        "temperature_2m_max": 22,
        "temperature_2m_min": 13,
        "apparent_temperature_max": 23,
        "apparent_temperature_min": 12,
        "precipitation_probability_max": 80,
        "precipitation_sum": 5,
        "wind_speed_10m_max": 20,
        "sunrise": epoch(first + timedelta(hours=6)),
        "sunset": epoch(first + timedelta(hours=18)),
    }
    hourly_values = {
        "temperature_2m": 20,
        "apparent_temperature": 21,
        "precipitation_probability": 70,
        "precipitation": 1,
        "weather_code": 63,
        "wind_speed_10m": 15,
    }

    def units(variables):
        return {
            key: "°C"
            if "temperature" in key
            else "km/h"
            if "wind_speed" in key
            else "%"
            if "probability" in key
            else "mm"
            if "precipitation" in key
            else "unixtime"
            if key in ("sunrise", "sunset")
            else "wmo code"
            for key in variables
        }

    return {
        "timezone": timezone,
        "daily": {
            "time": [epoch(first + timedelta(days=i)) for i in range(count)],
            **{key: [value] * count for key, value in daily_values.items()},
        },
        "hourly": {
            "time": list(map(epoch, hours)),
            **{key: [value] * len(hours) for key, value in hourly_values.items()},
        },
        "daily_units": units(DAILY_VARIABLES),
        "hourly_units": units(HOURLY_VARIABLES),
    }


def period(**patch):
    value = WeatherPeriod.model_validate(
        dict(
            period="morning",
            temperature_c=20,
            apparent_temperature_c=20,
            apparent_temperature_max_c=20,
            apparent_temperature_min_c=20,
            precipitation_probability=0,
            precipitation_mm=0,
            weather_code=0,
            wind_speed_kmh=5,
            complete=True,
        )
        | patch
    )
    value.risk = evaluate_risk(value)
    return value


def request(**patch):
    return WeatherRequest.model_validate(
        dict(
            latitude=35.68,
            longitude=139.69,
            timezone="UTC",
            start_date=NOW.date(),
            end_date=NOW.date(),
        )
        | patch
    )


def test_normalization_aggregates_destination_local_periods_without_losing_extremes():
    raw = raw_weather(timezone="Asia/Tokyo")
    raw["hourly"]["weather_code"][11] = 95
    raw["hourly"]["apparent_temperature"][10] = 39
    days = normalize_forecast(raw, "Asia/Tokyo", NOW.date(), NOW.date())
    assert days[0].date == NOW.date()
    morning, afternoon, evening = days[0].periods
    assert morning.precipitation_mm == 4 and afternoon.precipitation_mm == 5
    assert evening.precipitation_probability == 70
    assert morning.apparent_temperature_max_c == 39
    assert morning.weather_code == 95 and morning.risk.level == "high"
    assert morning.risk.reasons == ["precipitation", "temperature_extreme", "thunderstorm"]
    assert morning.temperature_c == 20
    assert days[0].sunrise.tzinfo == ZoneInfo("Asia/Tokyo")


@pytest.mark.parametrize(
    "code,label",
    [
        (0, "Clear"),
        (63, "Rain"),
        (75, "Heavy snow"),
        (95, "Thunderstorm"),
        (97, "Heavy thunderstorm"),
        (123, "Conditions unavailable"),
    ],
)
def test_weather_code_labels(code, label):
    assert condition(code)[0] == label


@pytest.mark.parametrize(
    "patch,level,reason",
    [
        ({}, "low", None),
        ({"precipitation_probability": 65}, "moderate", "precipitation"),
        ({"precipitation_mm": 9}, "high", "heavy_precipitation"),
        ({"weather_code": 95}, "high", "thunderstorm"),
        ({"wind_speed_kmh": 55}, "high", "strong_wind"),
        ({"weather_code": 75}, "high", "snow_or_ice"),
        ({"apparent_temperature_min_c": -11}, "high", "temperature_extreme"),
        ({"complete": False}, "unknown", None),
    ],
)
def test_risk_rules_are_deterministic(patch, level, reason):
    risk = period(**patch).risk
    assert risk.level == level
    if reason:
        assert reason in risk.reasons


def test_conflicts_are_conservative_for_indoor_unknown_and_mixed_places():
    forecast = WeatherForecast(
        **request().model_dump(exclude={"refresh", "cache_only"}),
        availability="available",
        days=[DailyWeather(date=NOW.date(), periods=[period(weather_code=95)])],
    )
    items = [
        ScheduledWeatherItem(
            date=NOW.date(),
            period="morning",
            itinerary_item_id=str(index),
            candidate_id=f"node/{index + 1}",
            candidate_type="attraction",
            title=category,
            category=category,
        )
        for index, category in enumerate(["park", "museum", "gallery", "historic", "attraction"])
    ]
    conflicts = detect_conflicts(forecast, items)
    assert [item.title for item in conflicts] == ["park", "historic"]
    assert classify_setting("attraction") == "unknown"
    assert classify_setting("historic") == "mixed"
    assert classify_setting("restaurant", "food") == "unknown"


@pytest.mark.parametrize(
    "change", ["length", "units", "null_units", "bad_number", "duplicate", "null_day"]
)
def test_malformed_or_missing_series_never_fabricate_measurements(change):
    raw = raw_weather()
    if change == "length":
        raw["hourly"]["temperature_2m"].pop()
    elif change == "units":
        raw["daily_units"]["temperature_2m_max"] = "°F"
    elif change == "null_units":
        raw["hourly_units"] = None
    elif change == "bad_number":
        raw["hourly"]["temperature_2m"][0] = True
    elif change == "duplicate":
        raw["hourly"]["time"][1] = raw["hourly"]["time"][0]
    else:
        for key in DAILY_VARIABLES:
            raw["daily"][key] = [None]
        assert normalize_forecast(raw, "UTC", NOW.date(), NOW.date()) == []
        return
    with pytest.raises((ValueError, ValidationError)):
        normalize_forecast(raw, "UTC", NOW.date(), NOW.date())


@pytest.mark.parametrize(
    "mode,code",
    [
        ("timeout", "WEATHER_PROVIDER_TIMEOUT"),
        ("429", "WEATHER_PROVIDER_RATE_LIMITED"),
        ("connection", "WEATHER_PROVIDER_UNAVAILABLE"),
        ("invalid", "WEATHER_PROVIDER_INVALID_RESPONSE"),
    ],
)
async def test_weather_provider_failure_mapping_and_no_retries(mode, code):
    calls = []

    def handler(req):
        calls.append(req)
        if mode == "timeout":
            raise httpx.ReadTimeout("PRIVATE details")
        if mode == "connection":
            raise httpx.ConnectError("PRIVATE details")
        return httpx.Response(429 if mode == "429" else 200, json={"PRIVATE": "invalid"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AppError) as error:
            await OpenMeteoWeatherProvider(client, "https://api.open-meteo.com/v1").forecast(
                35, 139, "UTC", NOW.date(), NOW.date()
            )
    assert error.value.code == code and "PRIVATE" not in error.value.message
    assert len(calls) == 1


async def test_provider_requests_only_normalized_variables_units_and_unix_timestamps():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(200, json=raw_weather())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        days = await OpenMeteoWeatherProvider(
            client, "https://api.open-meteo.com/v1/forecast"
        ).forecast(35, 139, "UTC", NOW.date(), NOW.date())
    params = calls[0].url.params
    assert calls[0].url.path == "/v1/forecast" and len(days) == 1
    assert params["timeformat"] == "unixtime" and params["wind_speed_unit"] == "kmh"
    assert params["hourly"].split(",") == list(HOURLY_VARIABLES)
    assert params["daily"].split(",") == list(DAILY_VARIABLES)


class FakeWeatherProvider:
    def __init__(self, missing=False):
        self.calls = []
        self.missing = missing

    async def forecast(self, lat, lon, zone, first, last):
        self.calls.append((lat, lon, zone, first, last))
        await asyncio.sleep(0)
        return (
            []
            if self.missing
            else [
                DailyWeather(date=first + timedelta(days=i)) for i in range((last - first).days + 1)
            ]
        )


async def test_cache_only_tab_navigation_singleflight_refresh_and_bounded_cooldown():
    provider = FakeWeatherProvider()
    service = WeatherService(provider)
    assert (await service.forecast(request(cache_only=True), now=NOW)).availability == "unavailable"
    assert provider.calls == []
    first, duplicate = await asyncio.gather(
        service.forecast(request(), now=NOW), service.forecast(request(), now=NOW)
    )
    assert first.availability == "available" and duplicate.days == first.days
    assert len(provider.calls) == 1
    assert (await service.forecast(request(), now=NOW)).cached
    with pytest.raises(AppError) as error:
        await service.forecast(request(refresh=True), now=NOW)
    assert error.value.code == "WEATHER_RATE_LIMITED"
    service.attempts.clear()
    await service.forecast(request(refresh=True), now=NOW)
    assert len(provider.calls) == 2


@pytest.mark.parametrize("days,state", [(90, "not_yet_available"), (-10, "past_trip")])
async def test_future_and_past_trips_do_not_call_forecast_provider(days, state):
    provider = FakeWeatherProvider()
    service = WeatherService(provider)
    result = await service.forecast(
        request(
            start_date=NOW.date() + timedelta(days=days),
            end_date=NOW.date() + timedelta(days=days + 1),
        ),
        now=NOW,
    )
    assert result.availability == state and not result.days and result.fetched_at is None
    assert provider.calls == []


async def test_partial_coverage_returns_only_real_dates_and_missing_ranges():
    provider = FakeWeatherProvider()
    service = WeatherService(provider)
    value = await service.forecast(
        request(
            start_date=NOW.date() - timedelta(days=2), end_date=NOW.date() + timedelta(days=30)
        ),
        now=NOW,
    )
    assert value.availability == "partially_available" and len(value.days) == 16
    assert [gap.reason for gap in value.uncovered_ranges] == ["past", "outside_forecast_window"]
    empty = await WeatherService(FakeWeatherProvider(missing=True)).forecast(request(), now=NOW)
    assert (
        empty.availability == "unavailable" and empty.uncovered_ranges[0].reason == "missing_data"
    )


def adaptation_fixture():
    context = planning(
        start_date=NOW.date(), end_date=NOW.date() + timedelta(days=2), timezone="UTC"
    )
    context.attractions[0].category = "park"
    original = GeneratedItinerary.model_validate(
        {
            "days": [
                {
                    "date": str(NOW.date() + timedelta(days=i)),
                    "day_number": i + 1,
                    "theme": "mixed",
                    "items": [
                        {
                            "candidate_type": "attraction",
                            "candidate_id": f"node/{i + 1}",
                            "period": "morning",
                            "reason_code": "pace_balance",
                        },
                        {
                            "candidate_type": "free_time",
                            "candidate_id": None,
                            "period": "evening",
                            "reason_code": "free_time",
                        },
                    ],
                }
                for i in range(3)
            ]
        }
    )
    forecast = WeatherForecast(
        **request(end_date=context.end_date).model_dump(exclude={"refresh", "cache_only"}),
        availability="available",
        fetched_at=NOW,
        days=[
            DailyWeather(
                date=NOW.date() + timedelta(days=i),
                periods=[
                    period(weather_code=95 if i == 0 else 0),
                    period(period="afternoon"),
                    period(period="evening"),
                ],
            )
            for i in range(3)
        ],
    )

    class Weather:
        async def forecast(self, _request):
            return forecast

    req = WeatherAdaptationRequest(
        user_id=USER,
        context=context,
        parent_version_id=UUID("00000000-0000-4000-8000-000000000099"),
        original=original,
        forecast=request(end_date=context.end_date),
    )
    fixed = original.model_copy(deep=True)
    fixed.days[0].items[0].candidate_id = "node/4"
    return req, original, fixed, forecast, Weather()


async def test_successful_adaptation_reuses_provider_and_preserves_original_and_unaffected_days():
    req, original, fixed, _, weather = adaptation_fixture()
    before = original.model_dump_json()
    provider = ScriptedProvider([fixed])
    engine = ItineraryGenerationService(Settings(_env_file=None), provider)
    result = await WeatherAdaptationService(weather, engine).adapt(req)
    assert result.changed and result.prompt_version == "weather-v1"
    assert result.itinerary.days[0].items[0].candidate_id == "node/4"
    assert not result.remaining_conflicts and original.model_dump_json() == before
    assert len(provider.calls) == 1


@pytest.mark.parametrize("case", ["unknown", "date", "capacity", "unaffected", "uncovered", "food"])
async def test_invalid_weather_adaptation_has_one_repair(
    case,
):
    req, original, fixed, forecast, weather = adaptation_fixture()
    broken = fixed.model_copy(deep=True)
    if case == "unknown":
        broken.days[0].items[0].candidate_id = "node/999"
    elif case == "date":
        broken.days[0].date += timedelta(days=30)
    elif case == "capacity":
        broken.days[0].items = [
            broken.days[0].items[0].model_copy(update={"candidate_id": f"node/{i}"})
            for i in [4, 5, 6, 7]
        ]
    elif case == "unaffected":
        broken.days[1].items[0].candidate_id = "node/5"
    elif case == "food":
        broken.days[0].items[0].candidate_type = "food"
    else:
        broken = original.model_copy(deep=True)
        broken.days[0].items.pop(0)
        broken.days[1].items.insert(0, original.days[0].items[0])
        forecast.days = forecast.days[:1]
    provider = ScriptedProvider([broken, fixed])
    engine = ItineraryGenerationService(Settings(_env_file=None), provider)
    result = await WeatherAdaptationService(weather, engine).adapt(req)
    assert result.changed and len(provider.calls) == 2
    assert provider.calls[1]["validation_errors"]


async def test_two_bad_adaptations_fail_without_an_infinite_repair_loop():
    req, _, broken, _, weather = adaptation_fixture()
    broken.days[0].items[0].candidate_id = "node/999"
    provider = ScriptedProvider([broken, broken])
    engine = ItineraryGenerationService(Settings(_env_file=None), provider)
    with pytest.raises(AppError) as error:
        await WeatherAdaptationService(weather, engine).adapt(req)
    assert error.value.code == "ITINERARY_VALIDATION_FAILED" and len(provider.calls) == 2


async def test_no_conflicts_or_no_forecast_never_calls_gemini():
    for missing in [True, False]:
        req, _, _, forecast, weather = adaptation_fixture()
        if missing:
            forecast.days = []
            forecast.availability = "not_yet_available"
        else:
            forecast.days[0].periods[0] = period()
        provider = ScriptedProvider([])
        engine = ItineraryGenerationService(Settings(_env_file=None), provider)
        result = await WeatherAdaptationService(weather, engine).adapt(req)
        assert not result.changed and provider.calls == []


async def test_unchanged_valid_adaptation_warns_about_unresolved_weather_conflicts():
    req, original, _, _, weather = adaptation_fixture()
    engine = ItineraryGenerationService(Settings(_env_file=None), ScriptedProvider([original]))
    result = await WeatherAdaptationService(weather, engine).adapt(req)
    assert not result.changed and result.remaining_conflicts
    assert any("still have weather conflicts" in warning for warning in result.itinerary.warnings)


async def test_weather_routes_require_internal_auth_and_validate_inputs_safely():
    app = create_app(Settings(_env_file=None, nomvira_internal_api_key=KEY))
    app.state.weather = WeatherService(FakeWeatherProvider())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        body = {"forecast": request().model_dump(mode="json")}
        assert (await client.post("/api/v1/weather/forecast", json=body)).status_code == 401
        body["forecast"]["timezone"] = "PRIVATE invalid zone"
        response = await client.post(
            "/api/v1/weather/forecast", json=body, headers={"X-Nomvira-Internal-Key": KEY}
        )
        assert response.status_code == 422 and "PRIVATE" not in response.text


async def test_gemini_reuses_structured_sdk_with_weather_prompt_and_normalized_facts(monkeypatch):
    req, _, fixed, _, weather = adaptation_fixture()
    captured = []

    def handler(request):
        captured.append(request)
        payload = json.loads(request.content)
        content = json.loads(payload["contents"][0]["parts"][0]["text"])
        assert "itinerary adaptation planner" in str(payload["systemInstruction"])
        assert content["planning_context"]["verified_weather"]["provider"] == "open_meteo"
        assert content["planning_context"]["conflicts"][0]["risk_level"] == "high"
        assert content["planning_context"]["slot_scores"]
        assert "user_id" not in str(content) and "trip_id" not in str(content)
        assert "private-test-key" not in str(content)
        assert payload["generationConfig"]["responseMimeType"] == "application/json"
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {"role": "model", "parts": [{"text": fixed.model_dump_json()}]},
                        "finishReason": "STOP",
                    }
                ]
            },
        )

    sdk_transport(monkeypatch, handler)
    settings = Settings(_env_file=None, gemini_api_key="private-test-key")
    engine = ItineraryGenerationService(settings, GeminiLLMProvider(settings))
    result = await WeatherAdaptationService(weather, engine).adapt(req)
    assert result.changed and len(captured) == 1
