import json
from datetime import UTC, date, datetime
from uuid import uuid4

import httpx
import pytest
from google.genai import types
from pydantic import ValidationError
from test_itineraries import KEY, TRIP, USER, planning, sdk_transport

from app.companion.permissions import ToolPermission, may_propose_write
from app.companion.tool_executor import checked_result, validate_call
from app.companion.tool_registry import TOOLS, declarations
from app.core.config import Settings
from app.core.errors import AppError
from app.main import create_app
from app.providers.llm.fixture import FixtureLLMProvider
from app.providers.llm.gemini import GeminiLLMProvider
from app.schemas.companion import (
    CompanionChatRequest,
    CompanionContext,
    CompanionEditRequest,
    ToolCall,
    ToolResult,
)
from app.services.companion_context_service import compact_context, resolve_trip_date
from app.services.companion_edit_service import edit_itinerary
from app.services.companion_service import CompanionService
from app.services.itinerary_context_service import build_planning_context


def context(**changes):
    return CompanionContext(
        destination="Tokyo",
        timezone="Asia/Tokyo",
        start_date=date(2099, 4, 12),
        end_date=date(2099, 4, 14),
        travelers=2,
        currency="USD",
        budget_style="balanced",
        travel_pace="balanced",
        interests=["history"],
        dietary_preferences=["vegetarian"],
        accommodation_preferences=["hotel"],
        saved_food_count=1,
        discovered_place_count=8,
        **changes,
    )


def function(name, args=None, identifier="call-1"):
    return types.Content(
        role="model",
        parts=[
            types.Part(
                function_call=types.FunctionCall(id=identifier, name=name, args=args or {}),
                thought_signature=b"opaque-sdk-signature",
            )
        ],
    )


class ChatProvider:
    def __init__(self, *responses):
        self.responses = iter(responses)
        self.calls = []

    async def chat(self, contents, declarations):
        self.calls.append((list(contents), declarations))
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


def service(*responses):
    provider = ChatProvider(*responses)
    return CompanionService(Settings(_env_file=None), provider), provider


def request(message="What is my itinerary?"):
    return CompanionChatRequest(user_id=USER, trip_id=TRIP, message=message, context=context())


async def resume(service, step, data=None, status="ok", **changes):
    return await service.chat(
        CompanionChatRequest(
            user_id=USER,
            trip_id=TRIP,
            continuation_id=step.continuation_id,
            results=[
                ToolResult(call_id=c.id, name=c.name, status=status, data=data or {})
                for c in step.calls
            ],
            **changes,
        )
    )


def test_registry_has_only_explicit_tools_and_two_permissions():
    assert len(TOOLS) == 18
    assert {t.permission for t in TOOLS.values()} == set(ToolPermission)
    assert not {"run_python", "execute_sql", "http_request", "read_database"} & TOOLS.keys()
    assert len(declarations()) == 19
    for declaration in declarations():
        assert declaration["parameters_json_schema"]["additionalProperties"] is False


@pytest.mark.parametrize(
    "name,args",
    [
        ("execute_sql", {}),
        ("get_weather", {"trip_id": str(uuid4())}),
        ("get_budget_summary", {"query": "x"}),
        ("get_itinerary", {"date": "2099-04-20"}),
        ("get_itinerary", {"date": "not-a-date"}),
        ("find_trip_places", {"limit": 100}),
        (
            "move_itinerary_activity",
            {"candidate_id": "foreign-id", "target_date": "day_2", "target_period": "afternoon"},
        ),
    ],
)
def test_unknown_tools_and_malformed_arguments_are_rejected(name, args):
    with pytest.raises(AppError):
        validate_call(name, args, context(), "Move this activity")


@pytest.mark.parametrize(
    "message", ["yes", "OK", "Could Day 2 be better?", "What should I change?"]
)
def test_ambiguous_messages_never_authorize_writes(message):
    assert not may_propose_write(message)
    with pytest.raises(AppError):
        validate_call("create_itinerary_version", {}, context(), message)


def test_budget_amount_currency_and_date_are_validated_without_llm_math():
    args = {
        "description": "Dinner",
        "category": "food",
        "entry_type": "actual",
        "amount": "35",
        "currency": "USD",
        "expense_date": "day_2",
    }
    good = validate_call("add_budget_entry", args, context(), "Add USD 35 dinner expense")
    assert good["amount"] == "35.00" and good["expense_date"] == "2099-04-13"
    for message in ["Add dinner expense", "Add €35 dinner expense"]:
        with pytest.raises(AppError):
            validate_call("add_budget_entry", args, context(), message)


