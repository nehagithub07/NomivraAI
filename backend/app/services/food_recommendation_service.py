import asyncio
import math
import time
from collections import OrderedDict
from datetime import UTC, datetime, timedelta

import httpx

from app.core.accommodation_cache import AccommodationCache
from app.core.config import Settings
from app.core.errors import AppError
from app.providers.food.fixture import FixtureFoodProvider
from app.providers.food.geoapify import MESSAGE, GeoapifyFoodProvider
from app.schemas.food import FoodCandidate, FoodScores, FoodSearchRequest, FoodSearchResponse
from app.services.food_policy import WEIGHTS, diet_matches, distance_km


def active_weights(request: FoodSearchRequest) -> dict[str, float]:
    weights = dict(WEIGHTS)
    if not request.dietary_preferences:
        weights.pop("dietary_match")
    if not request.cuisine_preferences:
        weights.pop("cuisine_match")
    total = sum(weights.values())
    return {key: value / total for key, value in weights.items()}


def eligible(candidate: FoodCandidate, request: FoodSearchRequest) -> bool:
    if not candidate.name.strip() or candidate.category not in request.categories:
        return False
    distance = distance_km(
        request.latitude, request.longitude, candidate.latitude, candidate.longitude
    )
    candidate.distance_km = round(distance, 4)
    if distance * 1000 > request.radius_meters:
        return False
    # Explicit negative metadata conflicts are excluded; missing metadata stays unknown.
    if set(candidate.dietary_conflicts) & set(request.dietary_preferences):
        return False
    return not request.strict_dietary or diet_matches(candidate, request.dietary_preferences)


def score(candidate: FoodCandidate, request: FoodSearchRequest) -> FoodCandidate:
    confirmed = bool(request.dietary_preferences) and diet_matches(
        candidate, request.dietary_preferences
    )
    candidate.dietary_match = (
        "confirmed" if confirmed else "unknown" if request.dietary_preferences else "not_requested"
    )
    cuisines = {c.casefold() for c in candidate.cuisine_types}
    quality = (
        sum(
            (
                bool(candidate.name),
                bool(candidate.cuisine_types),
                bool(candidate.address),
                bool(candidate.dietary_tags),
                bool(candidate.opening_hours),
                bool(candidate.website),
            )
        )
        / 6
    )
    candidate.scores = FoodScores(
        dietary_match=1 if confirmed else 0.5,
        cuisine_match=1 if cuisines & {c.casefold() for c in request.cuisine_preferences} else 0,
        distance=math.exp(-(candidate.distance_km or 0) / 3),
        category_preference=1 if candidate.category == request.categories[0] else 0.7,
        data_quality=quality,
    )
    candidate.recommendation_score = round(
        sum(
            getattr(candidate.scores, key) * weight
            for key, weight in active_weights(request).items()
        ),
        6,
    )
    candidate.labels = []
    if confirmed:
        candidate.labels.append("Diet-Friendly")
    if request.cuisine_preferences and candidate.scores.cuisine_match == 1:
        candidate.labels.append("Cuisine Match")
    if candidate.category == "cafe":
        candidate.labels.append("Cafe Pick")
    return candidate


def sort_candidates(
    candidates: list[FoodCandidate], order: str = "recommended"
) -> list[FoodCandidate]:
    def tie(c: FoodCandidate):
        return (c.name.casefold(), c.provider, c.provider_place_id)

    if order == "name":
        return sorted(candidates, key=tie)
    if order == "distance":
        return sorted(
            candidates,
            key=lambda c: (c.distance_km if c.distance_km is not None else math.inf, tie(c)),
        )
    return sorted(candidates, key=lambda c: (-c.recommendation_score, c.distance_km or 0, tie(c)))


def rank(candidates: list[FoodCandidate], request: FoodSearchRequest) -> list[FoodCandidate]:
    unique = {(c.provider, c.provider_place_id): c for c in candidates if eligible(c, request)}
    ranked = sort_candidates([score(c, request) for c in unique.values()])[: request.limit]
    if ranked:
        ranked[0].labels = ["Nomivra Pick", "Best Match", *ranked[0].labels]
        nearby = [c for c in ranked if c.scores.data_quality >= 0.5 and c.distance_km <= 1.5]
        if nearby:
            min(nearby, key=lambda c: (c.distance_km, c.provider_place_id)).labels.append(
                "Nearby Pick"
            )
    return ranked


