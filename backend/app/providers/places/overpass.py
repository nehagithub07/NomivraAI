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
from app.schemas.place import (
    PlaceCandidate,
    PlaceCategory,
)

logger = logging.getLogger("nomvira.overpass")


LOCAL_RADIUS_METERS = 8_000
CITY_RADIUS_METERS = 30_000

MAX_RESULTS = 30

# Do not allow one public server to consume the
# whole Next.js request lifetime.
OVERPASS_TOTAL_TIMEOUT_SECONDS = 14
DISCOVERY_TIMEOUT_SECONDS = 40


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


TOURISM_CATEGORIES: dict[
    str,
    PlaceCategory,
] = {
    "museum": "museum",
    "attraction": "attraction",
    "viewpoint": "viewpoint",
    "gallery": "gallery",
    # Existing schema maps these to attraction.
    "theme_park": "attraction",
    "zoo": "attraction",
    "aquarium": "attraction",
}


RETRYABLE_CODES = {
    "PLACES_PROVIDER_CONNECT_TIMEOUT",
    "PLACES_PROVIDER_READ_TIMEOUT",
    "PLACES_PROVIDER_WRITE_TIMEOUT",
    "PLACES_PROVIDER_POOL_TIMEOUT",
    "PLACES_PROVIDER_TIMEOUT",
    "PLACES_PROVIDER_CONNECTION_ERROR",
    "PLACES_PROVIDER_UNAVAILABLE",
    "PLACES_PROVIDER_RATE_LIMITED",
    "PLACES_PROVIDER_INVALID_RESPONSE",
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

    return (
        6371.0088
        * 2
        * math.asin(
            math.sqrt(
                min(
                    1,
                    max(
                        0,
                        a,
                    ),
                )
            )
        )
    )


def category_for(
    tags: dict[
        str,
        str,
    ],
) -> PlaceCategory | None:
    tourism = tags.get("tourism")

    if tourism in TOURISM_CATEGORIES:
        return TOURISM_CATEGORIES[tourism]

    historic = tags.get("historic")

    if historic and historic != "no":
        if historic in {
            "monument",
            "memorial",
        }:
            return "monument"

        return "historic"

    if tags.get("leisure") == "park":
        return "park"

    if tags.get("amenity") == "arts_centre":
        return "arts_centre"

    return None


MAJOR_TOURISM_TYPES = {
    "theme_park",
    "zoo",
    "aquarium",
}


def notability_score(
    place: PlaceCandidate,
) -> int:
    """
    Rank places by tourist significance instead
    of primarily by proximity.

    Wikipedia/Wikidata are strong signals that a
    place is a recognized landmark or attraction.
    """

    score = 0

    tags = place.tags

    # Strongest signals of an established / notable place.
    if tags.get("wikipedia") or tags.get("wikidata"):
        score += 20
    if tags.get("wikipedia") and tags.get("wikidata"):
        score += 2

    tourism = tags.get("tourism")

    # These categories are normally destination attractions.
    if tourism in MAJOR_TOURISM_TYPES:
        score += 16

    if tags.get("historic") in {"monument", "castle", "palace", "archaeological_site"}:
        score += 10

    # Category significance.
    if place.category == "monument":
        score += 4

    elif place.category == "historic":
        score += 3

    elif place.category == "museum":
        score += 2

    elif place.category == "viewpoint":
        score += 2

    elif place.category == "gallery":
        score += 1

    elif place.category == "park":
        score += 1

    # Official website is a weak confidence signal.
    if tags.get("website"):
        score += 1

    return score


def is_famous_candidate(
    place: PlaceCandidate,
) -> bool:
    """
    A primary tourist sight should have a strong
    notability signal instead of merely being nearby.
    """

    tags = place.tags

    if tags.get("wikipedia"):
        return True

    if tags.get("wikidata"):
        return True

    if tags.get("tourism") in MAJOR_TOURISM_TYPES:
        return True

    return False


def bounding_box(
    latitude: float,
    longitude: float,
    radius_meters: int,
) -> tuple[
    float,
    float,
    float,
    float,
]:
    radius = min(
        radius_meters,
        CITY_RADIUS_METERS,
    )

    latitude_delta = radius / 111_320

    cosine = max(
        abs(math.cos(math.radians(latitude))),
        0.01,
    )

    longitude_delta = radius / (111_320 * cosine)

    south = max(
        -90.0,
        latitude - latitude_delta,
    )

    north = min(
        90.0,
        latitude + latitude_delta,
    )

    west = max(
        -180.0,
        longitude - longitude_delta,
    )

    east = min(
        180.0,
        longitude + longitude_delta,
    )

    return (
        south,
        west,
        north,
        east,
    )


def build_query(
    latitude: float,
    longitude: float,
    radius: int,
    limit: int,
    timeout_seconds: int = 10,
) -> str:
    """
    Keep the query intentionally targeted.

    We use:
    - 8 km for ordinary nearby attractions
    - 30 km for notable/famous attractions

    This avoids retrieving every tourism object
    across a huge city while still allowing places
    such as theme parks and major monuments.
    """

    city_radius = min(
        radius,
        CITY_RADIUS_METERS,
    )

    local_radius = min(
        city_radius,
        LOCAL_RADIUS_METERS,
    )

    (
        local_south,
        local_west,
        local_north,
        local_east,
    ) = bounding_box(
        latitude,
        longitude,
        local_radius,
    )

    (
        city_south,
        city_west,
        city_north,
        city_east,
    ) = bounding_box(
        latitude,
        longitude,
        city_radius,
    )

    local_bbox = f"({local_south:.6f},{local_west:.6f},{local_north:.6f},{local_east:.6f})"

    city_bbox = f"({city_south:.6f},{city_west:.6f},{city_north:.6f},{city_east:.6f})"

    # We fetch extra candidates and rank them
    # ourselves. Do not request hundreds of objects.
    # Rank a bounded city pool locally instead of letting spatial output order
    # discard major landmarks before we have seen them.
    count = 500

    return (
        "[out:json]"
        f"[timeout:{max(1, min(10, timeout_seconds))}]"
        "[maxsize:16777216];"
        "("
        # -----------------------------------------
        # Nearby normal attractions
        # -----------------------------------------
        f"nwr"
        f'["tourism"~"^(attraction|museum|viewpoint|gallery)$"]'
        f'["name"]'
        f"{local_bbox};"
        f"nwr"
        f'["historic"~"^(monument|memorial|castle|ruins|archaeological_site)$"]'
        f'["name"]'
        f"{local_bbox};"
        f"nwr"
        f'["leisure"="park"]'
        f'["name"]'
        f"{local_bbox};"
        f"nwr"
        f'["amenity"="arts_centre"]'
        f'["name"]'
        f"{local_bbox};"
        # -----------------------------------------
        # Famous attractions across wider city
        # -----------------------------------------
        # Theme parks / zoos / aquariums are
        # inherently major destination attractions.
        f"nwr"
        f'["tourism"~"^(theme_park|zoo|aquarium)$"]'
        f'["name"]'
        f"{city_bbox};"
        # Famous parks with Wikidata.
        f"nwr"
        f'["leisure"="park"]'
        f'["name"]'
        f'["wikidata"]'
        f"{city_bbox};"
        # Famous parks with Wikipedia.
        f"nwr"
        f'["leisure"="park"]'
        f'["name"]'
        f'["wikipedia"]'
        f"{city_bbox};"
        # Wikidata-linked tourism.
        f"nwr"
        f'["tourism"~"^(attraction|museum|viewpoint|gallery)$"]'
        f'["name"]'
        f'["wikidata"]'
        f"{city_bbox};"
        # Wikipedia-linked tourism.
        f"nwr"
        f'["tourism"~"^(attraction|museum|viewpoint|gallery)$"]'
        f'["name"]'
        f'["wikipedia"]'
        f"{city_bbox};"
        # Famous historic sites with Wikidata.
        f"nwr"
        f'["historic"]'
        f'["name"]'
        f'["wikidata"]'
        f"{city_bbox};"
        # Famous historic sites with Wikipedia.
        f"nwr"
        f'["historic"]'
        f'["name"]'
        f'["wikipedia"]'
        f"{city_bbox};"
        ");"
        f"out center qt {count};"
    )


def normalize_elements(
    data: dict[
        str,
        Any,
    ],
    latitude: float,
    longitude: float,
    radius: int,
    limit: int,
) -> list[PlaceCandidate]:
    elements = data.get("elements")

    if not isinstance(
        elements,
        list,
    ):
        raise AppError(
            "PLACES_PROVIDER_INVALID_RESPONSE",
            "Place discovery is temporarily unavailable.",
            502,
        )

    places: dict[
        str,
        PlaceCandidate,
    ] = {}

    for item in elements[:500]:
        try:
            if not isinstance(
                item,
                dict,
            ):
                continue

            tags = item.get(
                "tags",
                {},
            )

            if not isinstance(
                tags,
                dict,
            ) or not isinstance(
                tags.get("name"),
                str,
            ):
                continue

            name = " ".join(tags["name"].split())[:500]

            category = category_for(tags)

            item_type = item.get("type")

            if (
                not name
                or not category
                or item_type
                not in {
                    "node",
                    "way",
                    "relation",
                }
            ):
                continue

            point = item if item_type == "node" else item.get("center")

            if not isinstance(
                point,
                dict,
            ):
                continue

            lat = float(point["lat"])

            lon = float(point["lon"])

            if not -90 <= lat <= 90 or not -180 <= lon <= 180:
                continue

            distance = haversine_km(
                latitude,
                longitude,
                lat,
                lon,
            )

            if distance * 1000 > radius:
                continue

            place = PlaceCandidate(
                provider_place_id=(f"{item_type}/{item['id']}"),
                name=name,
                category=category,
                latitude=lat,
                longitude=lon,
                distance_km=round(
                    distance,
                    3,
                ),
                tags={
                    key: value[:500]
                    for key, value in tags.items()
                    if (
                        key in USEFUL_TAGS
                        and isinstance(
                            value,
                            str,
                        )
                    )
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

    sorted_places = sorted(
        places.values(),
        key=lambda place: (
            -notability_score(place),
            place.distance_km,
            place.name.casefold(),
            place.provider_place_id,
        ),
    )

    unique: list[PlaceCandidate] = []

    for place in sorted_places:
        duplicate = any(
            (other.name.casefold() == place.name.casefold())
            and haversine_km(
                other.latitude,
                other.longitude,
                place.latitude,
                place.longitude,
            )
            < 0.08
            for other in unique
        )

        if duplicate:
            continue

        unique.append(place)

    # Keep the whole ranked shortlist for itinerary planning. A missing wiki
    # tag is not evidence that a real museum or historic site is uninteresting.
    return unique[:limit]


class OpenStreetMapOverpassProvider(PlacesProvider):
    def __init__(
        self,
        client: httpx.AsyncClient,
        settings: Settings,
    ):
        self.client = client
        self.settings = settings

    def endpoints(
        self,
    ) -> list[str]:
        """
        Ordered failover.

        Current preference:
        1. Private.coffee
        2. VK Maps
        3. overpass-api.de

        Values come from Settings so production can
        override them without editing source.
        """

        values = [
            self.settings.overpass_api_url,
            self.settings.overpass_fallback_url,
            self.settings.overpass_last_resort_url,
        ]

        result: list[str] = []

        for value in values:
            if value is None:
                continue

            endpoint = str(value)

            if endpoint not in result:
                result.append(endpoint)

        return result

    async def discover_nearby(
        self,
        latitude: float,
        longitude: float,
        radius_meters: int,
        limit: int,
    ) -> list[PlaceCandidate]:

        effective_radius = min(
            radius_meters,
            CITY_RADIUS_METERS,
        )

        effective_limit = min(
            limit,
            MAX_RESULTS,
        )
        deadline = time.monotonic() + DISCOVERY_TIMEOUT_SECONDS

        # Geoapify serves the same attributed OSM records without depending on
        # a busy public Overpass instance. Query the entire city before ranking
        # so distant landmarks (for example Ramoji Film City) are not truncated.
        api_key = self.settings.geoapify_api_key.get_secret_value()
        if api_key:
            try:
                places = await self._discover_with_geoapify(
                    api_key, latitude, longitude, effective_radius, effective_limit
                )
                if places:
                    return places
            except AppError as exc:
                logger.warning("geoapify_places_failed code=%s", exc.code)

        endpoints = self.endpoints()

        if not endpoints:
            raise AppError(
                "PLACES_CONFIGURATION_ERROR",
                "Place discovery isn't configured.",
                503,
            )

        started_all = time.monotonic()

        last_error: AppError | None = None

        for (
            attempt,
            endpoint,
        ) in enumerate(
            endpoints,
            start=1,
        ):
            remaining = deadline - time.monotonic()
            if remaining <= 1:
                break
            attempt_timeout = min(
                OVERPASS_TOTAL_TIMEOUT_SECONDS, remaining / (len(endpoints) - attempt + 1)
            )
            query = build_query(
                latitude,
                longitude,
                effective_radius,
                effective_limit,
                max(1, int(attempt_timeout) - 3),
            )
            host = httpx.URL(endpoint).host or "unknown"

            started = time.monotonic()

            logger.info(
                ("overpass_calling attempt=%d endpoint_host=%s radius_meters=%d limit=%d"),
                attempt,
                host,
                effective_radius,
                effective_limit,
            )

            try:
                data = await request_json(
                    self.client,
                    "POST",
                    endpoint,
                    provider="PLACES",
                    # Short enough that a failed server
                    # cannot consume the whole web request.
                    total_timeout=attempt_timeout,
                    timeout=httpx.Timeout(
                        connect=4.0,
                        read=11.0,
                        write=6.0,
                        pool=4.0,
                    ),
                    headers={
                        "User-Agent": self.settings.provider_user_agent,
                        "Accept": "application/json",
                    },
                    data={
                        "data": query,
                    },
                )

                places = normalize_elements(
                    data,
                    latitude,
                    longitude,
                    effective_radius,
                    effective_limit,
                )

                logger.info(
                    (
                        "overpass_completed "
                        "attempt=%d "
                        "endpoint_host=%s "
                        "normalized_places=%d "
                        "elapsed_ms=%d"
                    ),
                    attempt,
                    host,
                    len(places),
                    int((time.monotonic() - started) * 1000),
                )

                return places

            except AppError as exc:
                last_error = exc

                logger.warning(
                    ("overpass_attempt_failed attempt=%d endpoint_host=%s code=%s elapsed_ms=%d"),
                    attempt,
                    host,
                    exc.code,
                    int((time.monotonic() - started) * 1000),
                )

                # Invalid request means our Overpass QL
                # itself is bad. Trying another server
                # would not help.
                if exc.code not in RETRYABLE_CODES:
                    raise

        logger.error(
            ("overpass_all_endpoints_failed attempts=%d elapsed_ms=%d"),
            len(endpoints),
            int((time.monotonic() - started_all) * 1000),
        )

        if last_error:
            raise last_error
        raise AppError(
            "PLACES_PROVIDER_UNAVAILABLE", "Place discovery is temporarily unavailable.", 503
        )

    async def _discover_with_geoapify(
        self,
        api_key: str,
        latitude: float,
        longitude: float,
        radius_meters: int,
        limit: int,
    ) -> list[PlaceCandidate]:
        data = await request_json(
            self.client,
            "GET",
            f"{str(self.settings.geoapify_base_url).rstrip('/')}/v2/places",
            provider="GEOAPIFY_PLACES",
            total_timeout=10,
            timeout=httpx.Timeout(connect=3, read=8, write=3, pool=3),
            headers={
                "User-Agent": self.settings.provider_user_agent,
                "Accept": "application/json",
            },
            params={
                "apiKey": api_key,
                "categories": (
                    "tourism.sights,entertainment.museum,entertainment.theme_park,entertainment.zoo"
                ),
                "filter": f"circle:{longitude},{latitude},{radius_meters}",
                "bias": f"proximity:{longitude},{latitude}",
                "limit": 500,
            },
        )

        features = data.get("features")
        if not isinstance(features, list):
            raise AppError(
                "PLACES_PROVIDER_INVALID_RESPONSE",
                "Place discovery is temporarily unavailable.",
                502,
            )

        osm_types = {
            "n": "node",
            "node": "node",
            "w": "way",
            "way": "way",
            "r": "relation",
            "relation": "relation",
        }
        elements: list[dict[str, Any]] = []
        for feature in features[:500]:
            if not isinstance(feature, dict):
                continue
            properties = feature.get("properties")
            if not isinstance(properties, dict):
                continue
            datasource = properties.get("datasource")
            raw = datasource.get("raw") if isinstance(datasource, dict) else None
            if not isinstance(raw, dict):
                continue

            raw_type = raw.get("osm_type")
            item_type = osm_types.get(raw_type) if isinstance(raw_type, str) else None
            raw_id = raw.get("osm_id")
            if (
                item_type is None
                or isinstance(raw_id, bool)
                or not isinstance(raw_id, (int, str))
                or not str(raw_id).isdigit()
                or not 1 <= len(str(raw_id)) <= 19
                or str(raw_id).startswith("0")
            ):
                continue

            tags_source = raw.get("tags")
            if not isinstance(tags_source, dict):
                tags_source = raw
            tags = {
                key: value
                for key, value in tags_source.items()
                if key in USEFUL_TAGS and isinstance(value, str)
            }
            name = properties.get("name")
            if isinstance(name, str) and name and "name" not in tags:
                tags["name"] = name

            latitude_value = properties.get("lat")
            longitude_value = properties.get("lon")
            if (
                isinstance(latitude_value, bool)
                or not isinstance(latitude_value, (int, float))
                or isinstance(longitude_value, bool)
                or not isinstance(longitude_value, (int, float))
            ):
                continue

            element: dict[str, Any] = {
                "type": item_type,
                "id": raw_id,
                "tags": tags,
            }
            if item_type == "node":
                element.update(lat=latitude_value, lon=longitude_value)
            else:
                element["center"] = {
                    "lat": latitude_value,
                    "lon": longitude_value,
                }
            elements.append(element)

        return normalize_elements(
            {"elements": elements},
            latitude,
            longitude,
            radius_meters,
            limit,
        )
