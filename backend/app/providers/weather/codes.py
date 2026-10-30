# Open-Meteo's documented WMO interpretation table; unknown codes remain unknown.
# https://open-meteo.com/en/docs#weathervariables
WEATHER_CODES = {
    0: ("Clear", "sun", 0),
    1: ("Mostly clear", "sun", 1),
    2: ("Partly cloudy", "cloud_sun", 2),
    3: ("Cloudy", "cloud", 3),
    45: ("Fog", "fog", 4),
    48: ("Rime fog", "fog", 4),
    51: ("Light drizzle", "rain", 5),
    53: ("Drizzle", "rain", 5),
    55: ("Dense drizzle", "rain", 6),
    56: ("Freezing drizzle", "snow", 9),
    57: ("Dense freezing drizzle", "snow", 9),
    61: ("Light rain", "rain", 6),
    63: ("Rain", "rain", 7),
    65: ("Heavy rain", "rain", 8),
    66: ("Freezing rain", "snow", 9),
    67: ("Heavy freezing rain", "snow", 9),
    71: ("Light snow", "snow", 7),
    73: ("Snow", "snow", 8),
    75: ("Heavy snow", "snow", 9),
    77: ("Snow grains", "snow", 7),
    80: ("Light showers", "rain", 6),
    81: ("Showers", "rain", 7),
    82: ("Heavy showers", "rain", 8),
    85: ("Snow showers", "snow", 8),
    86: ("Heavy snow showers", "snow", 9),
    95: ("Thunderstorm", "storm", 10),
    96: ("Thunderstorm with hail", "storm", 10),
    97: ("Heavy thunderstorm", "storm", 10),
    99: ("Thunderstorm with hail", "storm", 10),
}


def condition(code: int | None):
    return WEATHER_CODES.get(code, ("Conditions unavailable", "unknown", -1))


def severe_code(codes: list[int]) -> int | None:
    return max(codes, key=lambda code: (condition(code)[2], code)) if codes else None
