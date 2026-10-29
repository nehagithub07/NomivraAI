import asyncio
import logging
import time

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.core.rate_limit import ProviderLimits
from app.main import create_app
from app.schemas.place import PlaceDiscoveryResponse
from app.services.destination_service import PlaceDiscoveryService

KEY = "test-internal-application-key-never-real"
HEADERS = {"X-Nomvira-Internal-Key": KEY}
BODY = {"latitude": 35.6895, "longitude": 139.6917}


async def test_first_discovery_and_owned_release():
    limits = ProviderLimits()
    assert limits.discovery_wait_seconds == 8 and limits.discovery_cooldown_seconds == 2
    started = time.monotonic()
    await limits.begin_discovery()
    assert time.monotonic() - started < 1
    assert limits.discovery_lock.locked()
    limits.end_discovery()
    assert not limits.discovery_lock.locked()


async def test_rapid_sequential_calls_wait_for_courtesy_gap():
    limits = ProviderLimits(discovery_cooldown_seconds=0.05)
    async with limits.discovery():
        first_start = limits.last_discovery
    async with limits.discovery():
        assert limits.last_discovery - first_start >= 0.045
    assert not limits.discovery_lock.locked()


async def test_concurrent_calls_wait_and_proceed_in_order():
    limits = ProviderLimits(discovery_cooldown_seconds=0)
    entered, release, second_entered = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def first():
        async with limits.discovery():
            entered.set()
            await release.wait()

    async def second():
        async with limits.discovery():
            second_entered.set()

    a = asyncio.create_task(first())
    await entered.wait()
    b = asyncio.create_task(second())
    try:
        await asyncio.sleep(0.01)
        assert not second_entered.is_set()
    finally:
        release.set()
        await asyncio.wait_for(asyncio.gather(a, b), 1)
    assert second_entered.is_set() and not limits.discovery_lock.locked()


async def test_wait_timeout_does_not_release_another_requests_slot():
    limits = ProviderLimits(discovery_wait_seconds=0.03, discovery_cooldown_seconds=0)
    async with limits.discovery():

        async def wait():
            with pytest.raises(AppError) as failure:
                await limits.begin_discovery()
            assert failure.value.code == "PLACES_RATE_LIMITED"
            assert failure.value.status_code == 429

        await asyncio.create_task(wait())
        assert limits.discovery_lock.locked()
    assert not limits.discovery_lock.locked()


async def test_cancelled_cooldown_releases_slot_and_next_request_succeeds():
    limits = ProviderLimits(discovery_cooldown_seconds=2)
    limits.last_discovery = time.monotonic()
    waiting = asyncio.create_task(limits.begin_discovery())
    await asyncio.sleep(0.01)
    assert limits.discovery_lock.locked()
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert not limits.discovery_lock.locked()
    limits.discovery_cooldown_seconds = 0
    async with limits.discovery():
        assert limits.discovery_lock.locked()


async def test_cancelled_waiter_preserves_active_owner_and_frees_queue_capacity():
    limits = ProviderLimits(discovery_cooldown_seconds=0)
    async with limits.discovery():
        waiting = asyncio.create_task(limits.begin_discovery())
        await asyncio.sleep(0)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        assert limits.discovery_lock.locked()
        assert limits._discovery_waiters == 0


async def test_cooldown_is_part_of_wait_deadline_and_timeout_releases_slot():
    limits = ProviderLimits(discovery_wait_seconds=0.03, discovery_cooldown_seconds=2)
    limits.last_discovery = time.monotonic()
    with pytest.raises(AppError) as failure:
        await limits.begin_discovery()
    assert failure.value.code == "PLACES_RATE_LIMITED"
    assert not limits.discovery_lock.locked()


async def test_pending_queue_is_bounded():
    limits = ProviderLimits(discovery_cooldown_seconds=0, max_discovery_waiters=2)
    async with limits.discovery():
        waiters = [asyncio.create_task(limits.begin_discovery()) for _ in range(2)]
        try:
            await asyncio.sleep(0)
            assert limits._discovery_waiters == 2
            with pytest.raises(AppError) as failure:
                await limits.begin_discovery()
            assert failure.value.code == "PLACES_RATE_LIMITED"
            assert limits.discovery_lock.locked()
        finally:
            for task in waiters:
                task.cancel()
            await asyncio.gather(*waiters, return_exceptions=True)


