import asyncio
from datetime import datetime

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.main import create_app
from app.providers.food.geoapify import GeoapifyFoodProvider, normalize_food
from app.schemas.food import FoodCandidate, FoodSearchRequest
from app.services.food_policy import distance_km
from app.services.food_recommendation_service import (
    FoodRecommendationService,
    active_weights,
    eligible,
    rank,
    score,
    sort_candidates,
)

KEY = "test-internal-application-key-never-real"
USER = "00000000-0000-4000-8000-000000000001"


def request(**changes):
    return FoodSearchRequest(
        **{
            "user_id": USER,
            "latitude": 35.6895,
            "longitude": 139.6917,
            "radius_meters": 5000,
            **changes,
        }
    )


def settings(**changes):
    return Settings(
        _env_file=None,
        **{
            "app_env": "test",
            "food_provider": "geoapify",
            "geoapify_api_key": "fake-test-key",
            "nomvira_internal_api_key": KEY,
            **changes,
        },
    )


def feature(**changes):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [139.692, 35.69]},
        "properties": {
            "place_id": "test-place",
            "name": "Provider-supplied name",
            "lat": 35.69,
            "lon": 139.692,
            "categories": [
                "catering",
                "catering.restaurant",
                "catering.restaurant.japanese",
                "vegetarian",
            ],
            "formatted": "Provider address",
            **changes,
        },
    }


def candidate(**changes):
    return FoodCandidate(
        **{
            "provider": "geoapify",
            "provider_place_id": "a",
            "name": "A",
            "category": "restaurant",
            "latitude": 35.6895 + 1.2 / 111.195,
            "longitude": 139.6917,
            **changes,
        }
    )


@pytest.mark.parametrize(
    "categories,expected",
    [
        (["restaurant"], "catering.restaurant"),
        (["cafe"], "catering.cafe"),
        (["bar", "pub"], "catering.bar,catering.pub"),
        (["restaurant", "cafe"], "catering.restaurant,catering.cafe"),
        (["fast_food", "food_court"], "catering.fast_food,catering.food_court"),
    ],
)
async def test_search_contract(categories, expected):
    def handler(req):
        assert req.url.path == "/v2/places"
        assert req.url.params["apiKey"] == "fake-test-key"
        assert req.url.params["categories"] == expected
        assert req.url.params["filter"] == "circle:139.6917,35.6895,5000"
        assert req.url.params["bias"] == "proximity:139.6917,35.6895"
        assert req.url.params["limit"] == "20"
        assert "conditions" not in req.url.params
        return httpx.Response(200, json={"features": [feature()]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await GeoapifyFoodProvider(settings(), client).search(
            request(categories=categories)
        )
        assert len(result) == 1
        assert result[0].rating is None and result[0].review_count is None


@pytest.mark.parametrize("diet", ["vegetarian", "vegan", "halal", "kosher", "gluten_free"])
async def test_diet_conditions(diet):
    def handler(req):
        assert req.url.params["conditions"] == diet
        return httpx.Response(200, json={"features": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert (
            await GeoapifyFoodProvider(settings(), client).search(
                request(dietary_preferences=[diet])
            )
            == []
        )


def test_normalization_and_no_fabrication():
    result = normalize_food(
        feature(
            categories=[
                "catering.restaurant.indian",
                "catering.restaurant.new_cuisine",
                "vegan.only",
            ],
            datasource={
                "raw": {
                    "diet:halal": "yes",
                    "diet:gluten_free": "no",
                    "website": "https://example.com",
                    "opening_hours": "Mo-Fr 10:00-20:00",
                }
            },
            rating=4.9,
            review_count=100,
        )
    )
    assert result.cuisine_types == ["Indian", "New Cuisine"]
    assert result.category == "restaurant"
    assert result.dietary_tags == ["halal", "vegan.only"]
    assert result.dietary_conflicts == ["gluten_free"]
    assert result.website == "https://example.com"
    assert result.opening_hours == "Mo-Fr 10:00-20:00"
    assert result.rating is result.rating_scale is result.review_count is result.price_level is None
    partial = normalize_food(
        feature(categories=None, formatted=None, website="javascript:alert(1)")
    )
    assert partial.category == "other" and partial.website is None
    assert partial.dietary_tags == [] and partial.opening_hours is None
    assert normalize_food(feature(name=" ")) is None
    assert normalize_food(feature(lat="invalid")) is None
    assert normalize_food(feature(place_id=None)) is None
    assert normalize_food(feature(place_id="x" * 513)) is None
    assert normalize_food(None) is None
    geometry = feature()
    del geometry["properties"]["lat"]
    del geometry["properties"]["lon"]
    assert normalize_food(geometry).latitude == 35.69


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "FOOD_PROVIDER_AUTH_ERROR"),
        (403, "FOOD_PROVIDER_AUTH_ERROR"),
        (429, "FOOD_PROVIDER_RATE_LIMITED"),
        (500, "FOOD_PROVIDER_UNAVAILABLE"),
        (302, "FOOD_PROVIDER_UNAVAILABLE"),
    ],
)
async def test_provider_errors_are_safe(status, code):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(status, text="SECRET raw provider error")
        )
    ) as client:
        with pytest.raises(AppError) as failure:
            await GeoapifyFoodProvider(settings(), client).search(request())
        assert failure.value.code == code
        assert "SECRET" not in failure.value.message


