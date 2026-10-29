from app.schemas.itinerary import (
    GeneratedItinerary,
    ItineraryDocument,
    ResolvedDay,
    ResolvedItem,
    TripPlanningContext,
)

PERIOD_ORDER = {"morning": 0, "afternoon": 1, "evening": 2}
REASONS = {
    "interest_match": "Chosen to reflect your stated interests.",
    "area_grouping": "Grouped with this day's other planned stops.",
    "pace_balance": "Scheduled within your selected travel pace.",
    "food_option": "A saved food option. Confirm dietary suitability before visiting.",
    "selected_stay": "Your selected accommodation reference.",
    "free_time": "Unscheduled time to rest or make your own arrangements.",
}
CATEGORY_INTERESTS = {
    "attraction": {"culture", "adventure", "photography", "local_experiences"},
    "museum": {"culture", "history", "art"},
    "historic": {"history", "culture", "photography"},
    "monument": {"history", "culture", "photography"},
    "park": {"nature", "relaxation", "photography"},
    "viewpoint": {"nature", "photography"},
    "gallery": {"art", "culture"},
    "arts_centre": {"art", "culture"},
}


def semantic_errors(plan: GeneratedItinerary, context: TripPlanningContext) -> list[str]:
    errors = []
    attractions = {item.candidate_id: item for item in context.attractions}
    food = {item.candidate_id: item for item in context.food}
    if [day.date for day in plan.days] != context.dates:
        errors.append("dates_must_exactly_match_trip_in_order")
    seen = set()
    for i, day in enumerate(plan.days):
        if day.day_number != i + 1:
            errors.append("day_numbers_must_be_consecutive")
        if [PERIOD_ORDER[item.period] for item in day.items] != sorted(
            PERIOD_ORDER[item.period] for item in day.items
        ):
            errors.append("periods_must_be_ordered")
        kinds = [item.candidate_type for item in day.items]
        if kinds.count("attraction") > context.max_attractions_per_day:
            errors.append("daily_attraction_capacity_exceeded")
        if kinds.count("food") > 2 or kinds.count("hotel") > 1:
            errors.append("daily_food_or_hotel_capacity_exceeded")
        daily_food = set()
        for item in day.items:
            if item.candidate_type == "attraction":
                if item.candidate_id not in attractions:
                    errors.append("unknown_attraction_id")
                elif item.reason_code == "interest_match" and not CATEGORY_INTERESTS[
                    attractions[item.candidate_id].category
                ].intersection(context.interests):
                    errors.append("interest_reason_not_supported")
                if item.candidate_id in seen:
                    errors.append("duplicate_attraction")
                seen.add(item.candidate_id)
                if item.reason_code not in ("interest_match", "area_grouping", "pace_balance"):
                    errors.append("invalid_attraction_reason")
            elif item.candidate_type == "food":
                if item.candidate_id not in food:
                    errors.append("unknown_food_id")
                if item.candidate_id in daily_food:
                    errors.append("duplicate_daily_food")
                daily_food.add(item.candidate_id)
                if item.reason_code != "food_option":
                    errors.append("invalid_food_reason")
            elif item.candidate_type == "hotel":
                if not context.hotel or item.candidate_id != str(context.hotel.candidate_id):
                    errors.append("hotel_must_match_selected_accommodation")
                if item.reason_code != "selected_stay":
                    errors.append("invalid_hotel_reason")
            elif item.candidate_id is not None or item.reason_code != "free_time":
                errors.append("free_time_must_not_reference_a_place")
    if not seen.intersection(attractions):
        errors.append("plan_must_include_a_supplied_attraction")
    return sorted(set(errors))


def resolve_itinerary(plan: GeneratedItinerary, context: TripPlanningContext) -> ItineraryDocument:
    attractions = {item.candidate_id: item for item in context.attractions}
    food = {item.candidate_id: item for item in context.food}
    days = []
    for day in plan.days:
        items = []
        for item in day.items:
            kind = item.candidate_type
            source = (
                attractions[item.candidate_id]
                if kind == "attraction"
                else food[item.candidate_id]
                if kind == "food"
                else None
            )
            items.append(
                ResolvedItem(
                    candidate_type=kind,
                    candidate_id=item.candidate_id,
                    candidate_provider={
                        "attraction": "openstreetmap",
                        "food": "geoapify",
                        "hotel": "stayapi",
                        "free_time": None,
                    }[kind],
                    period=item.period,
                    title=source.name
                    if source
                    else "Selected accommodation"
                    if kind == "hotel"
                    else "Free time",
                    reason=REASONS[item.reason_code],
                    notes="Confirm opening hours before visiting."
                    if kind == "attraction"
                    else None,
                    category=source.category if source else None,
                    # Preserve retention: only OSM facts and saved food names/categories persist.
                    latitude=source.latitude if kind == "attraction" else None,
                    longitude=source.longitude if kind == "attraction" else None,
                    opening_hours=source.opening_hours if kind == "attraction" else None,
                )
            )
        days.append(
            ResolvedDay(
                date=day.date,
                day_number=day.day_number,
                theme=day.theme.replace("_", " ").capitalize(),
                items=items,
            )
        )
    return ItineraryDocument(
        title=f"Your {context.destination_name} itinerary",
        summary=f"A {len(days)}-day plan using your saved places and {context.travel_pace} pace.",
        days=days,
        warnings=context.warnings,
    )
