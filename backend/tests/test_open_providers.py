import asyncio
from contextlib import contextmanager

import httpx
import pytest

from app.core.config import Settings
from app.main import create_app
from app.providers.geocoding.open_meteo import OpenMeteoGeocodingProvider
from app.providers.places.overpass import category_for, haversine_km

KEY = "test-internal-application-key-never-real"
HEADERS = {"X-Nomvira-Internal-Key": KEY}
LOCATION = {
    "id": 1850147,
    "name": "Tokyo",
    "latitude": 35.6895,
    "longitude": 139.6917,
    "country": "Japan",
    "country_code": "JP",
    "admin1": "Tokyo",
    "timezone": "Asia/Tokyo",
    "feature_code": "PPLC",
    "population": 9733276,
    "unused": "never expose",
}


@contextmanager
def client(handler, **settings):
    app = create_app(
        Settings(_env_file=None, nomvira_internal_api_key=KEY, **settings),
        httpx.MockTransport(handler),
    )
    with asyncio.Runner() as runner:
        lifespan = app.router.lifespan_context(app)
        http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

        async def start():
            await lifespan.__aenter__()
            await http.__aenter__()

        async def close():
            await http.__aexit__(None, None, None)
            await lifespan.__aexit__(None, None, None)

        class Client:
            def get(self, *args, **kwargs):
                return runner.run(http.get(*args, **kwargs))

            def post(self, *args, **kwargs):
                return runner.run(http.post(*args, **kwargs))

        runner.run(start())
        try:
            yield Client()
        finally:
            runner.run(close())


def no_network(_request):
    raise AssertionError("Provider must not be called")


def test_public_health_and_no_wildcard_cors():
    with client(no_network) as api:
        response = api.get("/health", headers={"Origin": "https://untrusted.test"})
        assert response.json() == {"status": "ok", "service": "nomivra-api"}
        assert response.headers["x-request-id"]
        assert response.headers["cache-control"] == "no-store"
        assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("key", [None, "wrong", ""])
def test_provider_routes_require_internal_authentication(key):
    with client(no_network) as api:
        headers = {"X-Nomvira-Internal-Key": key} if key is not None else {}
        assert api.get("/api/v1/destinations/search?q=Tokyo", headers=headers).status_code == 401
        assert (
            api.post(
                "/api/v1/places/discover", headers=headers, json={"latitude": 0, "longitude": 0}
            ).status_code
            == 401
        )


@pytest.mark.parametrize(
    "query",
    [
        "q=T",
        "q=To",
        "q=" + "x" * 101,
        "q=Tokyo&limit=31",
        "q=Tokyo&url=https://evil.test",
        "q=Tokyo&country_code=WORLD",
        "q=Tokyo&language=invalid",
        "q=Tokyo%0AJapan",
    ],
)
def test_destination_query_validation(query):
    with client(no_network) as api:
        assert api.get("/api/v1/destinations/search?" + query, headers=HEADERS).status_code == 422


def test_search_normalizes_localization_optional_fields_and_country_filter():
    def handler(request):
        assert request.url.host == "geocoding-api.open-meteo.com"
        assert request.url.path == "/v1/search"
        assert dict(request.url.params) == {
            "name": "Tok",
            "count": "8",
            "language": "ja",
            "format": "json",
            "countryCode": "JP",
        }
        assert "x-goog-api-key" not in request.headers
        return httpx.Response(
            200,
            json={
                "results": [
                    {**LOCATION, "name": "東京", "country": "日本", "admin1": "東京都"},
                    {"id": 123, "name": "Village", "latitude": 1, "longitude": 2},
                ]
            },
        )

    with client(handler) as api:
        response = api.get(
            "/api/v1/destinations/search?q=Tok&language=ja&country_code=JP", headers=HEADERS
        )
        assert response.status_code == 200
        data = response.json()["destinations"]
        assert data[0]["provider"] == "open_meteo"
        assert data[0]["provider_location_id"] == "1850147"
        assert data[0]["name"] == "東京"
        assert data[0]["display_name"] == "東京, 東京都, 日本"
        assert data[0]["timezone"] == "Asia/Tokyo"
        assert data[1]["country"] is None
        assert data[1]["admin1"] is None
        assert data[1]["population"] is None
        assert "unused" not in response.text


def test_empty_search_and_no_country_hardcoding():
    def handler(request):
        assert "countryCode" not in request.url.params
        return httpx.Response(200, json={"generationtime_ms": 0.1})

    with client(handler) as api:
        assert api.get("/api/v1/destinations/search?q=Nowhere", headers=HEADERS).json() == {
            "destinations": []
        }


