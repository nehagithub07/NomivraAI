import logging
import math
import time
from typing import Any

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.core.provider_http import request_json
from app.providers.places.base import PlacesProvider
from app.schemas.place import PlaceCandidate, PlaceCategory

logger = logging.getLogger("nomvira.overpass")


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


def haversine_km(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    lat_a = math.radians(lat1)
    lat_b = math.radians(lat2)

    d_lat = lat_b - lat_a
    d_lon = math.radians(lon2 - lon1)

    a = math.sin(d_lat / 2) ** 2 + math.cos(lat_a) * math.cos(lat_b) * math.sin(d_lon / 2) ** 2

    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def category_for(
    tags: dict[str, str],
) -> PlaceCategory | None:
    tourism = tags.get("tourism")

    if tourism in TOURISM_CATEGORIES:
        return TOURISM_CATEGORIES[tourism]

    historic = tags.get("historic")

    if historic and historic != "no":
        if historic in {"monument", "memorial"}:
            return "monument"

        return "historic"

    if tags.get("leisure") == "park":
        return "park"

    if tags.get("amenity") == "arts_centre":
        return "arts_centre"

    return None


def bounding_box(
    latitude: float,
    longitude: float,
    radius_meters: int,
) -> tuple[float, float, float, float]:
    """
    Convert an approximate search radius to a bounding box.

    Overpass bounding-box filters are generally cheaper than a large
    around query. Exact radius filtering is still performed in Python
    using Haversine distance.
    """

    radius_meters = min(radius_meters, 5000)

    lat_delta = radius_meters / 111_320

    cos_lat = max(
        abs(math.cos(math.radians(latitude))),
        0.01,
    )

    lon_delta = radius_meters / (111_320 * cos_lat)

    south = max(-90.0, latitude - lat_delta)
    north = min(90.0, latitude + lat_delta)

    west = max(-180.0, longitude - lon_delta)
    east = min(180.0, longitude + lon_delta)

    return south, west, north, east


def build_query(
    latitude: float,
    longitude: float,
    radius: int,
    limit: int,
) -> str:
    # Keep public Overpass requests intentionally small.
    radius = min(radius, 5000)

    # Retrieve a little more than the UI needs because normalization,
    # radius filtering and deduplication may remove candidates.
    count = min(
        50,
        max(20, limit * 3),
    )

    south, west, north, east = bounding_box(
        latitude,
        longitude,
        radius,
    )

    bbox = f"({south:.6f},{west:.6f},{north:.6f},{east:.6f})"

    return (
        "[out:json]"
        "[timeout:25]"
        "[maxsize:33554432];"
        "("
        f'nwr["tourism"~"^(attraction|museum|viewpoint|gallery)$"]'
        f'["name"]{bbox};'
        f'nwr["historic"~"^(monument|memorial|castle|ruins|archaeological_site)$"]'
        f'["name"]{bbox};'
        f'nwr["leisure"="park"]'
        f'["name"]{bbox};'
        f'nwr["amenity"="arts_centre"]'
        f'["name"]{bbox};'
        ");"
        f"out center qt {count};"
    )


def normalize_elements(
    data: dict[str, Any],
    latitude: float,
    longitude: float,
    radius: int,
    limit: int,
) -> list[PlaceCandidate]:
    elements = data.get("elements")

    if not isinstance(elements, list):
        raise AppError(
            "PLACES_PROVIDER_INVALID_RESPONSE",
            "Place discovery is temporarily unavailable.",
        )

    places: dict[str, PlaceCandidate] = {}

    for item in elements[:180]:
        try:
            tags = item.get("tags", {})

            if not isinstance(tags, dict) or not isinstance(tags.get("name"), str):
                continue

            name = " ".join(tags["name"].split())[:500]

            category = category_for(tags)

            if not name or not category or item["type"] not in {"node", "way", "relation"}:
                continue

            if item["type"] == "node":
                point = item
            else:
                point = item.get("center")

            if not isinstance(point, dict):
                continue

            lat = float(point["lat"])
            lon = float(point["lon"])

            distance = haversine_km(
                latitude,
                longitude,
                lat,
                lon,
            )

            # Bounding box is only the fast database filter.
            # This enforces the real circular radius.
            if distance * 1000 > radius:
                continue

            place = PlaceCandidate(
                provider_place_id=(f"{item['type']}/{item['id']}"),
                name=name,
                category=category,
                latitude=lat,
                longitude=lon,
                distance_km=round(distance, 3),
                tags={
                    key: value[:500]
                    for key, value in tags.items()
                    if (key in USEFUL_TAGS and isinstance(value, str))
                },
            )

            places.setdefault(
                place.provider_place_id,
                place,
            )

        except (
            KeyError,
            TypeError,
            ValueError,
            AttributeError,
            ValidationError,
        ):
            continue

    unique: list[PlaceCandidate] = []

    sorted_places = sorted(
        places.values(),
        key=lambda item: (
            item.distance_km,
            item.provider_place_id,
        ),
    )

    for place in sorted_places:
        duplicate = any(
            other.name.casefold() == place.name.casefold()
            and haversine_km(
                other.latitude,
                other.longitude,
                place.latitude,
                place.longitude,
            )
            < 0.05
            for other in unique
        )

        if duplicate:
            continue

        unique.append(place)

        if len(unique) >= limit:
            break

    return unique


class OpenStreetMapOverpassProvider(PlacesProvider):
    def __init__(
        self,
        client: httpx.AsyncClient,
        settings: Settings,
    ):
        self.client = client
        self.settings = settings

    async def discover_nearby(
        self,
        latitude: float,
        longitude: float,
        radius_meters: int,
        limit: int,
    ) -> list[PlaceCandidate]:

        # Protect the shared public Overpass infrastructure.
        effective_radius = min(
            radius_meters,
            5000,
        )

        effective_limit = min(
            limit,
            20,
        )

        started = time.monotonic()
        logger.info(
            "overpass_calling endpoint_host=%s radius_meters=%d limit=%d",
            self.settings.overpass_api_url.host,
            effective_radius,
            effective_limit,
        )

        query = build_query(
            latitude,
            longitude,
            effective_radius,
            effective_limit,
        )

        try:
            data = await request_json(
                self.client,
                "POST",
                str(self.settings.overpass_api_url),
                provider="PLACES",
                # Overall application-side ceiling.
                total_timeout=45,
                # Give the public provider enough time while
                # still preventing an indefinitely hanging request.
                timeout=httpx.Timeout(
                    timeout=40.0,
                    connect=5.0,
                    read=40.0,
                    write=10.0,
                    pool=5.0,
                ),
                headers={
                    "User-Agent": (self.settings.provider_user_agent),
                    "Accept": "application/json",
                },
                data={
                    "data": query,
                },
            )

        except AppError as exc:
            logger.warning("overpass_failed code=%s", exc.code)
            raise

        places = normalize_elements(
            data,
            latitude,
            longitude,
            effective_radius,
            effective_limit,
        )

        logger.info(
            "overpass_completed normalized_places=%d elapsed_ms=%d",
            len(places),
            (time.monotonic() - started) * 1000,
        )

        return places
