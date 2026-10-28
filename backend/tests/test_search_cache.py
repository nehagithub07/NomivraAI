import asyncio

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.core.search_cache import DestinationSearchCache
from app.main import create_app
from app.schemas.destination import DestinationCandidate, DestinationSearchResponse

KEY = "test-internal-application-key-never-real"


def response():
    return DestinationSearchResponse(
        destinations=[
            DestinationCandidate(
                provider_location_id="1850147",
                name="Tokyo",
                display_name="Tokyo, Japan",
                latitude=35.6895,
                longitude=139.6917,
            )
        ]
    )


@pytest.mark.asyncio
async def test_search_route_reuses_public_results_but_validates_authentication_each_time():
    calls = 0

    def handler(_request):
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "results": [
                    {"id": 1850147, "name": "Tokyo", "latitude": 35.6895, "longitude": 139.6917}
                ]
            },
        )

    app = create_app(
        Settings(_env_file=None, nomvira_internal_api_key=KEY), httpx.MockTransport(handler)
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api,
    ):
        for query in ["Tokyo", "tokyo", "Tokyo"]:
            result = await api.get(
                "/api/v1/destinations/search",
                params={"q": query},
                headers={"X-Nomvira-Internal-Key": KEY},
            )
            assert result.status_code == 200
            assert result.json()["destinations"][0]["name"] == "Tokyo"
        assert (await api.get("/api/v1/destinations/search?q=Tokyo")).status_code == 401
        assert calls == 1


@pytest.mark.asyncio
async def test_concurrent_searches_share_provider_call_and_ignore_waiter_cancellation():
    cache = DestinationSearchCache()
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def load():
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return response()

    first = asyncio.create_task(cache.get_or_load(("tokyo",), load))
    await entered.wait()
    second = asyncio.create_task(cache.get_or_load(("tokyo",), load))
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    assert (await second).destinations[0].name == "Tokyo"
    assert calls == 1


@pytest.mark.asyncio
async def test_cache_expires_and_evicts_old_entries_without_caching_errors():
    cache, calls = DestinationSearchCache(max_entries=2), 0

    async def load():
        nonlocal calls
        calls += 1
        return response()

    first = await cache.get_or_load(("a",), load)
    first.destinations[0].name = "Edited by a caller"
    assert (await cache.get_or_load(("a",), load)).destinations[0].name == "Tokyo"
    for key in ["b", "c", "a"]:
        await cache.get_or_load((key,), load)
    assert calls == 4
    expiring = DestinationSearchCache(ttl_seconds=-1)
    await expiring.get_or_load(("a",), load)
    await expiring.get_or_load(("a",), load)
    assert calls == 6

    async def failing():
        raise AppError("GEOCODING_PROVIDER_UNAVAILABLE", "Unavailable", 503)

    with pytest.raises(AppError):
        await cache.get_or_load(("failed",), failing)
    assert (await cache.get_or_load(("failed",), load)).destinations[0].name == "Tokyo"
