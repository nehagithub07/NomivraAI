import asyncio
import io
import json
import logging
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError

from app.core import observability
from app.core.accommodation_cache import AccommodationCache
from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import JsonLogFormatter
from app.core.observability import (
    ObservedAsyncClient,
    RuntimeMonitor,
    current_feature,
    current_monitor,
    model_request,
)
from app.main import create_app


def settings(**kwargs):
    return Settings(_env_file=None, app_env="test", **kwargs)


@pytest.mark.asyncio
async def test_provider_counts_limits_latency_and_private_payload_exclusion(caplog):
    monitor = RuntimeMonitor(settings(provider_max_requests_per_minute=2))
    calls = []

    def handler(request):
        calls.append(True)
        return httpx.Response(503 if len(calls) == 1 else 200, json={"private": "NEVER_LOG"})

    caplog.set_level(logging.INFO, logger="nomvira.metrics")
    async with ObservedAsyncClient(
        monitor=monitor, transport=httpx.MockTransport(handler)
    ) as client:
        for _ in range(2):
            await client.get(
                "https://api.geoapify.com/v2/places?apiKey=NEVER_LOG",
                headers={"Authorization": "NEVER_LOG"},
            )
        with pytest.raises(AppError) as limited:
            await client.get("https://api.geoapify.com/v2/places")
    assert limited.value.status_code == 429
    assert len(calls) == 2
    data = monitor.snapshot()["providers"]["geoapify"]
    assert data["requests"] == 2 and data["failures"] == 1 and data["blocked"] == 1
    assert data["error_rate"] == 0.5 and data["average_latency_ms"] >= 0
    assert "NEVER_LOG" not in caplog.text
    assert "NEVER_LOG" not in json.dumps(monitor.snapshot())


@pytest.mark.asyncio
async def test_transport_timeouts_are_measured_without_raw_errors():
    monitor = RuntimeMonitor(settings())

    def handler(request):
        raise httpx.ReadTimeout("NEVER_LOG credential", request=request)

    async with ObservedAsyncClient(
        monitor=monitor, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(httpx.ReadTimeout):
            await client.get("https://api.geoapify.com/v2/places")
    counts = monitor.snapshot()["providers"]["geoapify"]
    assert counts["timeouts"] == 1 and counts["failures"] == 1
    assert counts["last_http_status"] is None


@pytest.mark.asyncio
async def test_token_accounting_estimates_cached_tokens_and_thinking_and_limits():
    monitor = RuntimeMonitor(
        settings(
            gemini_daily_token_limit=150,
            gemini_pricing_json={
                "test-model": {
                    "input_per_million": "1",
                    "output_per_million": "2",
                    "cached_input_per_million": ".25",
                }
            },
        )
    )
    token = current_monitor.set(monitor)
    calls = []

    async def generate(**kwargs):
        calls.append(True)
        return SimpleNamespace(
            usage_metadata=SimpleNamespace(
                prompt_token_count=100,
                cached_content_token_count=40,
                candidates_token_count=30,
                thoughts_token_count=20,
                total_token_count=150,
            )
        )

    try:
        await model_request(generate, model="test-model", contents="NEVER_LOG private prompt")
        with pytest.raises(AppError):
            await model_request(generate, model="test-model", contents="NEVER_LOG")
    finally:
        current_monitor.reset(token)
    data = monitor.snapshot()["models"]["test-model"]
    assert len(calls) == 1
    assert data["total_tokens"] == 150 and data["thinking_tokens"] == 20
    assert Decimal(data["estimated_cost_usd"]) == Decimal("0.00017")
    assert data["estimate_only"] and not data["cost_incomplete"]
    assert "NEVER_LOG" not in json.dumps(monitor.snapshot())


@pytest.mark.asyncio
async def test_missing_usage_and_missing_prices_never_produce_fabricated_costs():
    monitor = RuntimeMonitor(settings())
    token = current_monitor.set(monitor)

    async def generate(**kwargs):
        return SimpleNamespace(usage_metadata=None)

    try:
        await model_request(generate, model="test-model")
    finally:
        current_monitor.reset(token)
    model = monitor.snapshot()["models"]["test-model"]
    assert model["estimated_cost_usd"] is None and model["cost_incomplete"]
    assert model["usage_missing"] == 1
    monitor.models["another"]["requests"] += 1
    monitor.model_usage("another", SimpleNamespace(total_token_count=12))
    assert monitor.snapshot()["models"]["another"]["estimated_cost_usd"] is None


@pytest.mark.asyncio
async def test_cache_coalescing_records_only_counts_not_keys_or_records():
    monitor = RuntimeMonitor(settings())
    token, feature = current_monitor.set(monitor), current_feature.set("accommodations")
    cache = AccommodationCache(300)
    calls = []

    async def load():
        calls.append(True)
        await asyncio.sleep(0.01)
        return {"private": "NEVER_LOG"}

    try:
        await asyncio.gather(cache.load(("NEVER_LOG",), load), cache.load(("NEVER_LOG",), load))
        await cache.load(("NEVER_LOG",), load)
    finally:
        current_monitor.reset(token)
        current_feature.reset(feature)
    counts = monitor.snapshot()["features"]["accommodations"]
    assert len(calls) == 1 and counts["cache_hits"] == 1 and counts["coalesced"] == 1
    assert "NEVER_LOG" not in json.dumps(monitor.snapshot())


@pytest.mark.asyncio
async def test_diagnostics_require_internal_auth_and_health_never_calls_providers():
    key = "test-monitoring-internal-key-not-real-secret"
    app = create_app(settings(nomvira_internal_api_key=key))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
    ):
        assert (await client.get("/api/v1/diagnostics")).status_code == 401
        assert (await client.get("/health")).status_code == 200
        assert (await client.get("/ready")).status_code == 200
        result = await client.get("/api/v1/diagnostics", headers={"X-Nomvira-Internal-Key": key})
        assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
        assert result.json()["metrics"]["providers"] == {}
        assert result.json()["database_schema_verified"] is False
        assert key not in result.text
    assert current_monitor.get() is None


