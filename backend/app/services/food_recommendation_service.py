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
from app.providers.food.google_maps_enrichment import (
    GoogleMapsFoodEnricher,
)
from app.schemas.food import (
    FoodCandidate,
    FoodScores,
    FoodSearchRequest,
    FoodSearchResponse,
)
from app.services.food_policy import (
    WEIGHTS,
    diet_matches,
    distance_km,
)


def active_weights(
    request: FoodSearchRequest,
) -> dict[str, float]:
    weights = dict(WEIGHTS)

    if not request.dietary_preferences:
        weights.pop(
            "dietary_match",
            None,
        )

    if not request.cuisine_preferences:
        weights.pop(
            "cuisine_match",
            None,
        )

    total = sum(weights.values())

    if total <= 0:
        return {}

    return {key: value / total for key, value in weights.items()}


def eligible(
    candidate: FoodCandidate,
    request: FoodSearchRequest,
) -> bool:
    if not candidate.name.strip() or candidate.category not in request.categories:
        return False

    distance = distance_km(
        request.latitude,
        request.longitude,
        candidate.latitude,
        candidate.longitude,
    )

    candidate.distance_km = round(
        distance,
        4,
    )

    if distance * 1000 > request.radius_meters:
        return False

    # Live Geoapify candidates must have a
    # verified Google Maps rating >= 4.
    if candidate.provider != "fixture":
        if (
            candidate.rating_source != "google_maps"
            or candidate.rating is None
            or candidate.rating_scale != 5.0
            or candidate.rating < 4.0
            or candidate.rating > 5.0
        ):
            return False

    # Explicit negative dietary metadata
    # conflicts are excluded.
    if set(candidate.dietary_conflicts) & set(request.dietary_preferences):
        return False

    if request.strict_dietary:
        return diet_matches(
            candidate,
            request.dietary_preferences,
        )

    return True


def score(
    candidate: FoodCandidate,
    request: FoodSearchRequest,
) -> FoodCandidate:
    confirmed = bool(request.dietary_preferences) and diet_matches(
        candidate,
        request.dietary_preferences,
    )

    candidate.dietary_match = (
        "confirmed"
        if confirmed
        else ("unknown" if request.dietary_preferences else "not_requested")
    )

    cuisines = {cuisine.casefold() for cuisine in candidate.cuisine_types}

    requested_cuisines = {cuisine.casefold() for cuisine in request.cuisine_preferences}

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
        dietary_match=(1.0 if confirmed else 0.5),
        cuisine_match=(1.0 if (requested_cuisines and cuisines & requested_cuisines) else 0.0),
        distance=math.exp(-(candidate.distance_km or 0) / 3),
        category_preference=(
            1.0 if (request.categories and candidate.category == request.categories[0]) else 0.7
        ),
        data_quality=quality,
    )

    weights = active_weights(request)

    base_score = sum(
        getattr(
            candidate.scores,
            key,
        )
        * weight
        for key, weight in weights.items()
    )

    rating_quality = 0.0

    if candidate.rating is not None and candidate.rating_scale:
        rating_quality = min(
            1.0,
            max(
                0.0,
                candidate.rating / candidate.rating_scale,
            ),
        )

    review_confidence = min(
        1.0,
        math.log1p(candidate.review_count or 0) / math.log1p(1000),
    )

    popularity = 0.0

    if candidate.popularity_rank is not None and candidate.popularity_rank >= 1:
        popularity = 1.0 / (1.0 + (candidate.popularity_rank - 1) / 10)

    if candidate.rating_source == "google_maps":
        final_score = (
            0.60 * base_score + 0.25 * rating_quality + 0.10 * review_confidence + 0.05 * popularity
        )
    else:
        final_score = base_score

    candidate.recommendation_score = round(
        final_score,
        6,
    )

    candidate.labels = []

    if confirmed:
        candidate.labels.append("Diet-Friendly")

    if request.cuisine_preferences and candidate.scores.cuisine_match == 1:
        candidate.labels.append("Cuisine Match")

    if candidate.category == "cafe":
        candidate.labels.append("Cafe Pick")

    if (
        candidate.rating_source == "google_maps"
        and candidate.rating is not None
        and candidate.rating >= 4.5
    ):
        candidate.labels.append("Highly Rated")

    return candidate


