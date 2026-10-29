import json
import logging
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.main import create_app
from app.providers.llm.base import LLMProvider
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
        assert options.retry_options.attempts == 1 and options.timeout == 30000
        calls.append(kwargs)
        kwargs["http_options"] = options.model_copy(
            update={"async_client_args": {"transport": httpx.MockTransport(handler)}}
        )
        return original(**kwargs)

    monkeypatch.setattr(gemini.genai, "Client", client)
    return calls


async def test_real_sdk_async_structured_request_uses_model_schema_and_no_auth_context(monkeypatch):
    plan, context = await fixture_plan()
    requests = []

    def handler(request):
        requests.append(request)
        payload = json.loads(request.content)
        assert "gemini-3.8-flash" in str(request.url)
        assert payload["generationConfig"]["responseMimeType"] == "application/json"
        assert "days" in payload["generationConfig"]["responseSchema"]["properties"]
        text = payload["contents"][0]["parts"][0]["text"]
        assert (
            "user_id" not in text
            and "trip_id" not in text
            and "test-private-gemini-key" not in text
        )
        assert "tools" not in payload
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
    result = await GeminiLLMProvider(
        Settings(_env_file=None, gemini_api_key="test-private-gemini-key")
    ).generate_itinerary(context)
    assert result == plan and len(requests) == 1
    assert "Never invent" in SYSTEM_PROMPT


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "ITINERARY_PROVIDER_AUTH_ERROR"),
        (403, "ITINERARY_PROVIDER_AUTH_ERROR"),
        (404, "ITINERARY_CONFIGURATION_ERROR"),
        (429, "ITINERARY_PROVIDER_RATE_LIMITED"),
        (503, "ITINERARY_PROVIDER_UNAVAILABLE"),
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
