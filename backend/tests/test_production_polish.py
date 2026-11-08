import logging

import httpx
import pytest

from app.core.config import Settings
from app.main import create_app


@pytest.mark.asyncio
async def test_health_readiness_and_no_wildcard_cors():
    app = create_app(Settings(_env_file=None, app_env="test"))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/ready")).status_code == 503
        assert (await client.get("/health")).json() == {"status": "ok", "service": "nomivra-api"}
        async with app.router.lifespan_context(app):
            response = await client.get("/ready")
            assert response.status_code == 200
            assert response.json() == {"status": "ready"}
            assert response.headers["cache-control"] == "no-store"
            assert "x-request-id" in response.headers
            response = await client.options(
                "/api/v1/itineraries/generate",
                headers={"Origin": "https://foreign.test", "Access-Control-Request-Method": "POST"},
            )
            assert "access-control-allow-origin" not in response.headers
        assert (await client.get("/ready")).status_code == 503


@pytest.mark.asyncio
async def test_unexpected_errors_never_log_payloads_or_raw_exceptions(caplog):
    app = create_app(Settings(_env_file=None, app_env="test"))

    @app.get("/test-private-failure")
    async def fail():
        raise RuntimeError("PRIVATE credential or sensitive provider response")

    caplog.set_level(logging.INFO, logger="nomvira.requests")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/test-private-failure?token=PRIVATE", headers={"Authorization": "Bearer PRIVATE"}
        )
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "unavailable"
    assert "PRIVATE" not in response.text
    assert "PRIVATE" not in caplog.text
    assert "request_failed id=" in caplog.text
    assert "test-private-failure" not in caplog.text
