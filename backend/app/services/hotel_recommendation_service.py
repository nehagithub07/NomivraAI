import asyncio
import math
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx

from app.core.accommodation_cache import AccommodationCache
from app.core.config import Settings
from app.core.errors import AppError
from app.providers.accommodations.fixture import FixtureAccommodationProvider
from app.providers.accommodations.stayapi import StayApiAccommodationProvider
from app.schemas.accommodation import (
    AccommodationCandidate,
    AccommodationInventory,
    AccommodationSearchRequest,
    AccommodationSearchResponse,
    RankedAccommodation,
    ScoreComponents,
    SortOrder,
)
from app.services.hotel_policy import (
    BUDGET_ALLOCATION,
    BUDGET_TOLERANCE,
    MAX_DISTANCE_KM,
    MIN_GUEST_QUALITY,
    REVIEW_CONFIDENCE_TARGET,
    REVIEW_PRIOR,
    WEIGHTS,
)


def rating(candidate: AccommodationCandidate) -> float | None:
    if candidate.guest_rating is None or candidate.guest_rating_scale is None:
        return None
    return candidate.guest_rating / candidate.guest_rating_scale


def review_confidence(count: int | None) -> float:
    return min(1.0, math.log1p(count or 0) / math.log1p(REVIEW_CONFIDENCE_TARGET))


def stay_budget(request: AccommodationSearchRequest) -> Decimal:
    return (request.trip_budget * BUDGET_ALLOCATION[request.budget_style]).quantize(Decimal(".01"))


def comparable(candidate: AccommodationCandidate, request: AccommodationSearchRequest) -> bool:
    return candidate.currency == request.currency and candidate.total_price is not None


def premium_eligible(candidate: AccommodationCandidate) -> bool:
    return (
        (candidate.star_rating or 0) >= 4
        and (rating(candidate) or 0) >= 0.80
        and review_confidence(candidate.review_count) >= 0.4
        and candidate.distance_km is not None
        and candidate.distance_km <= 15
    )


def eligible(candidate: AccommodationCandidate, request: AccommodationSearchRequest) -> bool:
    if candidate.available is False:
        return False
    if candidate.star_rating is not None and not 3 <= candidate.star_rating <= 5:
        return False
    if rating(candidate) is not None and rating(candidate) < MIN_GUEST_QUALITY:
        return False
    if (
        request.accommodation_preferences
        and candidate.accommodation_type
        and candidate.accommodation_type not in request.accommodation_preferences
    ):
        return False
    if candidate.distance_km is not None and candidate.distance_km > MAX_DISTANCE_KM:
        return False
    target = stay_budget(request)
    if (
        target > 0
        and comparable(candidate, request)
        and candidate.total_price > target * BUDGET_TOLERANCE
        and not premium_eligible(candidate)
    ):
        return False
    return True


def score(
    candidate: AccommodationCandidate, request: AccommodationSearchRequest
) -> RankedAccommodation:
    target, actual = stay_budget(request), candidate.total_price
    known_price = comparable(candidate, request)
    budget_fit = 0.5
    if known_price and target > 0:
        budget_fit = float(min(Decimal(1), target / actual)) if actual else 1.0
    raw_rating = rating(candidate)
    confidence = review_confidence(candidate.review_count)
    guest_quality = (
        REVIEW_PRIOR + (raw_rating - REVIEW_PRIOR) * confidence if raw_rating is not None else 0.45
    )
    location = 1 / (1 + candidate.distance_km / 5) if candidate.distance_km is not None else 0.4
    preference = (
        1.0
        if not request.accommodation_preferences
        or candidate.accommodation_type in request.accommodation_preferences
        else 0.5
    )
    property_quality = (
        candidate.star_rating / 5 if candidate.star_rating is not None else guest_quality
    )
    signals = ScoreComponents(
        budget_fit=budget_fit,
        guest_quality=guest_quality,
        location=location,
        preference=preference,
        property_quality=property_quality,
        review_confidence=confidence,
    )
    total = sum(getattr(signals, key) * weight for key, weight in WEIGHTS.items())
    return RankedAccommodation(
        **candidate.model_dump(),
        scores=signals,
        recommendation_score=round(total, 6),
        labels=[],
        comparable_price=known_price,
        within_stay_budget=actual <= target if known_price and target > 0 else None,
    )


def sort_candidates(candidates: list[RankedAccommodation], order: SortOrder):
    def key(candidate):
        tie = (candidate.provider, candidate.provider_accommodation_id)
        if order in {"price_asc", "price_desc"}:
            known = candidate.comparable_price
            value = candidate.total_price if known else Decimal(0)
            return (not known, -value if order == "price_desc" else value, *tie)
        if order == "guest_rating":
            return (
                rating(candidate) is None,
                -(rating(candidate) or 0),
                -candidate.scores.review_confidence,
                *tie,
            )
        if order == "distance":
            return (candidate.distance_km is None, candidate.distance_km or 0, *tie)
        return (-candidate.recommendation_score, *tie)

    return sorted(candidates, key=key)


