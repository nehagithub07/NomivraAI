"""Bounded process counters, without identifiers, URLs, prompts or provider bodies."""

import asyncio
import logging
import time
from collections import defaultdict, deque
from contextvars import ContextVar
from decimal import Decimal

import httpx

from app.core.errors import AppError

current_monitor: ContextVar = ContextVar("nomvira_monitor", default=None)
current_request_id: ContextVar = ContextVar("nomvira_request_id", default=None)
current_feature: ContextVar = ContextVar("nomvira_feature", default="other")
FEATURES = {
    "places",
    "destinations",
    "accommodations",
    "food",
    "itineraries",
    "budget",
    "weather",
    "companion",
    "routing",
    "memory",
    "diagnostics",
}
logger = logging.getLogger("nomvira.metrics")


def feature_name(path):
    if path in {"/health", "/ready"}:
        return "health"
    parts = path.split("/")
    return (
        parts[3]
        if len(parts) > 3 and parts[:3] == ["", "api", "v1"] and parts[3] in FEATURES
        else "other"
    )


class RuntimeMonitor:
    def __init__(self, settings):
        self.settings, self.started = settings, time.monotonic()
        self.providers = defaultdict(
            lambda: dict(
                requests=0,
                completed=0,
                failures=0,
                timeouts=0,
                cancelled=0,
                blocked=0,
                latency_ms_total=0.0,
                last_http_status=None,
            )
        )
        self.features = defaultdict(
            lambda: dict(requests=0, failures=0, cache_hits=0, cache_misses=0, coalesced=0)
        )
        self.models = defaultdict(
            lambda: dict(
                requests=0,
                failures=0,
                usage_missing=0,
                input_tokens=0,
                cached_input_tokens=0,
                output_tokens=0,
                thinking_tokens=0,
                total_tokens=0,
                estimated_cost_usd=Decimal(0),
                unpriced_calls=0,
            )
        )
        self.events, self.day, self.daily_tokens = defaultdict(deque), int(time.time() // 86400), 0
        self.hosts = {}
        groups = {
            "overpass": ["overpass_api_url", "overpass_fallback_url", "overpass_last_resort_url"],
            "geoapify": ["geoapify_base_url"],
            "stayapi": ["stayapi_base_url"],
            "geocoding": ["open_meteo_geocoding_url"],
            "weather": ["open_meteo_forecast_url"],
            "routing": ["openrouteservice_base_url"],
        }
        for label, names in groups.items():
            for name in names:
                value = getattr(settings, name, None)
                if value:
                    self.hosts[httpx.URL(str(value)).host] = label

    def reserve(self, key, limit):
        now, events = time.monotonic(), self.events[key]
        while events and events[0] <= now - 60:
            events.popleft()
        if len(events) >= limit:
            return False
        events.append(now)
        return True

    def reserve_provider(self, provider):
        if self.reserve(provider, self.settings.provider_max_requests_per_minute):
            self.providers[provider]["requests"] += 1
            return
        self.providers[provider]["blocked"] += 1
        codes = {
            "places": "PLACES_PROVIDER_RATE_LIMITED",
            "food": "FOOD_PROVIDER_RATE_LIMITED",
            "accommodations": "ACCOMMODATION_RATE_LIMITED",
            "routing": "ROUTING_PROVIDER_RATE_LIMITED",
            "weather": "WEATHER_RATE_LIMITED",
            "destinations": "GEOCODING_RATE_LIMITED",
        }
        raise AppError(
            codes.get(current_feature.get(), "PROVIDER_RATE_LIMITED"),
            "Provider usage is temporarily limited. Please try again later.",
            429,
        )

    def roll_day(self):
        day = int(time.time() // 86400)
        if day != self.day:
            self.day, self.daily_tokens = day, 0

    def reserve_model(self, model):
        self.roll_day()
        daily_limit = self.daily_tokens >= self.settings.gemini_daily_token_limit
        if daily_limit or not self.reserve("gemini", self.settings.gemini_max_requests_per_minute):
            self.providers["gemini"]["blocked"] += 1
            code = (
                "COMPANION_RATE_LIMITED"
                if current_feature.get() == "companion"
                else "ITINERARY_RATE_LIMITED"
                if current_feature.get() == "itineraries"
                else "MEMORY_RATE_LIMITED"
            )
            raise AppError(
                code,
                "AI usage is temporarily limited. Saved trip data is unchanged.",
                429,
                retry_after_seconds=int((self.day + 1) * 86400 - time.time()) + 1
                if daily_limit
                else 60,
            )
        self.models[model]["requests"] += 1
        self.providers["gemini"]["requests"] += 1

    def model_usage(self, model, usage):
        entry = self.models[model]
        if usage is None or all(
            getattr(usage, n, None) is None
            for n in ("prompt_token_count", "total_token_count", "candidates_token_count")
        ):
            entry["usage_missing"] += 1
            return

        def count(name):
            value = getattr(usage, name, None)
            return (
                value
                if isinstance(value, int) and not isinstance(value, bool) and value >= 0
                else 0
            )

        prompt, cached = count("prompt_token_count"), count("cached_content_token_count")
        output, thinking = count("candidates_token_count"), count("thoughts_token_count")
        total = count("total_token_count") or prompt + output + thinking
        self.roll_day()
        self.daily_tokens += total
        for name, value in [
            ("input_tokens", prompt),
            ("cached_input_tokens", cached),
            ("output_tokens", output),
            ("thinking_tokens", thinking),
            ("total_tokens", total),
        ]:
            entry[name] += value
        pricing = self.settings.gemini_pricing_json.get(model)
        if (
            pricing is None
            or any(
                not isinstance(getattr(usage, name, None), int)
                or isinstance(getattr(usage, name, None), bool)
                or getattr(usage, name) < 0
                for name in ("prompt_token_count", "candidates_token_count")
            )
            or cached > prompt
            or cached
            and pricing.cached_input_per_million is None
        ):
            entry["unpriced_calls"] += 1
            return
        entry["estimated_cost_usd"] += (
            (prompt - cached) * pricing.input_per_million
            + cached * (pricing.cached_input_per_million or Decimal(0))
            + (output + thinking) * pricing.output_per_million
        ) / Decimal(1_000_000)

    def cache(self, outcome):
        self.features[current_feature.get()][
            {"hit": "cache_hits", "miss": "cache_misses", "coalesced": "coalesced"}[outcome]
        ] += 1

    def snapshot(self):
        self.roll_day()
        providers, models = {}, {}
        for name, counts in self.providers.items():
            done = counts["completed"]
            providers[name] = {
                **counts,
                "error_rate": round(counts["failures"] / done, 4) if done else None,
                "average_latency_ms": round(counts["latency_ms_total"] / done, 2) if done else None,
                "observed": bool(done),
            }
        for model, counts in self.models.items():
            known = counts["requests"] > counts["usage_missing"] + counts["unpriced_calls"]
            models[model] = {
                **counts,
                "estimated_cost_usd": str(counts["estimated_cost_usd"]) if known else None,
                "cost_incomplete": bool(counts["usage_missing"] or counts["unpriced_calls"]),
                "estimate_only": True,
            }
        return {
            "scope": "single_process_since_restart",
            "uptime_seconds": round(time.monotonic() - self.started),
            "providers": providers,
            "features": dict(self.features),
            "models": models,
            "daily_observed_tokens": self.daily_tokens,
            "cost_note": (
                "Token-only estimates; excludes unreported usage, "
                "tool fees, taxes and billing adjustments."
            ),
        }


class ObservedAsyncClient(httpx.AsyncClient):
    def __init__(self, *args, monitor, **kwargs):
        self.monitor = monitor
        super().__init__(*args, **kwargs)

    async def send(self, request, *args, **kwargs):
        provider = self.monitor.hosts.get(request.url.host)
        if not provider:
            return await super().send(request, *args, **kwargs)
        self.monitor.reserve_provider(provider)
        started, status = time.monotonic(), None
        counts = self.monitor.providers[provider]
        try:
            response = await super().send(request, *args, **kwargs)
            status = response.status_code
            counts["failures"] += int(status >= 300)
            return response
        except BaseException as exc:
            counts["failures"] += 1
            counts["timeouts"] += int(isinstance(exc, httpx.TimeoutException))
            counts["cancelled"] += int(isinstance(exc, asyncio.CancelledError))
            raise
        finally:
            counts["completed"] += 1
            counts["last_http_status"] = status
            counts["latency_ms_total"] += (time.monotonic() - started) * 1000
            logger.info(
                "provider_call",
                extra={
                    "metrics": {
                        "provider": provider,
                        "http_status": status,
                        "elapsed_ms": round((time.monotonic() - started) * 1000),
                    }
                },
            )


async def model_request(operation, **kwargs):
    monitor = current_monitor.get()
    if monitor is None:
        return await operation(**kwargs)
    model = kwargs["model"]
    monitor.reserve_model(model)
    counts, started = monitor.providers["gemini"], time.monotonic()
    status, outcome = None, "success"
    try:
        response = await operation(**kwargs)
    except BaseException as exc:
        code = getattr(exc, "code", None)
        if isinstance(code, int) and not isinstance(code, bool) and 100 <= code <= 599:
            status = code
        outcome = "cancelled" if isinstance(exc, asyncio.CancelledError) else "failure"
        monitor.models[model]["failures"] += 1
        monitor.models[model]["usage_missing"] += 1
        counts["failures"] += 1
        counts["cancelled"] += int(isinstance(exc, asyncio.CancelledError))
        counts["timeouts"] += int(
            isinstance(exc, (TimeoutError, httpx.TimeoutException)) or status in (408, 504)
        )
        raise
    else:
        monitor.model_usage(model, getattr(response, "usage_metadata", None))
        return response
    finally:
        counts["last_http_status"] = status
        counts["completed"] += 1
        counts["latency_ms_total"] += (time.monotonic() - started) * 1000
        logger.info(
            "model_call",
            extra={
                "metrics": {
                    "model": model,
                    "outcome": outcome,
                    "http_status": status,
                    "elapsed_ms": round((time.monotonic() - started) * 1000),
                }
            },
        )


def cache_event(outcome):
    monitor = current_monitor.get()
    if monitor:
        monitor.cache(outcome)