async def test_timeout_missing_key_and_malformed_response():
    def timeout(req):
        raise httpx.ReadTimeout("SECRET URL", request=req)

    async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as client:
        with pytest.raises(AppError) as failure:
            await GeoapifyFoodProvider(settings(), client).search(request())
        assert failure.value.code == "FOOD_PROVIDER_UNAVAILABLE"
        assert "SECRET" not in failure.value.message
        with pytest.raises(AppError) as missing:
            await GeoapifyFoodProvider(settings(geoapify_api_key=""), client).search(request())
        assert missing.value.code == "FOOD_CONFIGURATION_ERROR"
    for data in [{}, [], {"features": "invalid"}]:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda req, data=data: httpx.Response(200, json=data))
        ) as client:
            with pytest.raises(AppError) as invalid:
                await GeoapifyFoodProvider(settings(), client).search(request())
            assert invalid.value.code == "FOOD_PROVIDER_INVALID_RESPONSE"


def test_diet_is_stronger_than_small_distance_advantage():
    req = request(dietary_preferences=["vegetarian"])
    unknown = candidate(
        provider_place_id="unknown", name="Nearby", latitude=req.latitude + 0.3 / 111.195
    )
    confirmed = candidate(
        provider_place_id="confirmed", name="Vegetarian", dietary_tags=["vegetarian"]
    )
    ranked = rank([unknown, confirmed], req)
    assert ranked[0].provider_place_id == "confirmed"
    assert {"Diet-Friendly", "Best Match", "Nomivra Pick"} <= set(ranked[0].labels)
    assert ranked[1].dietary_match == "unknown"
    assert "Diet-Friendly" not in ranked[1].labels


def test_no_diet_stronger_cuisine_and_dynamic_weights():
    req = request(cuisine_preferences=["Japanese"])
    weights = active_weights(req)
    assert "dietary_match" not in weights and sum(weights.values()) == pytest.approx(1)
    assert weights["cuisine_match"] == pytest.approx(0.25 / 0.7)
    japanese = candidate(cuisine_types=["Japanese"])
    other = candidate(provider_place_id="b", cuisine_types=["Italian"], dietary_tags=["vegetarian"])
    assert rank([other, japanese], req)[0].provider_place_id == "a"
    assert "Cuisine Match" in japanese.labels
    with_diet = japanese.model_copy(update={"dietary_tags": ["vegan"]})
    # Metadata completeness has only a small independent boost, not a diet penalty.
    assert score(with_diet, req).scores.cuisine_match == score(japanese, req).scores.cuisine_match
    assert score(with_diet, req).recommendation_score - japanese.recommendation_score < 0.03


def test_no_preferences_distance_category_quality_and_labels():
    req = request()
    weights = active_weights(req)
    assert set(weights) == {"distance", "category_preference", "data_quality"}
    assert weights["distance"] == pytest.approx(0.25 / 0.45)
    near = candidate(
        address="Address",
        website="https://example.com",
        cuisine_types=["Indian"],
        latitude=req.latitude + 0.4 / 111.195,
    )
    far = candidate(provider_place_id="b", latitude=req.latitude + 4 / 111.195)
    cafe = candidate(provider_place_id="c", category="cafe", name="Cafe")
    ranked = rank([far, cafe, near], req)
    assert ranked[0] is near
    assert "Nearby Pick" in near.labels
    assert "Cafe Pick" in cafe.labels
    assert near.scores.distance > far.scores.distance
    assert near.scores.data_quality > far.scores.data_quality
    assert near.scores.category_preference > cafe.scores.category_preference


def test_hard_filters_conflicts_radius_duplicates_and_strict_diet():
    req = request(dietary_preferences=["vegetarian"])
    good = candidate(dietary_tags=["vegan.only"])
    unknown = candidate(provider_place_id="unknown")
    conflict = candidate(provider_place_id="conflict", dietary_conflicts=["vegetarian"])
    outside = candidate(provider_place_id="outside", latitude=req.latitude + 20 / 111.195)
    wrong_category = candidate(provider_place_id="other", category="other")
    assert len(rank([good, good, unknown, conflict, outside, wrong_category], req)) == 2
    assert eligible(good, req.model_copy(update={"strict_dietary": True}))
    assert not eligible(unknown, req.model_copy(update={"strict_dietary": True}))
    assert distance_km(0, 179.999, 0, -179.999) < 1
    assert distance_km(90, 0, 90, 120) < 0.001