def sort_candidates(
    candidates: list[FoodCandidate],
    order: str = "recommended",
) -> list[FoodCandidate]:
    def tie(
        candidate: FoodCandidate,
    ):
        return (
            candidate.name.casefold(),
            candidate.provider,
            candidate.provider_place_id,
        )

    if order == "name":
        return sorted(
            candidates,
            key=tie,
        )

    if order == "distance":
        return sorted(
            candidates,
            key=lambda candidate: (
                (candidate.distance_km if candidate.distance_km is not None else math.inf),
                tie(candidate),
            ),
        )

    return sorted(
        candidates,
        key=lambda candidate: (
            -candidate.recommendation_score,
            (-candidate.rating if candidate.rating is not None else 0),
            -(candidate.review_count or 0),
            (candidate.distance_km if candidate.distance_km is not None else math.inf),
            tie(candidate),
        ),
    )


def rank(
    candidates: list[FoodCandidate],
    request: FoodSearchRequest,
) -> list[FoodCandidate]:
    unique = {
        (
            candidate.provider,
            candidate.provider_place_id,
        ): candidate
        for candidate in candidates
        if eligible(
            candidate,
            request,
        )
    }

    scored = [
        score(
            candidate,
            request,
        )
        for candidate in unique.values()
    ]

    ranked = sort_candidates(scored)[: request.limit]

    if not ranked:
        return []

    # Main overall recommendation.
    ranked[0].labels = [
        "Nomivra Pick",
        "Best Match",
        *ranked[0].labels,
    ]

    # First highly-ranked local options.
    for candidate in ranked[:3]:
        if candidate.rating_source == "google_maps" and "Local Food Pick" not in candidate.labels:
            candidate.labels.append("Local Food Pick")

    nearby = [
        candidate
        for candidate in ranked
        if (
            candidate.scores.data_quality >= 0.5
            and candidate.distance_km is not None
            and candidate.distance_km <= 1.5
        )
    ]

    if nearby:
        nearest = min(
            nearby,
            key=lambda candidate: (
                candidate.distance_km if candidate.distance_km is not None else math.inf,
                candidate.provider_place_id,
            ),
        )

        if "Nearby Pick" not in nearest.labels:
            nearest.labels.append("Nearby Pick")

    return ranked