class FoodRecommendationService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.geoapify = GeoapifyFoodProvider(settings, client)
        self.fixture = FixtureFoodProvider()
        # Reuse the existing bounded/coalescing cache; no new infrastructure.
        self.cache = AccommodationCache[FoodSearchResponse](
            settings.food_cache_ttl_seconds, settings.food_cache_max_entries
        )
        self.events: OrderedDict[str, list[float]] = OrderedDict()
        self.concurrent = asyncio.Semaphore(2)
        self.paused_until = 0.0
        self.paused_code = "FOOD_PROVIDER_UNAVAILABLE"

    async def search(self, request: FoodSearchRequest) -> FoodSearchResponse:
        source = "fixture" if request.demo else self.settings.food_provider
        if source == "fixture" and self.settings.app_env == "production":
            raise AppError("FOOD_CONFIGURATION_ERROR", MESSAGE, 503)
        request = request.model_copy(
            update={
                "radius_meters": request.radius_meters or self.settings.default_food_radius_meters
            }
        )
        key = (
            source,
            request.latitude,
            request.longitude,
            request.radius_meters,
            tuple(request.categories),
            tuple(sorted(set(request.dietary_preferences))),
            tuple(sorted({c.casefold() for c in request.cuisine_preferences})),
            request.strict_dietary,
            request.limit,
        )
        cached = self.cache.peek(key)
        if cached:
            return cached.model_copy(update={"cached": True})
        if request.cache_only:
            raise AppError("FOOD_CACHE_MISS", "No current food recommendations.", 404)

        async def load() -> FoodSearchResponse:
            now = time.monotonic()
            if source == "geoapify" and now < self.paused_until:
                raise AppError(
                    self.paused_code,
                    MESSAGE,
                    429 if self.paused_code == "FOOD_PROVIDER_RATE_LIMITED" else 503,
                )
            user = str(request.user_id)
            events = [t for t in self.events.get(user, []) if now - t < 60]
            if len(events) >= 6 or self.concurrent.locked():
                raise AppError("FOOD_RATE_LIMITED", "Please wait before searching again.", 429)
            self.events[user] = [*events, now]
            self.events.move_to_end(user)
            while len(self.events) > 1024:
                self.events.popitem(last=False)
            provider = self.fixture if source == "fixture" else self.geoapify
            async with self.concurrent:
                try:
                    async with asyncio.timeout(25):
                        candidates = await provider.search(request)
                        matched = [
                            c
                            for c in candidates
                            if eligible(c, request) and diet_matches(c, request.dietary_preferences)
                        ]
                        if (
                            request.dietary_preferences
                            and not request.strict_dietary
                            and len(matched) < min(5, request.limit)
                        ):
                            # At most one supplemental search, still <=40 results/request.
                            try:
                                general = await provider.search(
                                    request.model_copy(update={"dietary_preferences": []})
                                )
                                candidates.extend(general)
                            except AppError as exc:
                                if source == "geoapify" and exc.code in (
                                    "FOOD_PROVIDER_AUTH_ERROR",
                                    "FOOD_PROVIDER_RATE_LIMITED",
                                ):
                                    self.paused_until, self.paused_code = (
                                        time.monotonic() + 60,
                                        exc.code,
                                    )
                                if not candidates:
                                    raise
                except (AppError, TimeoutError) as exc:
                    if isinstance(exc, AppError):
                        if source == "geoapify" and exc.code in (
                            "FOOD_PROVIDER_AUTH_ERROR",
                            "FOOD_PROVIDER_RATE_LIMITED",
                        ):
                            self.paused_until, self.paused_code = time.monotonic() + 60, exc.code
                        raise
                    raise AppError("FOOD_PROVIDER_UNAVAILABLE", MESSAGE, 503) from None
            ranked = rank(candidates, request)
            instant = datetime.now(UTC)
            return FoodSearchResponse(
                provider=source,
                demo=source == "fixture",
                searched_at=instant.isoformat(),
                expires_at=(
                    instant + timedelta(seconds=self.settings.food_cache_ttl_seconds)
                ).isoformat(),
                radius_meters=request.radius_meters,
                dietary_fallback=any(c.dietary_match == "unknown" for c in ranked),
                candidates=ranked,
            )

        return await self.cache.load(key, load)
