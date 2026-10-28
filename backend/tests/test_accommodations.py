import asyncio
from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.main import create_app
from app.providers.accommodations.stayapi import normalize_hotel, resolve_destination
from app.schemas.accommodation import AccommodationCandidate, AccommodationSearchRequest
from app.services.hotel_policy import WEIGHTS
from app.services.hotel_recommendation_service import (
    HotelRecommendationService,
    eligible,
    rank,
    rating,
    review_confidence,
    score,
    sort_candidates,
    stay_budget,
)

KEY = "test-internal-application-key-never-real"
HEADERS = {"X-Nomvira-Internal-Key": KEY}
USER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"
LOOKUP = {
    "success": True,
    "dest_id": -246227,
    "dest_type": "CITY",
    "normalized_query": "Tokyo, Tokyo, Japan",
    "suggestions": [],
}
RAW = {
    "hotel_id": "12345",
    "name": "Provider example",
    "star_rating": 4,
    "rating": {"score": 8.8, "review_count": 4000},
    "price": {
        "amount": 120.12,
        "total_price_value": 720.72,
        "taxes_and_charges_value": 40.12,
        "currency": "USD",
    },
    "latitude": 35.69,
    "longitude": 139.69,
    "is_sold_out": False,
}


def request(**changes):
    return AccommodationSearchRequest(
        **{
            "user_id": USER,
            "destination_key": "open_meteo:1850147",
            "destination_name": "Tokyo, Japan",
            "destination_country": "Japan",
            "destination_admin1": "Tokyo",
            "latitude": 35.6895,
            "longitude": 139.6917,
            "check_in": "2099-04-12",
            "check_out": "2099-04-18",
            "travelers": 2,
            "rooms": 1,
            "currency": "USD",
            "accommodation_preferences": ["hotel"],
            "trip_budget": "2500.00",
            "budget_style": "balanced",
            **changes,
        }
    )


def candidate(**changes):
    return AccommodationCandidate(
        **{
            "provider": "fixture",
            "provider_accommodation_id": "sample",
            "name": "Demo sample",
            "accommodation_type": "hotel",
            "star_rating": 4,
            "guest_rating": 9,
            "guest_rating_scale": 10,
            "review_count": 1000,
            "total_price": Decimal("810.00"),
            "currency": "USD",
            "distance_km": 1,
            **changes,
        }
    )


def settings(**changes):
    return Settings(
        _env_file=None,
        nomvira_internal_api_key=KEY,
        **{
            "app_env": "test",
            "accommodation_provider": "stayapi",
            "stayapi_api_key": "test-stayapi-key-not-real",
            **changes,
        },
    )


def no_network(_request):
    raise AssertionError("Fixture searches must not contact any provider")


