import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.providers.food.base import FoodProvider
from app.schemas.food import FoodCandidate, FoodSearchRequest
from app.services.food_policy import CATEGORIES, DIET_CONDITIONS, normalize_cuisines

MESSAGE = "We couldn't load food recommendations right now. Your trip is safe — please try again."


def text(value: object, maximum: int = 600) -> str | None:
    if not isinstance(value, str):
        return None
    result = " ".join(value.split())[:maximum]
    return result or None


def safe_website(value: object) -> str | None:
    clean = text(value, 2000)
    if not clean:
        return None
    try:
        url = httpx.URL(clean)
        if (
            url.scheme == "https"
            and url.host
            and not url.username
            and not url.password
            and url.port in (None, 443)
        ):
            return clean
    except (ValueError, httpx.InvalidURL):
        pass
    return None


def normalize_food(feature: object) -> FoodCandidate | None:
    if not isinstance(feature, dict) or not isinstance(feature.get("properties"), dict):
        return None
    p = feature["properties"]
    raw_categories = p.get("categories", [])
    categories = (
        [c for c in raw_categories if isinstance(c, str)]
        if isinstance(raw_categories, list)
        else []
    )
    name, place_id = text(p.get("name"), 300), p.get("place_id")
    if (
        not name
        or not isinstance(place_id, str)
        or not 1 <= len(place_id) <= 512
        or any(ord(c) < 32 for c in place_id)
    ):
        return None
    category = next(
        (
            key
            for key, prefix in CATEGORIES.items()
            if any(c == prefix or c.startswith(prefix + ".") for c in categories)
        ),
        "other",
    )
    datasource = p.get("datasource")
    raw = datasource.get("raw", {}) if isinstance(datasource, dict) else {}
    raw = raw if isinstance(raw, dict) else {}
    tags, conflicts = [], []
    for diet in DIET_CONDITIONS:
        for condition in (diet, f"{diet}.only"):
            if condition in categories:
                tags.append(condition)
        # OSM source tags are evidence, never infer from a name or cuisine.
        indication = raw.get(f"diet:{diet}")
        if indication in ("yes", "only"):
            tags.append(f"{diet}.only" if indication == "only" else diet)
        elif indication == "no":
            conflicts.append(diet)
    contact = p.get("contact")
    contact = contact if isinstance(contact, dict) else {}
    geometry = feature.get("geometry")
    coordinates = geometry.get("coordinates", []) if isinstance(geometry, dict) else []
    coordinates = (
        coordinates if isinstance(coordinates, list) and len(coordinates) == 2 else [None, None]
    )
    try:
        return FoodCandidate(
            provider="geoapify",
            provider_place_id=place_id,
            name=name,
            category=category,
            cuisine_types=normalize_cuisines(categories),
            latitude=p.get("lat", coordinates[1]),
            longitude=p.get("lon", coordinates[0]),
            address=text(p.get("formatted")),
            dietary_tags=sorted(set(tags)),
            dietary_conflicts=conflicts,
            opening_hours=text(p.get("opening_hours") or raw.get("opening_hours")),
            website=safe_website(
                p.get("website")
                or contact.get("website")
                or raw.get("website")
                or raw.get("contact:website")
            ),
            # This integration has no consumer ratings or reliable price data.
            rating=None,
            rating_scale=None,
            review_count=None,
        )
    except (ValidationError, TypeError, ValueError):
        return None


class GeoapifyFoodProvider(FoodProvider):
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings, self.client = settings, client

    async def search(self, request: FoodSearchRequest) -> list[FoodCandidate]:
        key = self.settings.geoapify_api_key.get_secret_value()
        if not key:
            raise AppError("FOOD_CONFIGURATION_ERROR", MESSAGE, 503)
        categories = [CATEGORIES[c] for c in dict.fromkeys(request.categories) if c in CATEGORIES]
        if not categories:
            return []
        radius = request.radius_meters or self.settings.default_food_radius_meters
        params = {
            "apiKey": key,
            "categories": ",".join(categories),
            "filter": f"circle:{request.longitude},{request.latitude},{radius}",
            "bias": f"proximity:{request.longitude},{request.latitude}",
            "limit": request.limit,
        }
        if request.dietary_preferences:
            params["conditions"] = ",".join(
                DIET_CONDITIONS[d] for d in dict.fromkeys(request.dietary_preferences)
            )
        try:
            response = await self.client.get(
                f"{str(self.settings.geoapify_base_url).rstrip('/')}/v2/places", params=params
            )
        except (httpx.HTTPError, ValueError):
            raise AppError("FOOD_PROVIDER_UNAVAILABLE", MESSAGE, 503) from None
        if response.status_code in (401, 403):
            raise AppError("FOOD_PROVIDER_AUTH_ERROR", MESSAGE, 503)
        if response.status_code == 429:
            raise AppError("FOOD_PROVIDER_RATE_LIMITED", MESSAGE, 429)
        if response.status_code != 200:
            raise AppError("FOOD_PROVIDER_UNAVAILABLE", MESSAGE, 503)
        try:
            body = response.json()
            if not isinstance(body, dict) or not isinstance(body.get("features"), list):
                raise ValueError()
            features = body["features"][: request.limit]
        except (ValueError, TypeError):
            raise AppError("FOOD_PROVIDER_INVALID_RESPONSE", MESSAGE, 503) from None
        return [
            candidate for feature in features if (candidate := normalize_food(feature)) is not None
        ]