def test_invalid_timezone_becomes_null_and_duplicate_ids_collapse():
    with client(
        lambda _: httpx.Response(
            200, json={"results": [{**LOCATION, "timezone": "Invalid/Zone"}] * 2}
        )
    ) as api:
        items = api.get("/api/v1/destinations/search?q=Tokyo", headers=HEADERS).json()[
            "destinations"
        ]
        assert len(items) == 1
        assert items[0]["timezone"] is None


def test_optional_id_resolution_is_canonical():
    def handler(request):
        assert request.url.path == "/v1/get"
        assert request.url.params["id"] == "1850147"
        return httpx.Response(200, json=LOCATION)

    with client(handler) as api:
        assert api.get("/api/v1/destinations/1850147", headers=HEADERS).json()["name"] == "Tokyo"
    with client(no_network) as api:
        assert api.get("/api/v1/destinations/not-an-id", headers=HEADERS).status_code == 422


@pytest.mark.parametrize(
    "status,expected,code",
    [
        (400, 502, "GEOCODING_PROVIDER_INVALID_REQUEST"),
        (429, 429, "GEOCODING_PROVIDER_RATE_LIMITED"),
        (500, 503, "GEOCODING_PROVIDER_UNAVAILABLE"),
        (504, 503, "GEOCODING_PROVIDER_UNAVAILABLE"),
    ],
)
def test_geocoding_error_mapping(status, expected, code):
    with client(lambda _: httpx.Response(status, text="PRIVATE PROVIDER ERROR")) as api:
        response = api.get("/api/v1/destinations/search?q=Tokyo", headers=HEADERS)
        assert response.status_code == expected
        assert response.json()["error"]["code"] == code
        assert "PRIVATE" not in response.text


@pytest.mark.parametrize(
    "payload",
    [[], {"results": None}, {"results": [{"id": 123}]}, {"error": True, "reason": "PRIVATE ERROR"}],
)
def test_invalid_geocoding_response(payload):
    with client(lambda _: httpx.Response(200, json=payload)) as api:
        assert api.get("/api/v1/destinations/search?q=Tokyo", headers=HEADERS).status_code == 502


def test_geocoding_timeout():
    def handler(request):
        raise httpx.ReadTimeout("PRIVATE", request=request)

    with client(handler) as api:
        response = api.get("/api/v1/destinations/search?q=Tokyo", headers=HEADERS)
        assert response.status_code == 503
        assert "PRIVATE" not in response.text


def element(kind="node", identifier=1, name="Museum", tags=None, lat=35.69, lon=139.69):
    value = {
        "type": kind,
        "id": identifier,
        "tags": {"name": name, **(tags or {"tourism": "museum"})},
    }
    value.update(
        {"lat": lat, "lon": lon} if kind == "node" else {"center": {"lat": lat, "lon": lon}}
    )
    return value