def test_sorting_is_stable_and_no_rating_sort():
    a, b = (
        candidate(name="Alpha", distance_km=2),
        candidate(provider_place_id="b", name="Beta", distance_km=1),
    )
    assert sort_candidates([b, a], "name") == [a, b]
    assert sort_candidates([a, b], "distance") == [b, a]
    assert sort_candidates([b, a]) == sort_candidates([a, b])


async def test_controlled_fallback_cache_and_no_details_calls():
    calls = []

    def handler(req):
        calls.append(req)
        if "conditions" in req.url.params:
            return httpx.Response(200, json={"features": [feature()]})
        return httpx.Response(
            200,
            json={
                "features": [
                    feature(),
                    feature(
                        place_id="unknown", categories=["catering.restaurant"], name="Unknown diet"
                    ),
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = FoodRecommendationService(settings(), client)
        req = request(dietary_preferences=["vegetarian"])
        first, second = await asyncio.gather(service.search(req), service.search(req))
        assert len(calls) == 2 and first.dietary_fallback
        assert len(first.candidates) == 2
        assert (await service.search(req)).cached
        assert len(calls) == 2
        assert all(req.url.path == "/v2/places" for req in calls)
        assert datetime.fromisoformat(first.expires_at) > datetime.fromisoformat(second.searched_at)


async def test_strict_diet_never_falls_back_and_errors_pause():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(200, json={"features": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await FoodRecommendationService(settings(), client).search(
            request(dietary_preferences=["vegan"], strict_dietary=True)
        )
        assert result.candidates == [] and len(calls) == 1
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: httpx.Response(429))
    ) as client:
        service = FoodRecommendationService(settings(), client)
        for _ in range(2):
            with pytest.raises(AppError) as limited:
                await service.search(request())
            assert limited.value.code == "FOOD_PROVIDER_RATE_LIMITED"


async def test_fixture_safety_limits_and_internal_auth():
    app = create_app(
        settings(food_provider="fixture"),
        transport=httpx.MockTransport(lambda req: pytest.fail("No external calls")),
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        assert (
            await client.post("/api/v1/food/search", json=request().model_dump(mode="json"))
        ).status_code == 401
        headers = {"X-Nomvira-Internal-Key": KEY}
        response = await client.post(
            "/api/v1/food/search", json=request().model_dump(mode="json"), headers=headers
        )
        body = response.json()
        assert response.status_code == 200 and body["demo"]
        assert len(body["candidates"]) > 5
        assert all(
            c["name"].startswith("Demo") and c["rating"] is None and c["distance_km"] <= 5
            for c in body["candidates"]
        )
        for changes in [
            {"radius_meters": 100000},
            {"limit": 41},
            {"latitude": 91},
            {"owner_id": "attacker"},
        ]:
            invalid = await client.post(
                "/api/v1/food/search",
                json={**request().model_dump(mode="json"), **changes},
                headers=headers,
            )
            assert invalid.status_code == 422
    async with httpx.AsyncClient() as client:
        for configured, demo in [("fixture", False), ("geoapify", True)]:
            service = FoodRecommendationService(
                settings(app_env="production", food_provider=configured),
                client,
            )
            with pytest.raises(AppError) as disabled:
                await service.search(request(demo=demo))
            assert disabled.value.code == "FOOD_CONFIGURATION_ERROR"
    with pytest.raises(ValidationError):
        settings(geoapify_base_url="http://api.geoapify.com")


async def test_explicit_development_demo_uses_no_live_credits():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: pytest.fail("No live call for explicit demo"))
    ) as client:
        result = await FoodRecommendationService(
            settings(app_env="development", geoapify_api_key=""), client
        ).search(request(demo=True))
        assert result.demo and result.provider == "fixture"
        assert len(result.candidates) > 5


async def test_supplemental_quota_failure_preserves_matches_and_pauses_new_searches():
    calls = []

    def handler(req):
        calls.append(req)
        if "conditions" in req.url.params:
            return httpx.Response(200, json={"features": [feature()]})
        return httpx.Response(429)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = FoodRecommendationService(settings(), client)
        result = await service.search(request(dietary_preferences=["vegetarian"]))
        assert len(result.candidates) == 1 and not result.dietary_fallback
        with pytest.raises(AppError) as failure:
            await service.search(request(latitude=35.7))
        assert failure.value.code == "FOOD_PROVIDER_RATE_LIMITED" and len(calls) == 2
