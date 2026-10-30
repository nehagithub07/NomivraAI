import asyncio
import logging
import time
from collections import OrderedDict, deque
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.errors import AppError
from app.providers.weather.base import WeatherProvider
from app.schemas.weather import (
    CoverageGap,
    WeatherForecast,
    WeatherOverviewRequest,
    WeatherReport,
    WeatherRequest,
)
from app.services.weather_risk_service import detect_conflicts

logger = logging.getLogger("nomvira.weather")
FORECAST_DAYS = 16
CACHE_TTL_SECONDS = 1800
REFRESH_COOLDOWN_SECONDS = 60
MAX_CACHE_ENTRIES = 128
MAX_IN_FLIGHT = 4


class WeatherService:
    def __init__(self, provider: WeatherProvider):
        self.provider = provider
        self.entries: OrderedDict[tuple, tuple[float, WeatherForecast]] = OrderedDict()
        self.pending: dict[tuple, asyncio.Task] = {}
        self.attempts: OrderedDict[tuple, float] = OrderedDict()
        self.global_events: deque[float] = deque()

    async def report(self, request: WeatherOverviewRequest) -> WeatherReport:
        forecast = await self.forecast(request.forecast)
        return WeatherReport(
            forecast=forecast,
            analyzed_version_id=request.version_id,
            conflicts=detect_conflicts(forecast, request.items),
        )

    async def forecast(self, request: WeatherRequest, *, now: datetime | None = None):
        now = now or datetime.now(UTC)
        today = now.astimezone(ZoneInfo(request.timezone)).date()
        horizon = today + timedelta(days=FORECAST_DAYS - 1)
        base = dict(
            latitude=request.latitude,
            longitude=request.longitude,
            timezone=request.timezone,
            start_date=request.start_date,
            end_date=request.end_date,
        )
        empty = WeatherForecast(
            **base,
            availability="past_trip"
            if request.end_date < today
            else ("not_yet_available" if request.start_date > horizon else "unavailable"),
        )
        if empty.availability != "unavailable":
            empty.uncovered_ranges = [
                CoverageGap(
                    start_date=request.start_date,
                    end_date=request.end_date,
                    reason="past"
                    if empty.availability == "past_trip"
                    else "outside_forecast_window",
                )
            ]
            return empty
        key = (
            request.latitude,
            request.longitude,
            request.timezone,
            request.start_date,
            request.end_date,
            today,
        )
        cached = self.entries.get(key)
        clock = time.monotonic()
        if cached and cached[0] > clock and not request.refresh:
            self.entries.move_to_end(key)
            return cached[1].model_copy(deep=True, update={"cached": True})
        if request.cache_only:
            return empty  # Tab navigation never creates a provider request or returns stale facts.
        if key in self.pending:
            return (await asyncio.shield(self.pending[key])).model_copy(
                deep=True, update={"cached": True}
            )
        if clock - self.attempts.get(key, float("-inf")) < REFRESH_COOLDOWN_SECONDS:
            raise AppError(
                "WEATHER_RATE_LIMITED", "Please wait a minute before refreshing weather.", 429
            )
        if len(self.pending) >= MAX_IN_FLIGHT:
            raise AppError(
                "WEATHER_RATE_LIMITED", "Weather is busy. Please try again shortly.", 429
            )
        while self.global_events and clock - self.global_events[0] >= 60:
            self.global_events.popleft()
        if len(self.global_events) >= 60:
            raise AppError(
                "WEATHER_RATE_LIMITED", "Weather is busy. Please try again shortly.", 429
            )
        self.global_events.append(clock)
        self.attempts[key] = clock
        self.attempts.move_to_end(key)
        while len(self.attempts) > MAX_CACHE_ENTRIES:
            self.attempts.popitem(last=False)

        async def load():
            try:
                logger.info("weather_forecast_requested")
                days = await self.provider.forecast(
                    request.latitude,
                    request.longitude,
                    request.timezone,
                    max(request.start_date, today),
                    min(request.end_date, horizon),
                )
                days = [
                    day
                    for day in days
                    if max(request.start_date, today) <= day.date <= min(request.end_date, horizon)
                ]
                fetched = datetime.now(UTC)
                result = WeatherForecast(
                    **base,
                    fetched_at=fetched,
                    expires_at=fetched + timedelta(seconds=CACHE_TTL_SECONDS),
                    days=days,
                    availability="available"
                    if len(days) == (request.end_date - request.start_date).days + 1
                    else "partially_available"
                    if days
                    else "unavailable",
                )
                # Describe missing ranges without allocating one object per trip day.
                cursor = request.start_date
                gaps = []
                for covered in days:
                    if cursor < covered.date:
                        gaps.append((cursor, covered.date - timedelta(days=1)))
                    cursor = covered.date + timedelta(days=1)
                if cursor <= request.end_date:
                    gaps.append((cursor, request.end_date))
                for first_gap, last_gap in gaps:
                    sections = [
                        (first_gap, min(last_gap, today - timedelta(days=1)), "past"),
                        (max(first_gap, today), min(last_gap, horizon), "missing_data"),
                        (
                            max(first_gap, horizon + timedelta(days=1)),
                            last_gap,
                            "outside_forecast_window",
                        ),
                    ]
                    for first, last, reason in sections:
                        if first <= last:
                            result.uncovered_ranges.append(
                                CoverageGap(start_date=first, end_date=last, reason=reason)
                            )
                self.entries[key] = (time.monotonic() + CACHE_TTL_SECONDS, result)
                self.entries.move_to_end(key)
                while len(self.entries) > MAX_CACHE_ENTRIES:
                    self.entries.popitem(last=False)
                logger.info(
                    "weather_forecast_completed availability=%s days=%d",
                    result.availability,
                    len(days),
                )
                return result
            finally:
                self.pending.pop(key, None)

        task = asyncio.create_task(load())
        self.pending[key] = task
        task.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return (await asyncio.shield(task)).model_copy(deep=True)