def test_structured_logs_never_format_exception_payloads():
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(JsonLogFormatter())
    record = logging.LogRecord(
        "test",
        logging.ERROR,
        "test.py",
        1,
        "provider_failed",
        (),
        (RuntimeError, RuntimeError("NEVER_LOG"), None),
    )
    handler.handle(record)
    parsed = json.loads(output.getvalue())
    assert parsed["event"] == "provider_failed"
    assert "NEVER_LOG" not in output.getvalue()


def test_pricing_and_usage_configuration_reject_invalid_values():
    for change in [
        {"gemini_max_requests_per_minute": 0},
        {"provider_max_requests_per_minute": -1},
        {"gemini_pricing_json": {"x": {"input_per_million": -1, "output_per_million": 1}}},
    ]:
        with pytest.raises(ValidationError):
            settings(**change)


def test_total_only_usage_cannot_be_priced_as_zero():
    monitor = RuntimeMonitor(
        settings(
            gemini_pricing_json={"test": {"input_per_million": "1", "output_per_million": "2"}}
        )
    )
    monitor.models["test"]["requests"] = 1
    monitor.model_usage("test", SimpleNamespace(total_token_count=12))
    result = monitor.snapshot()
    assert result["daily_observed_tokens"] == 12
    assert result["models"]["test"]["estimated_cost_usd"] is None
    assert result["models"]["test"]["cost_incomplete"]


def test_daily_limit_retry_budget_and_utc_reset(monkeypatch):
    now = [20000 * 86400 + 3600]
    monkeypatch.setattr(observability.time, "time", lambda: now[0])
    monitor = RuntimeMonitor(settings(gemini_daily_token_limit=10))
    monitor.daily_tokens = 10
    with pytest.raises(AppError) as limited:
        monitor.reserve_model("test")
    assert limited.value.status_code == 429
    assert limited.value.retry_after_seconds == 82801
    now[0] += 86400
    monitor.reserve_model("test")
    assert monitor.daily_tokens == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("timeout", [False, True])
async def test_model_failure_status_and_timeouts_exclude_provider_error_payloads(timeout, caplog):
    class ProviderError(Exception):
        code = 503

    monitor = RuntimeMonitor(settings())
    token = current_monitor.set(monitor)
    caplog.set_level(logging.INFO, logger="nomvira.metrics")

    async def generate(**kwargs):
        raise TimeoutError("NEVER_LOG") if timeout else ProviderError("NEVER_LOG")

    try:
        with pytest.raises((TimeoutError, ProviderError)):
            await model_request(generate, model="test", contents="NEVER_LOG")
    finally:
        current_monitor.reset(token)
    counts = monitor.snapshot()["providers"]["gemini"]
    assert counts["failures"] == 1 and counts["timeouts"] == int(timeout)
    assert counts["last_http_status"] == (None if timeout else 503)
    assert "NEVER_LOG" not in caplog.text