def test_dates_use_destination_timezone_and_trip_bounds():
    c = context().model_copy(
        update={"start_date": date(2026, 10, 30), "end_date": date(2026, 11, 2)}
    )
    now = datetime(2026, 10, 30, 20, tzinfo=UTC)
    assert resolve_trip_date("today", c, now) == "2026-10-31"
    assert resolve_trip_date("tomorrow", c, now) == "2026-11-01"
    assert resolve_trip_date("tonight", c, now) == "2026-10-31"
    assert resolve_trip_date("day_2", c, now) == "2026-10-31"
    assert resolve_trip_date("Friday", c, now) == "2026-10-30"
    with pytest.raises(AppError):
        resolve_trip_date("next day", c, now)
    c.reference_date = date(2026, 10, 31)
    assert resolve_trip_date("next day", c, now) == "2026-11-01"
    c.timezone = None
    with pytest.raises(AppError):
        resolve_trip_date("tomorrow", c, now)
    c.start_date, c.end_date = date(2026, 10, 1), date(2026, 10, 30)
    with pytest.raises(AppError):
        resolve_trip_date("Friday", c, now)


def test_compact_context_contains_no_internal_ids_raw_payloads_or_secrets():
    c = context(itinerary_version=uuid4(), budget_summary={"remaining_budget": "1275.00"})
    compact = compact_context(c)
    assert compact["budget_summary"]["remaining_budget"] == "1275.00"
    assert compact["has_current_itinerary"] is True
    assert str(c.itinerary_version) not in json.dumps(compact)
    for key in ["api_key", "selection_proof", "raw", "user_id", "trip_id"]:
        with pytest.raises(ValidationError):
            CompanionContext.model_validate({**c.model_dump(), key: KEY})


@pytest.mark.parametrize("key", ["headers", "selection_proof", "api_key", "trip_id", "signature"])
def test_tool_results_reject_secrets_even_nested(key):
    call = ToolCall(id="c", name="get_weather", arguments={}, permission="READ")
    result = ToolResult(call_id="c", name="get_weather", status="ok", data={"nested": [{key: KEY}]})
    with pytest.raises(AppError):
        checked_result(result, call)


async def test_read_tool_manual_round_trip_preserves_sdk_signature_but_never_persists_it():
    s, p = service(
        function("get_itinerary"),
        function(
            "respond",
            {
                "intent": "itinerary",
                "message": "Your museum is planned in the morning.",
                "reference_call_ids": ["call-1"],
            },
        ),
    )
    step = await s.chat(request())
    assert step.calls[0].permission == "READ"
    result = await resume(s, step, {"days": [{"title": "Museum", "period": "morning"}]})
    assert result.response.cards[0].tool_name == "get_itinerary"
    assert "museum" in result.response.message
    assert p.calls[1][0][-2].parts[0].thought_signature == b"opaque-sdk-signature"
    assert p.calls[1][0][-1].parts[0].function_response.id == "call-1"
    assert "signature" not in result.model_dump_json()
    assert not s.turns


async def test_write_tool_returns_only_a_pending_proposal_and_ignores_success_claim():
    s, _ = service(
        function("create_itinerary_version"),
        function("respond", {"intent": "proposal", "message": "I already changed your trip."}),
    )
    step = await s.chat(request("Regenerate my itinerary"))
    assert step.calls[0].permission == "WRITE_CONFIRMATION_REQUIRED"
    result = await resume(s, step, {"preview": {"title": "Generate?"}}, "confirmation_required")
    assert result.response.pending_call
    assert "Nothing has changed" in result.response.message
    assert result.response.cards == []


async def test_continuations_are_user_and_trip_bound_and_single_use():
    s, _ = service(function("get_itinerary"), function("respond", {"intent": "itinerary"}))
    step = await s.chat(request())
    for user, trip in [(uuid4(), TRIP), (USER, uuid4())]:
        with pytest.raises(AppError):
            await s.chat(
                CompanionChatRequest(
                    user_id=user, trip_id=trip, continuation_id=step.continuation_id
                )
            )
    await resume(s, step)
    with pytest.raises(AppError):
        await resume(s, step)


async def test_tool_limit_and_one_repair_are_enforced():
    many = types.Content(
        role="model",
        parts=[
            types.Part(function_call=types.FunctionCall(id=f"c{i}", name="get_itinerary", args={}))
            for i in range(6)
        ],
    )
    s, _ = service(many)
    with pytest.raises(AppError) as error:
        await s.chat(request())
    assert error.value.code == "COMPANION_TOOL_LIMIT"
    s, p = service(function("execute_sql"), function("execute_sql"))
    with pytest.raises(AppError):
        await s.chat(request())
    assert len(p.calls) == 2


async def test_two_write_actions_rejected_and_mutation_cannot_report_executed():
    two = types.Content(
        role="model",
        parts=[
            types.Part(function_call=types.FunctionCall(name="create_itinerary_version", args={}))
            for _ in range(2)
        ],
    )
    s, _ = service(two)
    with pytest.raises(AppError):
        await s.chat(request("Regenerate my itinerary"))
    call = ToolCall(
        id="c",
        name="create_itinerary_version",
        arguments={},
        permission="WRITE_CONFIRMATION_REQUIRED",
    )
    with pytest.raises(AppError):
        checked_result(ToolResult(call_id="c", name=call.name, status="ok", data={}), call)


@pytest.mark.parametrize(
    "exception", [TimeoutError(), AppError("COMPANION_PROVIDER_RATE_LIMITED", "Safe error", 429)]
)
async def test_timeouts_and_429_release_turn(exception):
    s, _ = service(exception)
    with pytest.raises(AppError):
        await s.chat(request())
    assert not s.turns