class FoodRecommendationService:
    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient,
    ):
        self.settings = settings

        self.geoapify = GeoapifyFoodProvider(
            settings,
            client,
        )

        self.google_maps = GoogleMapsFoodEnricher(
            settings,
            client,
        )

        self.fixture = FixtureFoodProvider()

        self.cache = AccommodationCache[FoodSearchResponse](
            settings.food_cache_ttl_seconds,
            settings.food_cache_max_entries,
        )

        self.events: OrderedDict[
            str,
            list[float],
        ] = OrderedDict()

        self.concurrent = asyncio.Semaphore(2)

        self.paused_until = 0.0

        self.paused_code = "FOOD_PROVIDER_UNAVAILABLE"

    def pause_provider(
        self,
        code: str,
        seconds: int = 60,
    ) -> None:
        if code not in {
            "FOOD_PROVIDER_AUTH_ERROR",
            "FOOD_PROVIDER_RATE_LIMITED",
        }:
            return

        self.paused_until = time.monotonic() + seconds

        self.paused_code = code

    async def load_candidates(
        self,
        provider,
        source: str,
        request: FoodSearchRequest,
    ) -> list[FoodCandidate]:
        candidates = await provider.search(request)

        # Critical:
        # rating enrichment must happen BEFORE
        # eligibility/ranking removes unrated
        # Geoapify results.
        if source == "geoapify":
            candidates = await self.google_maps.enrich(
                candidates,
                request,
            )

        return candidates

    async def search(
        self,
        request: FoodSearchRequest,
    ) -> FoodSearchResponse:
        source = "fixture" if request.demo else self.settings.food_provider

        if source == "fixture" and self.settings.app_env == "production":
            raise AppError(
                "FOOD_CONFIGURATION_ERROR",
                MESSAGE,
                503,
            )

        request = request.model_copy(
            update={
                "radius_meters": request.radius_meters or self.settings.default_food_radius_meters,
            }
        )

        key = (
            source,
            request.latitude,
            request.longitude,
            getattr(
                request,
                "destination_name",
                "",
            ),
            request.radius_meters,
            tuple(request.categories),
            tuple(sorted(set(request.dietary_preferences))),
            tuple(sorted({cuisine.casefold() for cuisine in request.cuisine_preferences})),
            request.strict_dietary,
            request.limit,
        )

        cached = self.cache.peek(key)

        if cached:
            return cached.model_copy(
                update={
                    "cached": True,
                }
            )

        if request.cache_only:
            raise AppError(
                "FOOD_CACHE_MISS",
                "No current food recommendations.",
                404,
            )

        async def load() -> FoodSearchResponse:
            now = time.monotonic()

            if source != "fixture" and now < self.paused_until:
                raise AppError(
                    self.paused_code,
                    MESSAGE,
                    (429 if self.paused_code == "FOOD_PROVIDER_RATE_LIMITED" else 503),
                )

            user = str(request.user_id)

            events = [
                timestamp
                for timestamp in self.events.get(
                    user,
                    [],
                )
                if (now - timestamp < 60)
            ]

            if len(events) >= 6 or self.concurrent.locked():
                raise AppError(
                    "FOOD_RATE_LIMITED",
                    "Please wait before searching again.",
                    429,
                )

            self.events[user] = [
                *events,
                now,
            ]

            self.events.move_to_end(user)

            while len(self.events) > 1024:
                self.events.popitem(last=False)

            provider = (
                self.fixture
                if source == "fixture"
                else self.google_maps
                if source == "google_maps"
                else self.geoapify
            )

            async with self.concurrent:
                try:
                    async with asyncio.timeout(40):
                        candidates = await self.load_candidates(
                            provider,
                            source,
                            request,
                        )

                        # Dietary matching is evaluated
                        # after live rating enrichment.
                        matched = [
                            candidate
                            for candidate in candidates
                            if (
                                eligible(
                                    candidate,
                                    request,
                                )
                                and diet_matches(
                                    candidate,
                                    request.dietary_preferences,
                                )
                            )
                        ]

                        # At most one supplemental search.
                        if (
                            request.dietary_preferences
                            and not request.strict_dietary
                            and len(matched)
                            < min(
                                5,
                                request.limit,
                            )
                        ):
                            try:
                                relaxed_request = request.model_copy(
                                    update={
                                        "dietary_preferences": [],
                                    }
                                )

                                general = await self.load_candidates(
                                    provider,
                                    source,
                                    relaxed_request,
                                )

                                candidates.extend(general)

                            except AppError as exc:
                                if source != "fixture":
                                    self.pause_provider(exc.code)

                                # Preserve original candidates
                                # when the supplemental query
                                # alone fails.
                                if not candidates:
                                    raise

                except AppError as exc:
                    if source != "fixture":
                        self.pause_provider(exc.code)

                    raise

                except TimeoutError:
                    raise AppError(
                        "FOOD_PROVIDER_UNAVAILABLE",
                        MESSAGE,
                        503,
                    ) from None

            ranked = rank(
                candidates,
                request,
            )

            instant = datetime.now(UTC)

            return FoodSearchResponse(
                provider=source,
                demo=(source == "fixture"),
                searched_at=instant.isoformat(),
                expires_at=(
                    instant + timedelta(seconds=self.settings.food_cache_ttl_seconds)
                ).isoformat(),
                radius_meters=request.radius_meters,
                dietary_fallback=any(candidate.dietary_match == "unknown" for candidate in ranked),
                candidates=ranked,
            )

        return await self.cache.load(
            key,
            load,
        )