@pytest.mark.asyncio
async def test_real_adapter_lookup_search_cache_and_trusted_parameters():
    calls = []

    def handler(outgoing):
        calls.append(outgoing)
        assert outgoing.url.host == "api.stayapi.com"
        assert outgoing.headers["x-api-key"] == "test-stayapi-key-not-real"
        assert "x-nomvira-internal-key" not in outgoing.headers
        if outgoing.url.path.endswith("/lookup"):
            assert outgoing.url.params["query"] == "Tokyo, Japan"
            return httpx.Response(200, json=LOOKUP)
        assert outgoing.url.path == "/v1/booking/search"
        params = outgoing.url.params
        assert params["dest_id"] == "-246227"  # Never the Open-Meteo location ID.
        assert params["checkin"] == "2099-04-12"
        assert params["checkout"] == "2099-04-18"
        assert params["children"] == "0"
        assert params["rows_per_page"] == "50"
        return httpx.Response(200, json={"success": True, "data": {"hotels": [RAW]}})

    app = create_app(settings(), httpx.MockTransport(handler))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api,
    ):

        async def search(value):
            return await api.post(
                "/api/v1/accommodations/search", headers=HEADERS, json=value.model_dump(mode="json")
            )

        first = await search(request())
        assert first.status_code == 200
        result = first.json()
        assert result["hotel_nights"] == 6
        assert result["stay_budget"] == "875.00"
        assert result["candidates"][0]["total_price"] == "720.72"
        assert result["candidates"][0]["guest_rating_scale"] == 10
        assert result["candidates"][0]["star_rating"] == 4
        assert result["demo"] is False
        assert len(calls) == 2
        assert (await search(request())).json()["cached"] is True
        assert (
            await search(request(trip_budget="4000", budget_style="premium"))
        ).status_code == 200
        assert len(calls) == 2  # Re-rank without spending quota.
        assert (await search(request(travelers=3, rooms=2))).status_code == 200
        assert len(calls) == 3  # Reuse location mapping for new occupancy.
        assert calls[-1].url.params["adults"] == "3"
        assert calls[-1].url.params["rooms"] == "2"
        assert (await search(request(user_id=OTHER))).status_code == 200
        assert len(calls) == 4  # Inventory is scoped to verified user.
        assert (
            await api.post("/api/v1/accommodations/search", json=request().model_dump(mode="json"))
        ).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,code",
    [
        (401, "ACCOMMODATION_PROVIDER_AUTH_ERROR"),
        (403, "ACCOMMODATION_PROVIDER_AUTH_ERROR"),
        (429, "ACCOMMODATION_PROVIDER_QUOTA_EXCEEDED"),
        (500, "ACCOMMODATION_PROVIDER_UNAVAILABLE"),
    ],
)
async def test_provider_errors_safe_and_quota_auth_errors_pause_requests(status, code):
    calls = 0

    def handler(_outgoing):
        nonlocal calls
        calls += 1
        return httpx.Response(status, text="PRIVATE credential and source response")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        service = HotelRecommendationService(settings(), http)
        for value in [request(), request(travelers=3, rooms=2)]:
            with pytest.raises(AppError) as caught:
                await service.search(value)
            assert caught.value.code == code
            assert "PRIVATE" not in caught.value.message
        assert calls == (1 if status in {401, 403, 429} else 2)


@pytest.mark.asyncio
async def test_timeout_invalid_json_and_malformed_success_are_normalized():
    def timeout(outgoing):
        raise httpx.ReadTimeout("PRIVATE", request=outgoing)

    for handler, code in [
        (timeout, "ACCOMMODATION_PROVIDER_UNAVAILABLE"),
        (lambda _: httpx.Response(200, text="not json"), "ACCOMMODATION_PROVIDER_INVALID_RESPONSE"),
        (
            lambda r: httpx.Response(
                200,
                json=LOOKUP
                if r.url.path.endswith("lookup")
                else {"success": True, "data": {"hotels": None}},
            ),
            "ACCOMMODATION_PROVIDER_INVALID_RESPONSE",
        ),
    ]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with pytest.raises(AppError) as caught:
                await HotelRecommendationService(settings(), http).search(request())
            assert caught.value.code == code


