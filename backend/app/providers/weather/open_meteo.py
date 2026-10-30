import asyncio
import logging
import math
from datetime import UTC, date, datetime
from statistics import fmean
from zoneinfo import ZoneInfo

import httpx
from pydantic import ValidationError

from app.core.errors import AppError
from app.providers.weather.base import WeatherProvider
from app.providers.weather.codes import WEATHER_CODES, condition, severe_code
from app.schemas.weather import DailyWeather, WeatherPeriod
from app.services.weather_risk_service import evaluate_risk

logger = logging.getLogger("nomvira.weather")
MESSAGE = "Weather is temporarily unavailable. Your trip and itinerary are safe."
PERIOD_HOURS = {"morning": (8, 12), "afternoon": (12, 17), "evening": (17, 22)}
DAILY_VARIABLES = (
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "apparent_temperature_max",
    "apparent_temperature_min",
    "precipitation_probability_max",
    "precipitation_sum",
    "wind_speed_10m_max",
    "sunrise",
    "sunset",
)
HOURLY_VARIABLES = (
    "temperature_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
)


def _average(values):
    return round(fmean(values), 1) if values else None


def _maximum(values):
    return max(values) if values else None


def _values(table, key):
    times, values = table["time"], table[key]
    if not isinstance(values, list) or len(values) != len(times):
        raise ValueError("Inconsistent weather series")
    for value in values:
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
            raise ValueError("Invalid weather measurement")
    return values


def normalize_forecast(data: dict, timezone: str, start: date, end: date) -> list[DailyWeather]:
    zone = ZoneInfo(timezone)
    daily, hourly = data["daily"], data["hourly"]
    for table, variables, bound in [(daily, DAILY_VARIABLES, 16), (hourly, HOURLY_VARIABLES, 400)]:
        if not isinstance(table["time"], list) or len(table["time"]) > bound:
            raise ValueError("Unbounded weather series")
        for key in ("time", *variables):
            _values(table, key)
        if len(set(table["time"])) != len(table["time"]):
            raise ValueError("Duplicate weather timestamps")
    for table, variables in [("daily", DAILY_VARIABLES), ("hourly", HOURLY_VARIABLES)]:
        units = data[f"{table}_units"]
        if not isinstance(units, dict):
            raise ValueError("Invalid weather units")
        for variable in variables:
            expected = (
                "°C"
                if "temperature" in variable
                else (
                    "km/h"
                    if "wind_speed" in variable
                    else "%"
                    if "probability" in variable
                    else "mm"
                    if "precipitation" in variable
                    else None
                )
            )
            if expected is not None and units.get(variable) != expected:
                raise ValueError("Unexpected weather units")

    def timestamp(value):
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("Invalid weather timestamp")
        return datetime.fromtimestamp(value, UTC).astimezone(zone)

    hours = [(timestamp(value), index) for index, value in enumerate(hourly["time"])]
    result = []
    for i, instant in enumerate(daily["time"]):
        day = timestamp(instant).date()
        if not start <= day <= end:
            continue
        # A date with no daily measurements is not genuine forecast coverage.
        if all(
            daily[key][i] is None for key in DAILY_VARIABLES if key not in ("sunrise", "sunset")
        ):
            continue
        periods = []
        for period, (first, last) in PERIOD_HOURS.items():
            indices = [
                index
                for local, index in hours
                if local.date() == day and first <= local.hour < last
            ]
            collected = {
                key: [hourly[key][j] for j in indices if hourly[key][j] is not None]
                for key in HOURLY_VARIABLES
            }
            code = severe_code(collected["weather_code"])
            label, icon, _ = condition(code)
            p = WeatherPeriod(
                period=period,
                temperature_c=_average(collected["temperature_2m"]),
                apparent_temperature_c=_average(collected["apparent_temperature"]),
                apparent_temperature_max_c=_maximum(collected["apparent_temperature"]),
                apparent_temperature_min_c=min(collected["apparent_temperature"])
                if collected["apparent_temperature"]
                else None,
                precipitation_probability=round(_maximum(collected["precipitation_probability"]))
                if collected["precipitation_probability"]
                else None,
                precipitation_mm=round(sum(collected["precipitation"]), 2)
                if collected["precipitation"]
                else None,
                wind_speed_kmh=_maximum(collected["wind_speed_10m"]),
                weather_code=code,
                condition=label,
                icon=icon,
                complete=code in WEATHER_CODES
                and len(indices) == last - first
                and all(len(values) == len(indices) for values in collected.values()),
            )
            p.risk = evaluate_risk(p)
            periods.append(p)
        code = daily["weather_code"][i]
        label, icon, _ = condition(code)
        result.append(
            DailyWeather(
                date=day,
                weather_code=code,
                condition=label,
                icon=icon,
                temperature_max_c=daily["temperature_2m_max"][i],
                temperature_min_c=daily["temperature_2m_min"][i],
                apparent_temperature_max_c=daily["apparent_temperature_max"][i],
                apparent_temperature_min_c=daily["apparent_temperature_min"][i],
                precipitation_probability_max=round(daily["precipitation_probability_max"][i])
                if daily["precipitation_probability_max"][i] is not None
                else None,
                precipitation_sum_mm=daily["precipitation_sum"][i],
                wind_speed_max_kmh=daily["wind_speed_10m_max"][i],
                sunrise=timestamp(daily["sunrise"][i]) if daily["sunrise"][i] is not None else None,
                sunset=timestamp(daily["sunset"][i]) if daily["sunset"][i] is not None else None,
                periods=periods,
            )
        )
    if len({day.date for day in result}) != len(result):
        raise ValueError("Duplicate weather days")
    return sorted(result, key=lambda day: day.date)


