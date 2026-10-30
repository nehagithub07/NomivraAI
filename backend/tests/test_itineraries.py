import asyncio
import json
import logging
from datetime import UTC, date, datetime, timedelta
from itertools import combinations
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.main import create_app
from app.providers.llm.base import LLMProvider
from app.providers.llm.context import compact_planning_context
from app.providers.llm.fixture import FixtureLLMProvider
from app.providers.llm.gemini import GeminiLLMProvider
from app.providers.llm.prompt import ITINERARY_PROMPT_VERSION, SYSTEM_PROMPT
from app.schemas.itinerary import ItineraryGenerationRequest, PlanningInput
from app.services.itinerary_context_service import build_planning_context
from app.services.itinerary_generation_service import ItineraryGenerationService
from app.services.itinerary_validation_service import resolve_itinerary, semantic_errors

USER = UUID("00000000-0000-4000-8000-000000000001")
TRIP = UUID("00000000-0000-4000-8000-000000000002")
KEY = "test-internal-application-key-never-real"


def planning(**changes):
    return PlanningInput.model_validate(
        {
            "trip_id": str(TRIP),
            "destination_name": "Tokyo",
            "country": "Japan",
            "timezone": "Asia/Tokyo",
            "start_date": "2099-04-12",
            "end_date": "2099-04-14",
            "travelers": 2,
            "budget_total": "2500.00",
            "currency": "USD",
            "budget_style": "balanced",
            "travel_pace": "balanced",
            "interests": ["history", "food"],
            "accommodation_preferences": ["hotel"],
            "dietary_preferences": ["vegetarian"],
            "special_requests": "Include rest breaks.",
            "attractions": [
                {
                    "candidate_id": f"node/{i}",
                    "name": f"Provider Museum {i}",
                    "category": "museum",
                    "latitude": 35.69 + i / 10000,
                    "longitude": 139.69,
                    "distance_km": i / 10,
                    "opening_hours": None,
                }
                for i in range(1, 9)
            ],
            "food": [{"candidate_id": "real-food-id", "name": "Saved Cafe", "category": "cafe"}],
            **changes,
        }
    )


def dense_planning(**changes):
    base = planning().model_dump()
    base["attractions"] = [
        {
            **base["attractions"][0],
            "candidate_id": f"node/{i}",
            "name": f"Saved Place {i}",
            "category": "park" if i <= 20 else "museum",
            "latitude": 35.69 + i / 10000,
            "distance_km": (31 - i) / 10,
            "opening_hours": "Unverified provider opening hours; confirm before visiting.",
        }
        for i in range(1, 31)
    ]
    base["food"] = [
        {
            "candidate_id": f"saved-food-{i}",
            "provider": "geoapify",
            "name": f"Saved Cafe {i}",
            "category": "cafe",
            "cuisine_types": ["japanese"],
            "dietary_tags": ["vegetarian"],
            "latitude": 35.69,
            "longitude": 139.69,
            "distance_km": i / 10,
            "recommendation_score": i / 20,
        }
        for i in range(1, 21)
    ]
    return PlanningInput.model_validate({**base, **changes})


@pytest.mark.parametrize(
    "days,pace,attraction_count,food_count",
    [
        (1, "relaxed", 10, 10),
        (3, "relaxed", 11, 10),
        (3, "balanced", 14, 10),
        (3, "packed", 17, 10),
        (5, "packed", 20, 12),
        (14, "packed", 20, 12),
    ],
)
def test_context_shortlist_depends_on_duration_pace_and_has_hard_caps(
    days, pace, attraction_count, food_count
):
    source = dense_planning(end_date=date(2099, 4, 12) + timedelta(days=days - 1), travel_pace=pace)
    context = build_planning_context(source)
    assert len(context.attractions) == attraction_count
    assert len(context.food) == food_count
    assert len(context.proximity) == 30
    selected = {item.candidate_id for item in context.attractions}
    assert all(
        pair.first_id in selected and pair.second_id in selected for pair in context.proximity
    )
    assert len(source.attractions) == 30 and len(source.food) == 20  # Input is unchanged.
    if days == 14:
        assert any("unscheduled" in warning for warning in context.warnings)