@pytest.mark.asyncio
async def test_empty_search_and_missing_credentials_never_silently_switch_provider():
    def handler(outgoing):
        return httpx.Response(
            200,
            json=LOOKUP
            if outgoing.url.path.endswith("lookup")
            else {"success": True, "data": {"hotels": []}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await HotelRecommendationService(settings(), http).search(request())
        assert result.candidates == []
        assert result.demo is False
    async with httpx.AsyncClient(transport=httpx.MockTransport(no_network)) as http:
        with pytest.raises(AppError) as caught:
            await HotelRecommendationService(
                settings(stayapi_api_key="", allow_demo_accommodations=True), http
            ).search(request())
        assert caught.value.code == "ACCOMMODATION_CONFIGURATION_ERROR"


@pytest.mark.asyncio
async def test_explicit_development_demo_remains_usable_after_quota_exhaustion():
    calls = 0

    def handler(_outgoing):
        nonlocal calls
        calls += 1
        return httpx.Response(429, text="PRIVATE")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        service = HotelRecommendationService(settings(allow_demo_accommodations=True), http)
        with pytest.raises(AppError):
            await service.search(request())
        result = await service.search(request(demo=True))
        assert result.demo and result.provider == "fixture" and result.candidates
        assert calls == 1
        assert all(c.available is None for c in result.candidates)
        locked = HotelRecommendationService(
            settings(app_env="production", allow_demo_accommodations=True), http
        )
        with pytest.raises(AppError, match="disabled"):
            await locked.search(request(demo=True))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "environment,allowed,expected",
    [
        ("production", True, False),
        ("development", False, False),
        ("test", True, True),
    ],
)
async def test_fixture_is_explicit_labeled_and_disabled_in_production(
    environment, allowed, expected
):
    async with httpx.AsyncClient(transport=httpx.MockTransport(no_network)) as http:
        service = HotelRecommendationService(
            settings(
                accommodation_provider="fixture",
                app_env=environment,
                allow_demo_accommodations=allowed,
            ),
            http,
        )
        if not expected:
            with pytest.raises(AppError, match="disabled"):
                await service.search(request())
            return
        result = await service.search(request(accommodation_preferences=[]))
        assert result.demo and result.provider == "fixture"
        assert "fictional" in result.attribution
        assert all(c.name.startswith("Demo ") and c.available is None for c in result.candidates)
        assert {label for c in result.candidates for label in c.labels} == {
            "Best Match",
            "Best Value",
            "Budget Friendly",
            "Best Rated",
            "Premium",
        }


def test_partial_data_never_fabricates_money_ratings_images_or_availability():
    minimal = normalize_hotel({"hotel_id": "9", "name": "Partial property"}, request())
    assert minimal is not None
    for field in [
        "star_rating",
        "guest_rating",
        "guest_rating_scale",
        "review_count",
        "total_price",
        "nightly_price",
        "currency",
        "available",
        "image_url",
        "distance_km",
    ]:
        assert getattr(minimal, field) is None
    assert normalize_hotel({"hotel_id": "x", "name": "Invalid ID"}, request()) is None
    untyped = normalize_hotel({**RAW, "price": {"amount": "99.995", "currency": "USD"}}, request())
    assert untyped.advertised_price == Decimal("100.00")
    assert untyped.total_price is None and untyped.nightly_price is None
    invalid = normalize_hotel(
        {**RAW, "latitude": 95, "rating": {"score": 11}, "url": "javascript:alert(1)"}, request()
    )
    assert invalid.latitude is None and invalid.guest_rating is None and invalid.booking_url is None
    malformed = normalize_hotel(
        {
            **RAW,
            "price": {"currency": "USDX", "amount": "50"},
            "star_rating": 0,
            "rating": {"score": 8, "review_count": 1e20},
        },
        request(),
    )
    assert malformed.currency is None and malformed.advertised_price is None
    assert malformed.star_rating is None and malformed.review_count is None


def test_checkin_today_uses_destination_timezone(monkeypatch):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 29, 1, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr("app.schemas.accommodation.datetime", FixedDateTime)
    local = request(
        destination_timezone="Pacific/Honolulu", check_in="2026-10-28", check_out="2026-10-30"
    )
    assert local.nights == 2
    with pytest.raises(ValidationError):
        request(destination_timezone="Asia/Tokyo", check_in="2026-10-28", check_out="2026-10-30")


def test_destination_matching_rejects_wrong_country_or_ambiguous_locations():
    assert resolve_destination(LOOKUP, request()) == ("-246227", "CITY")
    assert resolve_destination({"success": False, "suggestions": []}, request()) is None
    with pytest.raises(AppError):
        resolve_destination({**LOOKUP, "normalized_query": "Tokyo, Papua New Guinea"}, request())
    with pytest.raises(AppError):
        resolve_destination(
            {
                **LOOKUP,
                "suggestions": [
                    {"dest_id": -22, "dest_type": "CITY", "label": "Tokyo, Tokyo, Japan"}
                ],
            },
            request(),
        )
    with pytest.raises(AppError):
        resolve_destination(
            {**LOOKUP, "normalized_query": "Mussoorie, Indiana, United States"},
            request(destination_name="Mussoorie, India", destination_country="India"),
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"check_out": "2099-04-12"},
        {"check_out": "2099-04-11"},
        {"check_out": "2100-04-12"},
        {"travelers": 0},
        {"rooms": 3},
        {"currency": "BAD"},
        {"trip_budget": "NaN"},
        {"latitude": 91},
        {"destination_name": "Tokyo\nJapan"},
        {"check_in": "2000-01-01"},
    ],
)
def test_search_model_rejects_invalid_stays_occupancy_money_and_coordinates(changes):
    with pytest.raises(ValidationError):
        request(**changes)