class OpenMeteoWeatherProvider(WeatherProvider):
    def __init__(self, client: httpx.AsyncClient, url: str):
        self.client = client
        self.url = (
            url.rstrip("/")
            if url.rstrip("/").endswith("/forecast")
            else url.rstrip("/") + "/forecast"
        )

    async def forecast(self, latitude, longitude, timezone, start_date, end_date):
        try:
            async with asyncio.timeout(12):
                response = await self.client.get(
                    self.url,
                    params={
                        "latitude": latitude,
                        "longitude": longitude,
                        "timezone": timezone,
                        "start_date": start_date.isoformat(),
                        "end_date": end_date.isoformat(),
                        "daily": ",".join(DAILY_VARIABLES),
                        "hourly": ",".join(HOURLY_VARIABLES),
                        "timeformat": "unixtime",
                        "temperature_unit": "celsius",
                        "wind_speed_unit": "kmh",
                        "precipitation_unit": "mm",
                    },
                )
        except (httpx.TimeoutException, TimeoutError):
            logger.warning("weather_provider_timeout")
            raise AppError("WEATHER_PROVIDER_TIMEOUT", MESSAGE, 503) from None
        except httpx.RequestError:
            logger.warning("weather_provider_connection_failed")
            raise AppError("WEATHER_PROVIDER_UNAVAILABLE", MESSAGE, 503) from None
        if response.status_code == 429:
            raise AppError("WEATHER_PROVIDER_RATE_LIMITED", MESSAGE, 429)
        if response.status_code != 200:
            logger.warning("weather_provider_failed status=%s", response.status_code)
            raise AppError("WEATHER_PROVIDER_UNAVAILABLE", MESSAGE, 503)
        try:
            if len(response.content) > 500_000:
                raise ValueError
            data = response.json()
            if not isinstance(data, dict) or data.get("error"):
                raise ValueError
            return normalize_forecast(data, timezone, start_date, end_date)
        except (KeyError, TypeError, ValueError, OverflowError, OSError, ValidationError):
            logger.warning("weather_provider_invalid_response")
            raise AppError("WEATHER_PROVIDER_INVALID_RESPONSE", MESSAGE, 502) from None
