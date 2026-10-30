from datetime import UTC, datetime, timedelta
from itertools import combinations

from app.core.errors import AppError
from app.providers.places.overpass import haversine_km
from app.schemas.itinerary import BudgetSummary, PlanningInput, Proximity, TripPlanningContext
from app.services.itinerary_validation_service import CATEGORY_INTERESTS

DAILY_CAPACITY = {"relaxed": 2, "balanced": 3, "packed": 4}
MAX_TRIP_DAYS = 14
MAX_ATTRACTIONS = 20
MAX_FOOD = 12
MAX_PROXIMITY_PAIRS = 30


def build_planning_context(
    source: PlanningInput, *, trim_candidates: bool = True
) -> TripPlanningContext:
    count = (source.end_date - source.start_date).days + 1
    if not 1 <= count <= MAX_TRIP_DAYS:
        raise AppError("ITINERARY_INVALID_TRIP", "AI planning supports trips of 1–14 days.", 422)
    if not source.attractions:
        raise AppError(
            "ITINERARY_MISSING_PLACES", "Discover places before generating your itinerary.", 409
        )
    if len({item.candidate_id for item in source.attractions}) != len(source.attractions):
        raise AppError("ITINERARY_INVALID_CONTEXT", "Refresh your saved places and try again.", 422)
    if len({item.candidate_id for item in source.food}) != len(source.food):
        raise AppError(
            "ITINERARY_INVALID_CONTEXT", "Refresh your saved food spots and try again.", 422
        )
    food = [
        item
        for item in source.food
        if not set(item.dietary_conflicts).intersection(source.dietary_preferences)
    ]
    excluded_food = len(food) != len(source.food)
    attractions = source.attractions
    if trim_candidates:
        required = count * DAILY_CAPACITY[source.travel_pace]
        interests = set(source.interests)
        # Keep the discovery distance/ID ordering within each interest match tier.
        attractions = sorted(
            attractions,
            key=lambda item: (
                -len(CATEGORY_INTERESTS[item.category] & interests),
                item.distance_km,
                item.candidate_id,
            ),
        )[: min(MAX_ATTRACTIONS, max(10, required + 5))]
        food = sorted(
            food,
            key=lambda item: (
                -(item.recommendation_score or 0),
                item.distance_km if item.distance_km is not None else float("inf"),
                item.name.casefold(),
                item.candidate_id,
            ),
        )[: min(MAX_FOOD, max(10, count * 2 + 2))]
    warnings = [
        "Opening hours have not been verified for the planned dates. Confirm before visiting.",
        "Attraction and meal costs are unknown. This is not a fully priced itinerary.",
        "Proximity uses straight-line distance, not walking or driving time.",
    ]
    if len(attractions) < count * DAILY_CAPACITY[source.travel_pace]:
        warnings.append(
            "There are fewer selected attractions than daily activity slots; "
            "some periods may remain unscheduled."
        )
    if not food:
        warnings.append(
            "Restaurant recommendations have not been added yet. Save food spots to include them."
        )
    elif source.dietary_preferences:
        warnings.append(
            "Confirm dietary suitability with each food venue; missing metadata is unknown."
        )
    if excluded_food:
        warnings.append("Food spots with explicit dietary conflicts were excluded.")
    known = None
    hotel = source.hotel
    if hotel is None:
        warnings.append(
            "No current hotel selection is included; no accommodation has been invented."
        )
    elif hotel.name is None:
        warnings.append(
            "Selected hotel details are unavailable. Refresh Hotels for current details and prices."
        )
    if hotel and hotel.total_price is not None:
        expiry = hotel.quote_expires_at
        if (
            hotel.currency == source.currency
            and expiry
            and expiry.tzinfo
            and expiry > datetime.now(UTC)
        ):
            known = hotel.total_price
            if known > source.budget_total:
                warnings.append("The known accommodation quote exceeds the trip budget.")
        else:
            warnings.append(
                "The hotel quote is expired or uses another currency; remaining budget is unknown."
            )
    budget = BudgetSummary(
        currency=source.currency,
        trip_budget=f"{source.budget_total:.2f}",
        known_accommodation_total=f"{known:.2f}" if known is not None else None,
        remaining_known_budget=f"{source.budget_total - known:.2f}" if known is not None else None,
    )
    pairs = sorted(
        (
            Proximity(
                first_id=a.candidate_id,
                second_id=b.candidate_id,
                straight_line_km=round(
                    haversine_km(a.latitude, a.longitude, b.latitude, b.longitude), 3
                ),
            )
            for a, b in combinations(attractions, 2)
        ),
        key=lambda pair: (pair.straight_line_km, pair.first_id, pair.second_id),
    )[:MAX_PROXIMITY_PAIRS]
    return TripPlanningContext(
        **{**source.model_dump(), "attractions": attractions, "food": food},
        dates=[source.start_date + timedelta(days=i) for i in range(count)],
        max_attractions_per_day=DAILY_CAPACITY[source.travel_pace],
        budget=budget,
        proximity=pairs,
        warnings=warnings,
    )