def test_nights_decimal_prices_budget_and_rating_scales_are_independent():
    value = request()
    assert (value.check_out - value.check_in).days == 6
    assert value.nights == 6
    assert (value.check_out - value.check_in).days + 1 == 7  # Inclusive trip days differ.
    assert stay_budget(value) == Decimal("875.00")
    assert stay_budget(request(budget_style="budget")) == Decimal("700.00")
    assert stay_budget(request(budget_style="premium")) == Decimal("1200.00")
    assert rating(candidate(guest_rating=4.4, guest_rating_scale=5)) == pytest.approx(0.88)
    assert rating(candidate(guest_rating=8.7)) == pytest.approx(0.87)
    assert sum(WEIGHTS.values()) == pytest.approx(1)


def test_review_confidence_and_best_rated_do_not_reward_tiny_sample_automatically():
    low = candidate(provider_accommodation_id="low", guest_rating=9.8, review_count=8)
    high = candidate(provider_accommodation_id="high", guest_rating=9.5, review_count=6000)
    assert review_confidence(6000) > review_confidence(8)
    values = rank([low, high], request())
    assert "Best Rated" in next(c for c in values if c.provider_accommodation_id == "high").labels
    # An explicit rating sort uses normalized score; the recommendation badge uses confidence.
    assert sort_candidates(values, "guest_rating")[0].provider_accommodation_id == "low"


def test_bad_cheap_hotel_does_not_beat_quality_and_filters_precede_scoring():
    bad = candidate(provider_accommodation_id="cheap", guest_rating=6.8, total_price=Decimal("720"))
    good = candidate(
        provider_accommodation_id="quality", guest_rating=9, total_price=Decimal("810")
    )
    assert [c.provider_accommodation_id for c in rank([bad, good], request())] == ["quality"]
    assert not eligible(candidate(available=False), request())
    assert not eligible(candidate(star_rating=2), request())
    assert not eligible(candidate(distance_km=31), request())
    assert not eligible(candidate(accommodation_type="hostel"), request())
    assert eligible(
        candidate(accommodation_type="hostel", star_rating=None),
        request(accommodation_preferences=["hostel"]),
    )
    assert eligible(
        candidate(star_rating=None, guest_rating=None, guest_rating_scale=None), request()
    )
    assert not eligible(candidate(total_price=Decimal("5000"), guest_rating=7.5), request())
    assert eligible(candidate(total_price=Decimal("5000"), star_rating=5), request())


def test_signals_are_bounded_and_all_sorts_are_deterministic_with_unknowns_last():
    near = candidate(provider_accommodation_id="near", distance_km=0.2, total_price=Decimal("100"))
    far = candidate(provider_accommodation_id="far", distance_km=20, total_price=Decimal("200"))
    unknown = candidate(
        provider_accommodation_id="unknown",
        distance_km=None,
        total_price=None,
        guest_rating=None,
        guest_rating_scale=None,
        review_count=None,
    )
    values = rank([far, unknown, near], request())
    for item in values:
        assert 0 <= item.recommendation_score <= 1
        assert all(0 <= value <= 1 for value in item.scores.model_dump().values())
    assert sort_candidates(values, "price_asc")[0].provider_accommodation_id == "near"
    assert sort_candidates(values, "price_desc")[0].provider_accommodation_id == "far"
    assert sort_candidates(values, "price_desc")[-1].provider_accommodation_id == "unknown"
    assert sort_candidates(values, "distance")[0].provider_accommodation_id == "near"
    assert score(near, request()).scores.location > score(far, request()).scores.location
    assert (
        score(near, request()).scores.budget_fit
        > score(candidate(total_price=Decimal("2000")), request()).scores.budget_fit
    )
    assert (
        score(candidate(accommodation_type=None), request()).scores.preference
        < score(near, request()).scores.preference
    )
    assert rank([near, far], request()) == rank([far, near], request())


@pytest.mark.asyncio
async def test_simultaneous_same_search_coalesces_and_refresh_has_cooldown():
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def handler(outgoing):
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return httpx.Response(
            200,
            json=LOOKUP
            if outgoing.url.path.endswith("lookup")
            else {"success": True, "data": {"hotels": [RAW]}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        service = HotelRecommendationService(settings(), http)
        first = asyncio.create_task(service.search(request()))
        await entered.wait()
        second = asyncio.create_task(service.search(request()))
        release.set()
        await asyncio.gather(first, second)
        assert calls == 2
        await service.search(request(refresh=True))
        assert calls == 3  # Mapping reused; explicit refresh costs one search.
        with pytest.raises(AppError) as caught:
            await service.search(request(refresh=True))
        assert caught.value.status_code == 429