def rank(candidates: list[AccommodationCandidate], request: AccommodationSearchRequest):
    ranked = sort_candidates(
        [score(c, request) for c in candidates if eligible(c, request)], "recommended"
    )
    if not ranked:
        return ranked
    ranked[0].labels.append("Best Match")

    def badge(label, pool, metric):
        if pool:
            # Stable tie order even when provider output order changes.
            best = max(
                sorted(pool, key=lambda c: (c.provider, c.provider_accommodation_id)), key=metric
            )
            best.labels.append(label)

    priced = [
        c
        for c in ranked
        if c.comparable_price
        and (rating(c) or 0) >= 0.7
        and c.scores.review_confidence >= 0.15
        and c.distance_km is not None
        and c.distance_km <= 10
    ]
    reference = stay_budget(request)
    if reference <= 0 and priced:
        reference = sorted(c.total_price for c in priced)[len(priced) // 2]
    badge(
        "Best Value",
        priced,
        lambda c: (
            0.50 * c.scores.guest_quality
            + 0.20 * c.scores.review_confidence
            + 0.15 * c.scores.location
            + 0.15 * float(reference / (reference + c.total_price))
            if reference + c.total_price > 0
            else 0
        ),
    )
    badge(
        "Budget Friendly",
        [c for c in priced if c.within_stay_budget is not False],
        lambda c: -c.total_price,
    )
    badge(
        "Best Rated", [c for c in ranked if rating(c) is not None], lambda c: c.scores.guest_quality
    )
    badge(
        "Premium",
        [c for c in ranked if premium_eligible(c)],
        lambda c: (
            0.4 * c.scores.property_quality + 0.4 * c.scores.guest_quality + 0.2 * c.scores.location
        ),
    )
    return ranked


class HotelRecommendationService:
    def __init__(self, settings: Settings, http: httpx.AsyncClient):
        self.settings = settings
        self.provider = (
            FixtureAccommodationProvider()
            if settings.accommodation_provider == "fixture"
            else StayApiAccommodationProvider(http, settings)
        )
        self.cache = AccommodationCache[AccommodationInventory](
            settings.accommodation_cache_ttl_seconds, settings.accommodation_cache_max_entries
        )
        self.active = 0
        self.events: dict[str, list[float]] = {}
        self.last_refresh: dict[tuple, float] = {}
        self.provider_cooldown: tuple[float, AppError] | None = None

    async def search(self, request: AccommodationSearchRequest) -> AccommodationSearchResponse:
        settings = self.settings
        mode = "fixture" if request.demo else settings.accommodation_provider
        if mode == "fixture" and (
            settings.app_env == "production" or not settings.allow_demo_accommodations
        ):
            raise AppError(
                "ACCOMMODATION_CONFIGURATION_ERROR",
                "Demo accommodation search is disabled in this environment.",
                503,
            )
        key = request.inventory_key(mode)
        cached = self.cache.peek(key)
        if request.cache_only and cached is None:
            raise AppError("ACCOMMODATION_CACHE_MISS", "No current hotel recommendations.", 404)
        if request.refresh:
            now = time.monotonic()
            # Expired keys are removed too, keeping refresh metadata bounded.
            self.last_refresh = {k: v for k, v in self.last_refresh.items() if now - v < 30}
            if key in self.last_refresh:
                raise AppError(
                    "ACCOMMODATION_RATE_LIMITED", "Wait before refreshing hotels again.", 429
                )
            self.last_refresh[key] = now
            self.cache.remove(key)
            cached = None

        async def load():
            if (
                mode != "fixture"
                and self.provider_cooldown
                and self.provider_cooldown[0] > time.monotonic()
            ):
                raise self.provider_cooldown[1]
            now = time.monotonic()
            self.events = {
                owner: [instant for instant in events if now - instant < 60]
                for owner, events in self.events.items()
                if events and now - events[-1] < 60
            }
            owner = str(request.user_id)
            events = self.events.setdefault(owner, [])
            if len(events) >= 6 or self.active >= 2:
                raise AppError(
                    "ACCOMMODATION_RATE_LIMITED", "Wait before searching hotels again.", 429
                )
            events.append(now)
            self.active += 1
            try:
                async with asyncio.timeout(35):
                    provider = (
                        FixtureAccommodationProvider() if mode == "fixture" else self.provider
                    )
                    candidates = await provider.search(request)
            except TimeoutError:
                raise AppError(
                    "ACCOMMODATION_PROVIDER_UNAVAILABLE",
                    "Live hotel pricing is temporarily unavailable.",
                    503,
                ) from None
            except AppError as error:
                if error.code in {
                    "ACCOMMODATION_PROVIDER_QUOTA_EXCEEDED",
                    "ACCOMMODATION_PROVIDER_AUTH_ERROR",
                }:
                    self.provider_cooldown = (time.monotonic() + 60, error)
                raise
            finally:
                self.active -= 1
            now = datetime.now(UTC)
            return AccommodationInventory(
                provider=mode,
                demo=mode == "fixture",
                searched_at=now,
                expires_at=now + timedelta(seconds=settings.accommodation_cache_ttl_seconds),
                candidates=candidates,
            )

        inventory = cached if cached is not None else await self.cache.load(key, load)
        return AccommodationSearchResponse(
            provider=inventory.provider,
            demo=inventory.demo,
            cached=cached is not None,
            searched_at=inventory.searched_at,
            expires_at=inventory.expires_at,
            hotel_nights=request.nights,
            rooms=request.rooms,
            stay_budget=stay_budget(request),
            currency=request.currency,
            candidates=rank(inventory.candidates, request),
            returned_before_filters=len(inventory.candidates),
            attribution="Demo accommodation data — fictional properties, prices and reviews."
            if inventory.demo
            else "Hotel data via StayAPI · Booking.com source. Quotes may exclude local charges.",
        )