def test_context_keeps_interest_matches_then_existing_distance_and_food_ranking():
    source = dense_planning()
    source.food[-1].dietary_conflicts = ["vegetarian"]
    context = build_planning_context(source)
    assert [item.candidate_id for item in context.attractions] == [
        f"node/{i}" for i in range(30, 16, -1)
    ]
    assert [item.candidate_id for item in context.food] == [
        f"saved-food-{i}" for i in range(19, 9, -1)
    ]
    assert all(item in source.attractions for item in context.attractions)
    assert all(item in source.food for item in context.food)
    source.interests = ["nature"]
    assert [item.candidate_id for item in build_planning_context(source).attractions] == [
        f"node/{i}" for i in range(20, 6, -1)
    ]


def test_shortlisting_is_deterministic_for_ties_and_missing_food_scores():
    source = dense_planning()
    for item in source.food:
        item.recommendation_score = None
        item.distance_km = None
    original = build_planning_context(source)
    source.food.reverse()
    source.attractions.reverse()
    assert build_planning_context(source) == original


def test_compact_context_preserves_ids_and_excludes_provider_metadata_and_nulls():
    source = dense_planning(
        hotel={
            "candidate_id": str(TRIP),
            "provider_accommodation_id": "123",
            "name": "Saved Hotel",
            "guest_rating": 4.5,
            "guest_rating_scale": 5,
        }
    )
    context = build_planning_context(source)
    payload = compact_planning_context(context)
    assert [item["candidate_id"] for item in payload["attractions"]] == [
        item.candidate_id for item in context.attractions
    ]
    assert [item["candidate_id"] for item in payload["food"]] == [
        item.candidate_id for item in context.food
    ]
    assert payload["hotel"] == {"candidate_id": str(TRIP), "name": "Saved Hotel"}
    assert payload["attractions"][0]["interest_tags"] == ["history"]
    assert payload["attractions"][0]["rank"] == 1
    text = json.dumps(payload)
    for field in (
        "provider",
        "provider_accommodation_id",
        "trip_id",
        "opening_hours",
        "quote_expires_at",
        "guest_rating",
        "distance_km",
        "recommendation_score",
    ):
        assert f'"{field}"' not in text
    assert "null" not in text and "Unverified provider opening hours" not in text


