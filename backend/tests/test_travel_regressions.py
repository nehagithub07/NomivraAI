import json

import httpx
import pytest
from test_accommodations import LOOKUP, RAW, settings
from test_accommodations import request as hotel_request
from test_food import request as food_request
from test_itineraries import fixture_plan, planning

from app.core.config import Settings
from app.providers.accommodations.stayapi import StayApiAccommodationProvider
from app.providers.places.overpass import OpenStreetMapOverpassProvider
from app.services.food_recommendation_service import FoodRecommendationService
from app.services.hotel_recommendation_service import rank
from app.services.itinerary_validation_service import resolve_itinerary


@pytest.mark.asyncio
async def test_landmarks_are_ranked_after_the_entire_city_pool_is_loaded():
    def feature(identifier, name, tourism, **tags):
        return {
            "properties": {
                "name": name,
                "lat": 17.38,
                "lon": 78.45,
                "datasource": {
                    "raw": {"osm_id": identifier, "osm_type": "w", "tourism": tourism, **tags}
                },
            }
        }

    features = [feature(i, f"Minor sight {i}", "attraction") for i in range(1, 160)]
    features += [
        feature(200, "Charminar", "attraction", historic="monument", wikidata="Q219538"),
        feature(201, "Ramoji Film City", "theme_park", wikidata="Q1786944"),
    ]

    def handler(request):
        assert request.url.path == "/v2/places"
        assert request.url.params["limit"] == "500"
        assert "tourism.sights" in request.url.params["categories"]
        assert "entertainment.theme_park" in request.url.params["categories"]
        return httpx.Response(200, json={"features": features})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        places = await OpenStreetMapOverpassProvider(
            client, Settings(_env_file=None, geoapify_api_key="test-key")
        ).discover_nearby(17.384, 78.4564, 30000, 30)
    assert {p.name for p in places[:2]} == {"Charminar", "Ramoji Film City"}
    assert len(places) == 30


@pytest.mark.asyncio
async def test_rated_food_does_not_require_overlap_with_an_osm_listing():
    def venue(identifier, rating, latitude=35.69, categories=None):
        return {
            "place_id": identifier,
            "name": identifier,
            "rating": rating,
            "latitude": latitude,
            "longitude": 139.69,
            "reviews_count": 500,
            "categories": categories or ["Indian restaurant"],
            "position": 1,
        }

    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.path == "/v1/google_maps/search"
        return httpx.Response(
            200,
            json={
                "success": True,
                "results": [
                    venue("Real local restaurant", 4.4),
                    venue("Below threshold", 3.9),
                    venue("Unrated", None),
                    venue("Wrong city", 4.9, latitude=10),
                    venue("Wrong category", 4.9, categories=["Shopping mall"]),
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = FoodRecommendationService(
            Settings(_env_file=None, stayapi_api_key="mock-key"), client
        )
        result = await service.search(food_request(destination_name="Tokyo"))
        cached = await service.search(food_request(destination_name="Tokyo"))
    assert len(calls) == 1 and cached.cached
    assert result.provider == "google_maps"
    assert [c.name for c in result.candidates] == ["Real local restaurant"]
    assert result.candidates[0].rating == 4.4
    assert result.candidates[0].dietary_tags == []


@pytest.mark.asyncio
async def test_hotel_classification_excludes_apartments_for_hotel_preferences():
    def handler(request):
        if request.url.path.endswith("/lookup"):
            return httpx.Response(200, json=LOOKUP)
        if request.url.path.endswith("/search"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "data": {
                        "hotels": [
                            {**RAW, "property_type": None, "hotel_id": "1", "name": "Actual hotel"},
                            {
                                **RAW,
                                "property_type": None,
                                "hotel_id": "2",
                                "name": "Actual apartment",
                            },
                        ]
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "data": {
                    "property_type": "HOTEL"
                    if request.url.params["hotel_id"] == "1"
                    else "APARTMENT"
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        candidates = await StayApiAccommodationProvider(client, settings()).search(hotel_request())
    assert [c.name for c in rank(candidates, hotel_request())] == ["Actual hotel"]


@pytest.mark.asyncio
async def test_itinerary_preserves_the_saved_food_provider():
    source = planning(
        food=[
            {
                "candidate_id": "google-place",
                "provider": "google_maps",
                "name": "Saved rated cafe",
                "category": "cafe",
            }
        ]
    )
    plan, context = await fixture_plan(source)
    document = resolve_itinerary(plan, context)
    meals = [item for day in document.days for item in day.items if item.candidate_type == "food"]
    assert meals and all(item.candidate_provider == "google_maps" for item in meals)
    assert "google-place" in json.dumps(document.model_dump(mode="json"))