async def test_slot_cannot_be_released_by_another_task():
    limits = ProviderLimits()
    async with limits.discovery():

        async def wrong_owner():
            with pytest.raises(RuntimeError, match="owning task"):
                limits.end_discovery()

        await asyncio.create_task(wrong_owner())
        assert limits.discovery_lock.locked()
    assert not limits.discovery_lock.locked()


async def test_cancelled_active_call_releases_slot():
    limits = ProviderLimits(discovery_cooldown_seconds=0)
    entered = asyncio.Event()

    async def run():
        async with limits.discovery():
            entered.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(run())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    async with limits.discovery():
        assert limits.discovery_lock.locked()


@pytest.mark.parametrize(
    "failure", ["429", "timeout", "connect_timeout", "connection_error", "invalid_response"]
)
async def test_provider_failures_release_slot_and_do_not_retry(failure, caplog):
    caplog.set_level(logging.INFO)
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            if failure == "timeout":
                raise httpx.ReadTimeout("PRIVATE credential in URL", request=request)
            if failure == "connect_timeout":
                raise httpx.ConnectTimeout("PRIVATE credential in URL", request=request)
            if failure == "connection_error":
                raise httpx.ConnectError("PRIVATE credential in URL", request=request)
            return (
                httpx.Response(429, text="PRIVATE provider body")
                if failure == "429"
                else httpx.Response(200, json={"invalid": True})
            )
        return httpx.Response(200, json={"elements": []})

    app = create_app(
        Settings(_env_file=None, nomvira_internal_api_key=KEY), httpx.MockTransport(handler)
    )
    app.state.limits = ProviderLimits(discovery_cooldown_seconds=0)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api,
    ):
        response = await api.post("/api/v1/places/discover", headers=HEADERS, json=BODY)
        expected = {
            "429": "PLACES_PROVIDER_RATE_LIMITED",
            "timeout": "PLACES_PROVIDER_UNAVAILABLE",
            "connect_timeout": "PLACES_PROVIDER_CONNECT_TIMEOUT",
            "connection_error": "PLACES_PROVIDER_CONNECTION_ERROR",
            "invalid_response": "PLACES_PROVIDER_INVALID_RESPONSE",
        }[failure]
        assert response.json()["error"]["code"] == expected
        assert response.status_code == (
            429 if failure == "429" else 502 if failure == "invalid_response" else 503
        )
        assert calls == 1 and not app.state.limits.discovery_lock.locked()
        assert (
            await api.post("/api/v1/places/discover", headers=HEADERS, json=BODY)
        ).status_code == 200
        assert calls == 2
    assert "PRIVATE" not in caplog.text and KEY not in caplog.text
    assert "discovery_slot_released" in caplog.text
    if failure == "connect_timeout":
        assert "places_provider_timeout phase=connect" in caplog.text
    if failure == "connection_error":
        assert "places_provider_failure reason=transport type=ConnectError" in caplog.text


async def test_route_returns_local_429_without_calling_provider_when_wait_expires():
    app = create_app(
        Settings(_env_file=None, nomvira_internal_api_key=KEY),
        httpx.MockTransport(lambda request: pytest.fail("No provider call while slot is held")),
    )
    app.state.limits = ProviderLimits(discovery_wait_seconds=0.03, discovery_cooldown_seconds=0)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api,
    ):
        async with app.state.limits.discovery():
            response = await api.post("/api/v1/places/discover", headers=HEADERS, json=BODY)
            assert response.status_code == 429
            assert response.json()["error"]["code"] == "PLACES_RATE_LIMITED"
            assert app.state.limits.discovery_lock.locked()
        assert not app.state.limits.discovery_lock.locked()


async def test_route_releases_slot_after_runtime_error_and_response_validation(monkeypatch):
    app = create_app(Settings(_env_file=None, nomvira_internal_api_key=KEY))
    app.state.limits = ProviderLimits(discovery_cooldown_seconds=0)
    calls = 0

    async def discover(self, body):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("Synthetic runtime error after acquisition")
        if calls == 2:
            return PlaceDiscoveryResponse(latitude=999, longitude=0, radius_meters=5000, places=[])
        return PlaceDiscoveryResponse(
            latitude=body.latitude,
            longitude=body.longitude,
            radius_meters=body.radius_meters,
            places=[],
        )

    monkeypatch.setattr(PlaceDiscoveryService, "discover", discover)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as api,
    ):
        for expected in [500, 500, 200]:
            assert (
                await api.post("/api/v1/places/discover", headers=HEADERS, json=BODY)
            ).status_code == expected
            assert not app.state.limits.discovery_lock.locked()
