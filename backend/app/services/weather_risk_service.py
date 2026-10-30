from app.schemas.weather import (
    ScheduledWeatherItem,
    WeatherConflict,
    WeatherForecast,
    WeatherPeriod,
    WeatherRisk,
)

# Travel-disruption heuristics, not official severe-weather warnings.
THRESHOLDS = {
    "rain_probability": 60,
    "rain_mm": 2,
    "heavy_rain_mm": 8,
    "wind_moderate_kmh": 35,
    "wind_high_kmh": 50,
    "heat_moderate_c": 32,
    "heat_high_c": 38,
    "cold_moderate_c": 0,
    "cold_high_c": -10,
}
SUITABILITY = {
    "indoor": {"low": 100, "moderate": 100, "high": 100, "unknown": None},
    "outdoor": {"low": 100, "moderate": 40, "high": 0, "unknown": None},
    "mixed": {"low": 80, "moderate": 60, "high": 30, "unknown": None},
    "unknown": {"low": None, "moderate": None, "high": None, "unknown": None},
}
REASON_MESSAGES = {
    "thunderstorm": "Thunderstorms may disrupt outdoor plans.",
    "heavy_precipitation": "Heavy precipitation may affect outdoor plans.",
    "precipitation": "Rain may affect outdoor plans.",
    "snow_or_ice": "Snow or freezing precipitation may affect outdoor plans.",
    "strong_wind": "Strong wind may affect exposed activities.",
    "temperature_extreme": "Uncomfortable apparent temperatures may affect outdoor plans.",
}


def classify_setting(category: str | None, kind: str = "attraction"):
    if kind in ("food", "hotel", "free_time"):
        return "unknown"  # No unsupported claims about a restaurant's seating or venue access.
    if category in ("museum", "gallery", "arts_centre"):
        return "indoor"
    if category in ("park", "viewpoint"):
        return "outdoor"
    if category in ("historic", "monument"):
        return "mixed"
    return "unknown"


def evaluate_risk(period: WeatherPeriod) -> WeatherRisk:
    high, moderate = [], []
    code = period.weather_code
    if code in (95, 96, 97, 99):
        high.append("thunderstorm")
    if code in (56, 57, 66, 67, 75, 86):
        high.append("snow_or_ice")
    elif code in (71, 73, 77, 85):
        moderate.append("snow_or_ice")
    rain, chance, wind = (
        period.precipitation_mm,
        period.precipitation_probability,
        period.wind_speed_kmh,
    )
    if code in (65, 67, 82) or (rain is not None and rain >= THRESHOLDS["heavy_rain_mm"]):
        high.append("heavy_precipitation")
    elif (
        code in (53, 55, 61, 63, 80, 81)
        or (rain is not None and rain >= THRESHOLDS["rain_mm"])
        or (chance is not None and chance >= THRESHOLDS["rain_probability"])
    ):
        moderate.append("precipitation")
    if wind is not None:
        if wind >= THRESHOLDS["wind_high_kmh"]:
            high.append("strong_wind")
        elif wind >= THRESHOLDS["wind_moderate_kmh"]:
            moderate.append("strong_wind")
    low, hot = period.apparent_temperature_min_c, period.apparent_temperature_max_c
    if (low is not None and low <= THRESHOLDS["cold_high_c"]) or (
        hot is not None and hot >= THRESHOLDS["heat_high_c"]
    ):
        high.append("temperature_extreme")
    elif (low is not None and low <= THRESHOLDS["cold_moderate_c"]) or (
        hot is not None and hot >= THRESHOLDS["heat_moderate_c"]
    ):
        moderate.append("temperature_extreme")
    return WeatherRisk(
        level="high"
        if high
        else "moderate"
        if moderate
        else "low"
        if period.complete
        else "unknown",
        reasons=sorted(set(high + moderate)),
    )


def detect_conflicts(forecast: WeatherForecast, items: list[ScheduledWeatherItem]):
    slots = {(day.date, p.period): p for day in forecast.days for p in day.periods}
    conflicts = []
    for item in items:
        period = slots.get((item.date, item.period))
        setting = classify_setting(item.category, item.candidate_type)
        if item.candidate_type != "attraction" or setting not in ("outdoor", "mixed"):
            continue
        if period is None or period.risk.level not in ("moderate", "high"):
            continue
        if setting == "mixed" and period.risk.level != "high":
            continue
        conflicts.append(
            WeatherConflict(
                date=item.date,
                period=item.period,
                itinerary_item_id=item.itinerary_item_id,
                candidate_id=item.candidate_id,
                title=item.title,
                risk_level=period.risk.level,
                reason_codes=period.risk.reasons,
                setting=setting,
                suitability_score=SUITABILITY[setting][period.risk.level],
                message=" ".join(REASON_MESSAGES[code] for code in period.risk.reasons),
            )
        )
    return conflicts