def test_compact_context_substantially_reduces_full_candidate_prompt():
    source = dense_planning()
    full = build_planning_context(source, trim_candidates=False).model_dump(
        mode="json", exclude={"trip_id"}
    )
    # The previous pipeline sent the nearest 60 pairs over all discovered attractions.
    full["proximity"] = [
        {"first_id": a.candidate_id, "second_id": b.candidate_id, "straight_line_km": 0.1}
        for a, b in list(combinations(source.attractions, 2))[:60]
    ]
    for food in full["food"]:
        food.pop("recommendation_score")  # Not part of the previous request.
    before = json.dumps({"planning_context": full}, ensure_ascii=False).encode("utf-8")
    after = json.dumps(
        {"planning_context": compact_planning_context(build_planning_context(source))},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    assert len(after) < len(before) * 0.6


async def test_trimmed_context_passes_strict_validation_and_rejects_excluded_ids():
    plan, context = await fixture_plan(dense_planning())
    from app.schemas.itinerary import GeneratedItinerary

    assert GeneratedItinerary.model_validate_json(plan.model_dump_json()) == plan
    assert semantic_errors(plan, context) == []
    plan.days[0].items[0].candidate_id = "node/1"
    assert "unknown_attraction_id" in semantic_errors(plan, context)


async def fixture_plan(source=None):
    context = build_planning_context(source or planning())
    return await FixtureLLMProvider().generate_itinerary(context), context


class ScriptedProvider(LLMProvider):
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    async def generate_itinerary(self, context, **feedback):
        self.calls.append(feedback)
        result = next(self.responses)
        if isinstance(result, Exception):
            raise result
        return result


async def test_valid_generation_uses_trusted_titles_and_no_invented_facts():
    plan, context = await fixture_plan()
    assert semantic_errors(plan, context) == []
    result = resolve_itinerary(plan, context)
    assert result.days[0].items[0].title == "Provider Museum 1"
    assert all(
        item.candidate_id in {p.candidate_id for p in context.attractions}
        for day in result.days
        for item in day.items
        if item.candidate_type == "attraction"
    )
    assert "prices" not in result.model_dump()
    assert result.days[0].items[-1].latitude is None  # Food search metadata stays transient.
    assert result.title == "Your Tokyo itinerary"


@pytest.mark.parametrize(
    "field", ["title", "notes", "price", "rating", "opening_hours", "travel_minutes"]
)
async def test_valid_draft_cannot_add_invented_factual_fields(field):
    from app.schemas.itinerary import GeneratedItinerary

    plan, _ = await fixture_plan()
    payload = plan.model_dump(mode="json")
    payload["days"][0]["items"][0][field] = "INVENTED FACT"
    with pytest.raises(ValidationError):
        GeneratedItinerary.model_validate(payload)


@pytest.mark.parametrize(
    "kind,identifier,expected",
    [
        ("attraction", "node/999999", "unknown_attraction_id"),
        ("food", "invented-restaurant", "unknown_food_id"),
        ("hotel", "invented-hotel", "hotel_must_match_selected_accommodation"),
    ],
)
async def test_unknown_or_cross_type_ids_rejected(kind, identifier, expected):
    plan, context = await fixture_plan()
    item = plan.days[0].items[0]
    item.candidate_type, item.candidate_id = kind, identifier
    assert expected in semantic_errors(plan, context)


async def test_dates_day_numbers_duplicates_and_period_order_are_validated():
    plan, context = await fixture_plan()
    plan.days[1].date = date(2099, 5, 1)
    plan.days[1].day_number = 9
    plan.days[1].items[0].candidate_id = plan.days[0].items[0].candidate_id
    plan.days[0].items.reverse()
    failures = semantic_errors(plan, context)
    assert {
        "dates_must_exactly_match_trip_in_order",
        "day_numbers_must_be_consecutive",
        "duplicate_attraction",
        "periods_must_be_ordered",
    } <= set(failures)
    plan.days.pop()
    assert "dates_must_exactly_match_trip_in_order" in semantic_errors(plan, context)


@pytest.mark.parametrize("pace,capacity", [("relaxed", 2), ("balanced", 3), ("packed", 4)])
async def test_daily_capacity_is_deterministic_and_enforced(pace, capacity):
    plan, context = await fixture_plan(planning(travel_pace=pace))
    assert context.max_attractions_per_day == capacity
    assert semantic_errors(plan, context) == []
    plan.days[0].items.insert(1, plan.days[0].items[0].model_copy())
    assert "daily_attraction_capacity_exceeded" in semantic_errors(plan, context)


def test_context_decimal_budget_and_geographic_data_are_deterministic():
    source = planning(
        budget_total="0.30",
        hotel={
            "candidate_id": "00000000-0000-4000-8000-000000000003",
            "provider_accommodation_id": "123",
            "name": "Provider Hotel",
            "total_price": "0.20",
            "currency": "USD",
            "quote_expires_at": datetime.now(UTC) + timedelta(minutes=5),
        },
    )
    context = build_planning_context(source)
    assert context.budget.remaining_known_budget == "0.10"
    assert context.proximity[0].straight_line_km >= 0
    source.hotel.currency = "EUR"
    assert build_planning_context(source).budget.remaining_known_budget is None
    source.hotel.currency = "USD"
    source.hotel.quote_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert build_planning_context(source).budget.known_accommodation_total is None


async def test_hotel_id_matches_selection_and_live_hotel_metadata_is_not_persisted():
    source = planning(
        hotel={
            "candidate_id": str(TRIP),
            "provider_accommodation_id": "123",
            "name": "Transient Hotel",
            "total_price": "100.00",
            "currency": "USD",
        }
    )
    plan, context = await fixture_plan(source)
    plan.days[0].items[-1].candidate_type = "hotel"
    plan.days[0].items[-1].candidate_id = str(TRIP)
    plan.days[0].items[-1].reason_code = "selected_stay"
    assert semantic_errors(plan, context) == []
    document = resolve_itinerary(plan, context)
    assert document.days[0].items[-1].title == "Selected accommodation"
    assert "Transient Hotel" not in document.model_dump_json()
    assert "100.00" not in document.model_dump_json()


async def test_one_semantic_repair_succeeds_and_never_retries_indefinitely():
    good, _ = await fixture_plan()
    bad = good.model_copy(deep=True)
    bad.days[0].items[0].candidate_id = "node/999999"
    provider = ScriptedProvider([bad, good])
    service = ItineraryGenerationService(Settings(_env_file=None), provider)
    result = await service.generate(ItineraryGenerationRequest(user_id=USER, context=planning()))
    assert result.prompt_version == ITINERARY_PROMPT_VERSION
    assert len(provider.calls) == 2
    assert provider.calls[1]["validation_errors"] == ["unknown_attraction_id"]
    assert provider.calls[1]["previous"] is bad


async def test_second_semantic_failure_returns_graceful_error_and_releases_slot():
    bad, _ = await fixture_plan()
    bad.days[0].items[0].candidate_id = "node/999999"
    provider = ScriptedProvider([bad, bad])
    service = ItineraryGenerationService(Settings(_env_file=None), provider)
    with pytest.raises(AppError) as error:
        await service.generate(ItineraryGenerationRequest(user_id=USER, context=planning()))
    assert error.value.code == "ITINERARY_VALIDATION_FAILED" and len(provider.calls) == 2
    assert service.concurrent._value == 2


async def test_missing_attractions_never_calls_provider():
    provider = ScriptedProvider([])
    service = ItineraryGenerationService(Settings(_env_file=None), provider)
    with pytest.raises(AppError, match="Discover places"):
        await service.generate(
            ItineraryGenerationRequest(user_id=USER, context=planning(attractions=[]))
        )
    assert not provider.calls


async def test_missing_food_and_dietary_conflicts_are_safe():
    context = build_planning_context(
        planning(
            food=[
                {
                    "candidate_id": "conflict",
                    "name": "Saved Venue",
                    "category": "restaurant",
                    "dietary_conflicts": ["vegetarian"],
                }
            ]
        )
    )
    assert context.food == []
    assert any("Restaurant recommendations" in warning for warning in context.warnings)
    assert any("dietary conflicts" in warning for warning in context.warnings)
    plan = await FixtureLLMProvider().generate_itinerary(context)
    assert semantic_errors(plan, context) == []


async def test_fixture_is_explicit_and_blocked_in_production():
    request = ItineraryGenerationRequest(user_id=USER, context=planning())
    result = await ItineraryGenerationService(
        Settings(_env_file=None, app_env="test", llm_provider="fixture")
    ).generate(request)
    assert result.demo and result.provider == "fixture"
    assert "fixture" in result.itinerary.warnings[-1]
    with pytest.raises(AppError) as error:
        await ItineraryGenerationService(
            Settings(_env_file=None, app_env="production", llm_provider="fixture")
        ).generate(request)
    assert error.value.code == "ITINERARY_CONFIGURATION_ERROR"


def sdk_transport(monkeypatch, handler):
    from app.providers.llm import gemini

    original = gemini.genai.Client
    calls = []

    def client(**kwargs):
        options = kwargs["http_options"]
        assert options.retry_options.attempts == 1 and options.timeout is None
        calls.append(kwargs)
        kwargs["http_options"] = options.model_copy(
            update={"async_client_args": {"transport": httpx.MockTransport(handler)}}
        )
        return original(**kwargs)

    monkeypatch.setattr(gemini.genai, "Client", client)
    return calls


@pytest.mark.parametrize(
    "model,thinking", [("gemini-3.8-flash", "LOW"), ("gemini-3.6-flash", "MINIMAL")]
)
async def test_real_sdk_async_structured_request_uses_model_schema_and_no_auth_context(
    monkeypatch, caplog, model, thinking
):
    caplog.set_level(logging.INFO, logger="nomvira.itinerary")
    plan, context = await fixture_plan()
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {"role": "model", "parts": [{"text": plan.model_dump_json()}]},
                        "finishReason": "STOP",
                    }
                ]
            },
        )

    sdk_transport(monkeypatch, handler)
    result = await ItineraryGenerationService(
        Settings(
            _env_file=None,
            gemini_api_key="test-private-gemini-key",
            gemini_itinerary_model=model,
            gemini_model="future-companion-model",
        )
    ).generate(ItineraryGenerationRequest(user_id=USER, context=planning()))
    assert len(result.itinerary.days) == 3 and len(requests) == 1
    payload = json.loads(requests[0].content)
    assert model in str(requests[0].url)
    config = payload["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert "days" in config["responseJsonSchema"]["properties"]
    # google-genai 2.34 serializes nested thinking fields using protobuf snake_case.
    assert config["thinkingConfig"]["thinking_level"] == thinking
    assert config["maxOutputTokens"] == 6144
    assert not {"temperature", "topP", "topK"} & config.keys()
    text = payload["contents"][0]["parts"][0]["text"]
    assert "user_id" not in text and "trip_id" not in text
    assert "test-private-gemini-key" not in text and "tools" not in payload
    expected_prompt_bytes = len(text.encode("utf-8")) + len(SYSTEM_PROMPT.encode("utf-8"))
    assert f"prompt_bytes={expected_prompt_bytes}" in caplog.text
    assert result.model_name == model
    assert "Never invent" in SYSTEM_PROMPT
    for metric in (
        f"model={model}",
        "trip_days=3",
        "attraction_count=8",
        "food_count=1",
        "proximity_pair_count=28",
        "prompt_bytes=",
        "elapsed_ms=",
        "response_bytes=",
    ):
        assert metric in caplog.text
    assert f"response_bytes={len(plan.model_dump_json().encode('utf-8'))}" in caplog.text
    assert "Provider Museum" not in caplog.text and "test-private-gemini-key" not in caplog.text
    assert "Include rest breaks" not in caplog.text and str(TRIP) not in caplog.text


def test_itinerary_model_is_configured_separately_from_general_gemini_model(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "future-companion-model")
    monkeypatch.delenv("GEMINI_ITINERARY_MODEL", raising=False)
    assert Settings(_env_file=None).gemini_itinerary_model == "gemini-3.6-flash"
    monkeypatch.setenv("GEMINI_ITINERARY_MODEL", "gemini-3.6-flash")
    settings = Settings(_env_file=None)
    assert settings.gemini_model == "future-companion-model"
    assert settings.gemini_itinerary_model == "gemini-3.6-flash"
    monkeypatch.setenv("GEMINI_ITINERARY_MODEL", "invalid/model")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    "status,code",
    [
        (400, "ITINERARY_CONFIGURATION_ERROR"),
        (401, "ITINERARY_PROVIDER_AUTH_ERROR"),
        (403, "ITINERARY_PROVIDER_AUTH_ERROR"),
        (404, "ITINERARY_CONFIGURATION_ERROR"),
        (429, "ITINERARY_PROVIDER_RATE_LIMITED"),
        (503, "ITINERARY_PROVIDER_UNAVAILABLE"),
        (408, "ITINERARY_PROVIDER_TIMEOUT"),
        (504, "ITINERARY_PROVIDER_TIMEOUT"),
    ],
)
async def test_provider_statuses_are_safe_and_not_retried(monkeypatch, caplog, status, code):
    caplog.set_level(logging.INFO)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status, json={"error": {"code": status, "message": "PRIVATE provider body"}}
        )

    sdk_transport(monkeypatch, handler)
    _, context = await fixture_plan()
    with pytest.raises(AppError) as error:
        await GeminiLLMProvider(
            Settings(_env_file=None, gemini_api_key="PRIVATE-key")
        ).generate_itinerary(context)
    assert error.value.code == code
    assert error.value.status_code == (429 if status == 429 else 503)
    assert len(calls) == 1 and "PRIVATE" not in caplog.text and "PRIVATE" not in error.value.message


