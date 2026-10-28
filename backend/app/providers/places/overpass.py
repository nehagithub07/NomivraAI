import math
from typing import Any

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.core.provider_http import request_json
from app.providers.places.base import PlacesProvider
from app.schemas.place import PlaceCandidate, PlaceCategory

USEFUL_TAGS = {
    "tourism",
    "historic",
    "leisure",
    "website",
    "opening_hours",
    "wikidata",
    "wikipedia",
    "amenity",
}
TOURISM_CATEGORIES: dict[str, PlaceCategory] = {
    "museum": "museum",
    "attraction": "attraction",
    "viewpoint": "viewpoint",
    "gallery": "gallery",
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat_a, lat_b = math.radians(lat1), math.radians(lat2)
    d_lat, d_lon = lat_b - lat_a, math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat_a) * math.cos(lat_b) * math.sin(d_lon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def category_for(tags: dict[str, str]) -> PlaceCategory | None:
    if tags.get("tourism") in TOURISM_CATEGORIES:
        return TOURISM_CATEGORIES[tags["tourism"]]
    if tags.get("historic") and tags["historic"] != "no":
        return "monument" if tags["historic"] in {"monument", "memorial"} else "historic"
    if tags.get("leisure") == "park":
        return "park"
    if tags.get("amenity") == "arts_centre":
        return "arts_centre"
    return None


def build_query(latitude: float, longitude: float, radius: int, limit: int) -> str:
    around, count = f"(around:{radius},{latitude:.6f},{longitude:.6f})", min(60, limit * 2)
    # Node body contains coordinates. Tags+center avoids way/relation member lists.
    return (
        "[out:json][timeout:18][maxsize:67108864];("
        f'nwr{around}["tourism"~"^(attraction|museum|viewpoint|gallery)$"]["name"];'
        f'nwr{around}["historic"]["historic"!="no"]["name"];'
        f'nwr{around}["leisure"="park"]["name"];'
        f'nwr{around}["amenity"="arts_centre"]["name"];'
        ")->.candidates;"
        f"node.candidates;out body {count};"
        f"way.candidates;out tags center {count};"
        f"relation.candidates;out tags center {count};"
    )


def normalize_elements(
    data: dict[str, Any], latitude: float, longitude: float, radius: int, limit: int
) -> list[PlaceCandidate]:
    elements = data.get("elements")
    if not isinstance(elements, list):
        raise AppError(
            "PLACES_PROVIDER_INVALID_RESPONSE", "Place discovery is temporarily unavailable."
        )
    places: dict[str, PlaceCandidate] = {}
    for item in elements[:180]:
        try:
            tags = item.get("tags", {})
            if not isinstance(tags, dict) or not isinstance(tags.get("name"), str):
                continue
            name, category = " ".join(tags["name"].split())[:500], category_for(tags)
            if not name or not category or item["type"] not in {"node", "way", "relation"}:
                continue
            point = item if item["type"] == "node" else item["center"]
            lat, lon = float(point["lat"]), float(point["lon"])
            distance = haversine_km(latitude, longitude, lat, lon)
            if distance * 1000 > radius:
                continue
            place = PlaceCandidate(
                provider_place_id=f"{item['type']}/{item['id']}",
                name=name,
                category=category,
                latitude=lat,
                longitude=lon,
                distance_km=round(distance, 3),
                tags={
                    key: value[:500]
                    for key, value in tags.items()
                    if key in USEFUL_TAGS and isinstance(value, str)
                },
            )
            places.setdefault(place.provider_place_id, place)
        except (KeyError, TypeError, ValueError, AttributeError, ValidationError):
            continue
    unique: list[PlaceCandidate] = []
    for place in sorted(
        places.values(), key=lambda item: (item.distance_km, item.provider_place_id)
    ):
        if any(
            other.name.casefold() == place.name.casefold()
            and haversine_km(other.latitude, other.longitude, place.latitude, place.longitude)
            < 0.05
            for other in unique
        ):
            continue
        unique.append(place)
        if len(unique) == limit:
            break
    return unique


class OpenStreetMapOverpassProvider(PlacesProvider):
    def __init__(self, client: httpx.AsyncClient, settings: Settings):
        self.client, self.settings = client, settings

    async def discover_nearby(
        self, latitude: float, longitude: float, radius_meters: int, limit: int
    ) -> list[PlaceCandidate]:
        data = await request_json(
            self.client,
            "POST",
            str(self.settings.overpass_api_url),
            provider="PLACES",
            total_timeout=25,
            timeout=httpx.Timeout(22, connect=3, pool=3),
            headers={"User-Agent": self.settings.provider_user_agent},
            data={"data": build_query(latitude, longitude, radius_meters, limit)},
        )
        return normalize_elements(data, latitude, longitude, radius_meters, limit)