async def test_no_fake_bookings_or_unsupported_transactions_and_rate_limit():
    s, p = service()
    result = await s.chat(request("Book this hotel for me"))
    assert "not available" in result.response.message
    assert not p.calls
    with pytest.raises(AppError) as error:
        await s.chat(request())
    assert error.value.status_code == 429


async def test_manual_edit_is_validated_and_original_is_immutable():
    source = planning(end_date="2099-04-13")
    plan = await FixtureLLMProvider().generate_itinerary(build_planning_context(source))
    original = plan.model_dump(mode="json")
    candidate = plan.days[0].items[0].candidate_id
    # Replacement uses an unscheduled real candidate, with no LLM call.
    request = CompanionEditRequest(
        context=source,
        original=original,
        tool_name="replace_itinerary_activity",
        arguments={"candidate_id": candidate, "replacement_candidate_id": "node/8"},
    )
    result = edit_itinerary(request)
    assert result["itinerary"]["days"][0]["items"][0]["candidate_id"] == "node/8"
    assert request.original == original
    request.arguments["replacement_candidate_id"] = "node/99999"
    with pytest.raises(AppError):
        edit_itinerary(request)


async def test_companion_internal_api_requires_key_and_rejects_browser_context():
    app = create_app(Settings(_env_file=None, nomvira_internal_api_key=KEY))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        body = request().model_dump(mode="json")
        assert (await client.post("/api/v1/companion/chat", json=body)).status_code == 401
        body["execute_sql"] = "private"
        result = await client.post(
            "/api/v1/companion/chat", json=body, headers={"X-Nomvira-Internal-Key": KEY}
        )
        assert result.status_code == 422 and "private" not in result.text


async def test_gemini_chat_uses_existing_sdk_manual_declarations_and_gemini_model(monkeypatch):
    def handler(request):
        body = json.loads(request.content)
        assert "gemini-3.8-flash" in str(request.url)
        assert body["tools"][0]["functionDeclarations"]
        assert body["toolConfig"]["functionCallingConfig"]["mode"] == "ANY"
        assert KEY not in json.dumps(body)
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [
                                {
                                    "functionCall": {
                                        "name": "get_budget_summary",
                                        "args": {},
                                        "id": "abc",
                                    }
                                }
                            ],
                        }
                    }
                ]
            },
        )

    calls = sdk_transport(monkeypatch, handler)
    provider = GeminiLLMProvider(Settings(_env_file=None, gemini_api_key="mock-only-key"))
    result = await provider.chat(
        [types.Content(role="user", parts=[types.Part(text="budget?")])], declarations()
    )
    assert result.parts[0].function_call.name == "get_budget_summary"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "status,code", [(429, "RATE_LIMITED"), (504, "TIMEOUT"), (500, "UNAVAILABLE")]
)
async def test_gemini_chat_safe_errors_no_retries(monkeypatch, status, code):
    calls = sdk_transport(
        monkeypatch,
        lambda request: httpx.Response(
            status,
            json={
                "error": {
                    "code": status,
                    "message": "PRIVATE_PROVIDER_DETAILS",
                    "status": "UNAVAILABLE",
                }
            },
        ),
    )
    with pytest.raises(AppError) as error:
        await GeminiLLMProvider(Settings(_env_file=None, gemini_api_key="mock-key")).chat(
            [types.Content(role="user", parts=[types.Part(text="hello")])], declarations()
        )
    assert error.value.code == f"COMPANION_PROVIDER_{code}"
    assert "PRIVATE" not in error.value.message and len(calls) == 1


async def test_cache_only_recommendations_never_contact_providers_on_a_miss():
    from test_accommodations import request as hotel_request
    from test_food import request as food_request

    from app.services.food_recommendation_service import FoodRecommendationService
    from app.services.hotel_recommendation_service import HotelRecommendationService

    def forbidden(request):
        pytest.fail("A cache-only read contacted a provider")

    async with httpx.AsyncClient(transport=httpx.MockTransport(forbidden)) as client:
        settings = Settings(_env_file=None)
        for service, body in [
            (HotelRecommendationService(settings, client), hotel_request(cache_only=True)),
            (FoodRecommendationService(settings, client), food_request(cache_only=True)),
        ]:
            with pytest.raises(AppError) as error:
                await service.search(body)
            assert error.value.code.endswith("CACHE_MISS")
        with pytest.raises(ValidationError):
            hotel_request(cache_only=True, refresh=True)


async def test_expired_turn_cannot_resume_and_five_calls_are_a_hard_limit():
    s, _ = service(*(function("get_itinerary", identifier=f"call-{i}") for i in range(6)))
    step = await s.chat(request())
    for _ in range(4):
        step = await resume(s, step)
    with pytest.raises(AppError) as error:
        await resume(s, step)
    assert error.value.code == "COMPANION_TOOL_LIMIT"
    s, _ = service(function("get_itinerary"))
    step = await s.chat(request())
    s.turns[step.continuation_id].deadline = -1
    with pytest.raises(AppError) as error:
        await resume(s, step)
    assert error.value.code == "COMPANION_EXPIRED"