async def test_provider_timeout_is_mapped_without_retry(monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout("PRIVATE", request=request)

    calls = sdk_transport(monkeypatch, handler)
    _, context = await fixture_plan()
    with pytest.raises(AppError) as error:
        await GeminiLLMProvider(
            Settings(_env_file=None, gemini_api_key="test-key")
        ).generate_itinerary(context)
    assert error.value.code == "ITINERARY_PROVIDER_TIMEOUT" and len(calls) == 1


@pytest.mark.parametrize(
    "code",
    [
        "ITINERARY_PROVIDER_TIMEOUT",
        "ITINERARY_PROVIDER_UNAVAILABLE",
        "ITINERARY_PROVIDER_AUTH_ERROR",
        "ITINERARY_PROVIDER_RATE_LIMITED",
        "ITINERARY_CONFIGURATION_ERROR",
    ],
)
async def test_provider_failures_do_not_trigger_semantic_repair(code):
    provider = ScriptedProvider([AppError(code, "Safe failure", 503)])
    service = ItineraryGenerationService(Settings(_env_file=None), provider)
    with pytest.raises(AppError) as error:
        await service.generate(ItineraryGenerationRequest(user_id=USER, context=planning()))
    assert error.value.code == code and len(provider.calls) == 1
    assert provider.calls[0] == {} and service.concurrent._value == 2


@pytest.mark.parametrize("timeout_scope", ["attempt", "generation"])
async def test_elapsed_deadline_cancels_request_without_semantic_repair(monkeypatch, timeout_scope):
    from app.providers.llm import gemini
    from app.services import itinerary_generation_service

    calls, cancelled = [], []

    async def handler(request):
        calls.append(request)
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    sdk_transport(monkeypatch, handler)
    if timeout_scope == "attempt":
        monkeypatch.setattr(gemini, "GEMINI_ATTEMPT_TIMEOUT_SECONDS", 0.01)
    else:
        monkeypatch.setattr(itinerary_generation_service, "GENERATION_TIMEOUT_SECONDS", 0.01)
    service = ItineraryGenerationService(
        Settings(_env_file=None, gemini_api_key="private-test-key")
    )
    with pytest.raises(AppError) as error:
        await service.generate(ItineraryGenerationRequest(user_id=USER, context=planning()))
    assert error.value.code == "ITINERARY_PROVIDER_TIMEOUT" and len(calls) == 1
    assert cancelled == [True] and service.concurrent._value == 2


@pytest.mark.parametrize("text", ["not json", '{"days":[]}', '{"days":[],"prices":{"dinner":45}}'])
async def test_malformed_or_factual_extra_output_is_rejected_without_repair(monkeypatch, text):
    from app.providers.llm import gemini

    class AsyncClient:
        models = SimpleNamespace(generate_content=None)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

    calls = []

    async def generate(**_kwargs):
        calls.append(1)
        return SimpleNamespace(text=text)

    client = AsyncClient()
    client.models = SimpleNamespace(generate_content=generate)
    monkeypatch.setattr(gemini.genai, "Client", lambda **_kwargs: SimpleNamespace(aio=client))
    service = ItineraryGenerationService(Settings(_env_file=None, gemini_api_key="test-key"))
    with pytest.raises(AppError) as error:
        await service.generate(ItineraryGenerationRequest(user_id=USER, context=planning()))
    assert error.value.code == "ITINERARY_PROVIDER_INVALID_RESPONSE" and len(calls) == 1


async def test_missing_key_long_trips_and_provider_failures_are_bounded():
    _, context = await fixture_plan()
    with pytest.raises(AppError) as error:
        await GeminiLLMProvider(Settings(_env_file=None, gemini_api_key="")).generate_itinerary(
            context
        )
    assert error.value.code == "ITINERARY_CONFIGURATION_ERROR"
    with pytest.raises(AppError) as error:
        build_planning_context(planning(end_date="2099-05-15"))
    assert error.value.code == "ITINERARY_INVALID_TRIP"
    with pytest.raises(ValidationError):
        PlanningInput.model_validate({**planning().model_dump(), "authorization": "PRIVATE"})


async def test_route_authentication_fixture_generation_and_duplicate_spend_limit():
    app = create_app(
        Settings(
            _env_file=None, app_env="test", llm_provider="fixture", nomvira_internal_api_key=KEY
        )
    )
    body = ItineraryGenerationRequest(user_id=USER, context=planning()).model_dump(mode="json")
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        assert (await client.post("/api/v1/itineraries/generate", json=body)).status_code == 401
        result = await client.post(
            "/api/v1/itineraries/generate", json=body, headers={"X-Nomvira-Internal-Key": KEY}
        )
        assert result.status_code == 200 and result.json()["demo"] is True
        duplicate = await client.post(
            "/api/v1/itineraries/generate", json=body, headers={"X-Nomvira-Internal-Key": KEY}
        )
        assert (
            duplicate.status_code == 429
            and duplicate.json()["error"]["code"] == "ITINERARY_RATE_LIMITED"
        )