def test_node_way_relation_normalization_dedupe_distance_and_metadata():
    def handler(request):
        assert request.method == "POST"
        assert request.url.host == "overpass-api.de"
        assert request.headers["user-agent"] == "NomviraAI/0.1"
        from urllib.parse import parse_qs

        query = parse_qs(request.content.decode())["data"][0]
        assert "around:" not in query
        assert "[timeout:25]" in query
        assert "[maxsize:33554432]" in query
        assert "out center qt 50;" in query
        assert 'nwr["tourism"' in query
        assert 'nwr["historic"' in query
        assert "restaurant" not in query
        assert "out geom" not in query
        return httpx.Response(
            200,
            json={
                "elements": [
                    element(tags={"tourism": "museum", "phone": "PRIVATE", "wikidata": "Q123"}),
                    element(),
                    element("way", 2, "Park", {"leisure": "park"}, 35.7),
                    element("relation", 3, "Castle", {"historic": "castle"}, 35.71),
                    element("way", 4),  # Duplicate named museum within 50m.
                    element(identifier=5, name=" "),
                    element(identifier=6, name="Too far", lat=10),
                    element(identifier=7, name="Restaurant", tags={"amenity": "restaurant"}),
                    {
                        "type": "way",
                        "id": 8,
                        "tags": {"name": "Missing center", "tourism": "museum"},
                    },
                ]
            },
        )

    with client(handler) as api:
        response = api.post(
            "/api/v1/places/discover",
            headers=HEADERS,
            json={"latitude": 35.6895, "longitude": 139.6917},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["radius_meters"] == 5000
        places = data["places"]
        assert [item["provider_place_id"] for item in places] == ["node/1", "way/2", "relation/3"]
        assert [item["category"] for item in places] == ["museum", "park", "historic"]
        assert places[0]["tags"] == {"tourism": "museum", "wikidata": "Q123"}
        assert all(item["distance_km"] >= 0 for item in places)
        assert "PRIVATE" not in response.text


@pytest.mark.parametrize(
    "tags,category",
    [
        ({"tourism": "attraction"}, "attraction"),
        ({"tourism": "viewpoint"}, "viewpoint"),
        ({"tourism": "gallery"}, "gallery"),
        ({"historic": "castle"}, "historic"),
        ({"historic": "monument"}, "monument"),
        ({"leisure": "park"}, "park"),
        ({"amenity": "arts_centre"}, "arts_centre"),
        ({"historic": "no"}, None),
    ],
)
def test_central_category_mapping(tags, category):
    assert category_for(tags) == category


def test_haversine_known_distance_same_point_and_antimeridian():
    assert haversine_km(0, 0, 0, 0) == 0
    assert haversine_km(0, 0, 0, 1) == pytest.approx(111.195, rel=0.001)
    assert haversine_km(0, 179.9, 0, -179.9) == pytest.approx(22.239, rel=0.001)


@pytest.mark.parametrize(
    "changes",
    [
        {"radius_meters": 20001},
        {"limit": 31},
        {"latitude": 91},
        {"longitude": -181},
        {"url": "http://evil.test"},
    ],
)
def test_discovery_bounds(changes):
    with client(no_network) as api:
        assert (
            api.post(
                "/api/v1/places/discover",
                headers=HEADERS,
                json={"latitude": 0, "longitude": 0, **changes},
            ).status_code
            == 422
        )


@pytest.mark.parametrize("status", [429, 500, 504])
def test_overpass_errors_are_safe(status):
    with client(lambda _: httpx.Response(status, text="PRIVATE ERROR")) as api:
        response = api.post(
            "/api/v1/places/discover", headers=HEADERS, json={"latitude": 0, "longitude": 0}
        )
        assert response.status_code == (429 if status == 429 else 503)
        assert "PRIVATE" not in response.text


def test_overpass_timeout_empty_result_and_partial_error():
    def timeout(request):
        raise httpx.ReadTimeout("PRIVATE", request=request)

    for handler, expected in [
        (timeout, 503),
        (lambda _: httpx.Response(200, json={"elements": []}), 200),
        (
            lambda _: httpx.Response(
                200, json={"remark": "runtime error: timed out", "elements": []}
            ),
            502,
        ),
    ]:
        with client(handler) as api:
            assert (
                api.post(
                    "/api/v1/places/discover", headers=HEADERS, json={"latitude": 0, "longitude": 0}
                ).status_code
                == expected
            )


def test_rapid_sequential_discovery_succeeds_and_geocoding_limit_is_unchanged():
    with client(lambda _: httpx.Response(200, json={"elements": []})) as api:
        assert (
            api.post(
                "/api/v1/places/discover", headers=HEADERS, json={"latitude": 0, "longitude": 0}
            ).status_code
            == 200
        )
        assert (
            api.post(
                "/api/v1/places/discover", headers=HEADERS, json={"latitude": 0, "longitude": 0}
            ).status_code
            == 200
        )
    with client(lambda _: httpx.Response(200, json={})) as api:
        for _ in range(60):
            assert (
                api.get("/api/v1/destinations/search?q=Tokyo", headers=HEADERS).status_code == 200
            )
        assert api.get("/api/v1/destinations/search?q=Tokyo", headers=HEADERS).status_code == 429


def test_configurable_endpoint_and_radius():
    with client(
        lambda request: httpx.Response(200, json={"elements": []}),
        default_poi_radius_meters=5000,
        max_poi_radius_meters=5000,
    ) as api:
        assert (
            api.post(
                "/api/v1/places/discover",
                headers=HEADERS,
                json={"latitude": 0, "longitude": 0, "radius_meters": 6000},
            ).status_code
            == 422
        )


def test_provider_resolve_interface_without_extra_search_call():
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=LOCATION))
        ) as http:
            result = await OpenMeteoGeocodingProvider(http, Settings(_env_file=None)).resolve(
                "1850147"
            )
            assert result.provider_location_id == "1850147"

    asyncio.run(run())


@pytest.mark.asyncio
async def test_concurrent_discovery_never_sends_parallel_provider_requests():
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def handler(_request):
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return httpx.Response(200, json={"elements": []})

    app = create_app(
        Settings(_env_file=None, nomvira_internal_api_key=KEY), httpx.MockTransport(handler)
    )
    app.state.limits.discovery_cooldown_seconds = 0.01
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api,
    ):
        first = asyncio.create_task(
            api.post(
                "/api/v1/places/discover", headers=HEADERS, json={"latitude": 0, "longitude": 0}
            )
        )
        await entered.wait()
        try:
            second = asyncio.create_task(
                api.post(
                    "/api/v1/places/discover", headers=HEADERS, json={"latitude": 0, "longitude": 0}
                )
            )
            await asyncio.sleep(0.01)
            assert not second.done()
            assert calls == 1
        finally:
            release.set()
        assert (await first).status_code == 200
        assert (await second).status_code == 200
        assert calls == 2
