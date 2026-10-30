from abc import ABC, abstractmethod
from datetime import date

from app.schemas.weather import DailyWeather


class WeatherProvider(ABC):
    @abstractmethod
    async def forecast(
        self, latitude: float, longitude: float, timezone: str, start_date: date, end_date: date
    ) -> list[DailyWeather]:
        """Return normalized, actually covered days. No synthetic dates or historical estimates."""
