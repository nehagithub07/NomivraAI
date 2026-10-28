from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.core.provider_http import request_json
from app.providers.geocoding.base import GeocodingProvider
from app.schemas.destination import DestinationCandidate


def normalize_location(item: dict[str, Any]) -> DestinationCandidate:
    name = item["name"].strip()
    country, admin1 = item.get("country") or None, item.get("admin1") or None
    parts = list(dict.fromkeys(part for part in [name, admin1, country] if part))
    timezone = item.get("timezone") or None
    if timezone:
        try:
            ZoneInfo(timezone)
        except (ValueError, ZoneInfoNotFoundError):
            timezone = None
    return DestinationCandidate(
        provider_location_id=str(item["id"]),
        name=name,
        display_name=", ".join(parts),
        country=country,
        country_code=item.get("country_code") or None,
        admin1=admin1,
        admin2=item.get("admin2") or None,
        latitude=item["latitude"],
        longitude=item["longitude"],
        timezone=timezone,
        feature_code=item.get("feature_code") or None,
        population=item.get("population"),
    )


class OpenMeteoGeocodingProvider(GeocodingProvider):
    def __init__(self, client: httpx.AsyncClient, settings: Settings):
        self.client, self.base = client, str(settings.open_meteo_geocoding_url).rstrip("/")

    async def search(
        self, query: str, limit: int, language: str, country_code: str | None = None
    ) -> list[DestinationCandidate]:
        params: dict[str, str | int] = {
            "name": query,
            "count": limit,
            "language": language,
            "format": "json",
        }
        if country_code:
            params["countryCode"] = country_code
        data = await request_json(
            self.client, "GET", f"{self.base}/search", provider="GEOCODING", params=params
        )
        try:
            results = data.get("results", [])
            if not isinstance(results, list):
                raise ValueError
            destinations: dict[str, DestinationCandidate] = {}
            for item in results[:limit]:
                candidate = normalize_location(item)
                destinations[candidate.provider_location_id] = candidate
            return list(destinations.values())
        except (KeyError, TypeError, AttributeError, ValueError, ValidationError):
            raise AppError(
                "GEOCODING_PROVIDER_INVALID_RESPONSE",
                "Destination search is temporarily unavailable.",
            ) from None

    async def resolve(self, provider_id: str, language: str = "en") -> DestinationCandidate:
        data = await request_json(
            self.client,
            "GET",
            f"{self.base}/get",
            provider="GEOCODING",
            params={"id": provider_id, "language": language},
        )
        try:
            candidate = normalize_location(data)
            if candidate.provider_location_id != provider_id:
                raise ValueError
            return candidate
        except (KeyError, TypeError, AttributeError, ValueError, ValidationError):
            raise AppError(
                "GEOCODING_PROVIDER_INVALID_RESPONSE", "We couldn't confirm this destination."
            ) from None
