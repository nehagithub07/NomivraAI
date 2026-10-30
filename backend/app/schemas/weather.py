from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, model_validator

from app.schemas.itinerary import (
    GeneratedItinerary,
    ItineraryGenerationRequest,
    ItineraryGenerationResponse,
    StrictModel,
    TripPlanningContext,
)

Period = Literal["morning", "afternoon", "evening"]
Risk = Literal["low", "moderate", "high", "unknown"]
Setting = Literal["indoor", "outdoor", "mixed", "unknown"]
Temperature = Annotated[float, Field(ge=-100, le=80)]
Probability = Annotated[int, Field(ge=0, le=100, strict=True)]
Amount = Annotated[float, Field(ge=0, le=5000)]


class WeatherRequest(StrictModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timezone: str = Field(min_length=1, max_length=100)
    start_date: date
    end_date: date
    cache_only: bool = False
    refresh: bool = False

    @model_validator(mode="after")
    def valid_dates_zone(self):
        if self.end_date < self.start_date or (self.refresh and self.cache_only):
            raise ValueError("Invalid weather request")
        try:
            ZoneInfo(self.timezone)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError("A confirmed destination timezone is required") from None
        return self


class WeatherRisk(StrictModel):
    level: Risk = "unknown"
    reasons: list[str] = Field(default_factory=list)


class WeatherPeriod(StrictModel):
    period: Period
    temperature_c: Temperature | None = None
    apparent_temperature_c: Temperature | None = None
    apparent_temperature_max_c: Temperature | None = None
    apparent_temperature_min_c: Temperature | None = None
    precipitation_probability: Probability | None = None
    precipitation_mm: Amount | None = None
    weather_code: int | None = None
    condition: str = "Conditions unavailable"
    icon: str = "unknown"
    wind_speed_kmh: Amount | None = None
    complete: bool = False
    risk: WeatherRisk = Field(default_factory=WeatherRisk)


class DailyWeather(StrictModel):
    date: date
    weather_code: int | None = None
    condition: str = "Conditions unavailable"
    icon: str = "unknown"
    temperature_max_c: Temperature | None = None
    temperature_min_c: Temperature | None = None
    apparent_temperature_max_c: Temperature | None = None
    apparent_temperature_min_c: Temperature | None = None
    precipitation_probability_max: Probability | None = None
    precipitation_sum_mm: Amount | None = None
    wind_speed_max_kmh: Amount | None = None
    sunrise: datetime | None = None
    sunset: datetime | None = None
    periods: list[WeatherPeriod] = Field(default_factory=list, max_length=3)


class CoverageGap(StrictModel):
    start_date: date
    end_date: date
    reason: Literal["past", "outside_forecast_window", "missing_data"]


class WeatherForecast(StrictModel):
    provider: Literal["open_meteo"] = "open_meteo"
    latitude: float
    longitude: float
    timezone: str
    start_date: date
    end_date: date
    fetched_at: datetime | None = None
    expires_at: datetime | None = None
    cached: bool = False
    availability: Literal[
        "available", "partially_available", "not_yet_available", "past_trip", "unavailable"
    ]
    days: list[DailyWeather] = Field(default_factory=list, max_length=16)
    uncovered_ranges: list[CoverageGap] = Field(default_factory=list)


class ScheduledWeatherItem(StrictModel):
    date: date
    period: Period
    itinerary_item_id: str = Field(max_length=80)
    candidate_id: str | None = Field(max_length=512)
    candidate_type: Literal["attraction", "food", "hotel", "free_time"]
    category: str | None = Field(default=None, max_length=80)
    title: str = Field(max_length=500)


class WeatherConflict(StrictModel):
    date: date
    period: Period
    itinerary_item_id: str
    candidate_id: str | None
    title: str
    risk_level: Risk
    reason_codes: list[str]
    setting: Setting
    suitability_score: int
    message: str


class WeatherOverviewRequest(StrictModel):
    forecast: WeatherRequest
    version_id: UUID | None = None
    items: list[ScheduledWeatherItem] = Field(default_factory=list, max_length=98)


class WeatherReport(StrictModel):
    forecast: WeatherForecast
    analyzed_version_id: UUID | None
    conflicts: list[WeatherConflict]


class WeatherAdaptationRequest(ItineraryGenerationRequest):
    parent_version_id: UUID
    original: GeneratedItinerary
    forecast: WeatherRequest


class WeatherPlanningContext(TripPlanningContext):
    original: GeneratedItinerary
    verified_weather: WeatherForecast
    conflicts: list[WeatherConflict]
    candidate_settings: dict[str, Setting]
    slot_scores: list[dict]  # Deterministically derived; never supplied by the browser.


class WeatherAdaptationResponse(ItineraryGenerationResponse):
    changed: bool
    parent_version_id: UUID
    weather_fetched_at: datetime | None
    remaining_conflicts: list[WeatherConflict]
    explanation: str
