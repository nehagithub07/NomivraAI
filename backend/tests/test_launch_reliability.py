from types import SimpleNamespace

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.core.provider_http import request_json
from app.providers.places import overpass


@pytest.mark.asyncio
async def test_places_failover_fits_the_shared_deadline_and_leaves_query_headroom(monkeypatch):
    clock, calls = [0.0], []
    monkeypatch.setattr(overpass, "time", SimpleNamespace(monotonic=lambda: clock[0]))

    async def request(*args, **kwargs):
        calls.append(kwargs)
        clock[0] += kwargs["total_timeout"]
        raise AppError("PLACES_PROVIDER_TIMEOUT", "Safe failure", 503)

    monkeypatch.setattr(overpass, "request_json", request)
    provider = overpass.OpenStreetMapOverpassProvider(
        None, Settings(_env_file=None, geoapify_api_key="test-only-key")
    )
    with pytest.raises(AppError):
        await provider.discover_nearby(52.52, 13.405, 8000, 5)
    assert clock[0] <= overpass.DISCOVERY_TIMEOUT_SECONDS
    assert len(calls) == 4  # Geoapify plus the three configured Overpass endpoints.
    for call in calls[1:]:
        assert f"[timeout:{int(call['total_timeout']) - 3}]" in call["data"]["data"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(400, text="NEVER_LOG private body"),
        httpx.Response(200, json={"remark": "NEVER_LOG private query"}),
    ],
)
async def test_provider_error_logging_excludes_bodies_and_queries(caplog, response):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response)) as client:
        with pytest.raises(AppError):
            await request_json(client, "GET", "https://example.test", provider="PLACES")
    assert "NEVER_LOG" not in caplog.text
