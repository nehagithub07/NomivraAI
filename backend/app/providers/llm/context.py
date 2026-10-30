from app.schemas.itinerary import TripPlanningContext
from app.schemas.weather import WeatherPlanningContext
from app.services.itinerary_validation_service import CATEGORY_INTERESTS


def compact_planning_context(context: TripPlanningContext) -> dict:
    """Allowlist planner inputs; keep full trusted facts server-side for resolution."""
    interests = set(context.interests)
    payload = context.model_dump(
        mode="json",
        include={
            "destination_name",
            "dates",
            "travelers",
            "travel_pace",
            "interests",
            "max_attractions_per_day",
            "dietary_preferences",
            "accommodation_preferences",
            "special_requests",
            "budget",
            "proximity",
        },
        exclude_none=True,
    )
    payload["attractions"] = [
        {
            **item.model_dump(
                include={"candidate_id", "name", "category", "latitude", "longitude"}
            ),
            "interest_tags": sorted(CATEGORY_INTERESTS[item.category] & interests),
            "rank": rank,
        }
        for rank, item in enumerate(context.attractions, 1)
    ]
    payload["food"] = [
        {
            **item.model_dump(
                include={
                    "candidate_id",
                    "name",
                    "category",
                    "latitude",
                    "longitude",
                    "cuisine_types",
                    "dietary_tags",
                },
                exclude_none=True,
            ),
            "rank": rank,
        }
        for rank, item in enumerate(context.food, 1)
    ]
    if context.hotel:
        payload["hotel"] = context.hotel.model_dump(
            mode="json",
            include={"candidate_id", "name", "latitude", "longitude"},
            exclude_none=True,
        )
    if isinstance(context, WeatherPlanningContext):
        # Preserve the verified facts and original IDs needed for conservative adaptation.
        payload.update(
            context.model_dump(
                mode="json",
                include={
                    "original",
                    "verified_weather",
                    "conflicts",
                    "candidate_settings",
                    "slot_scores",
                },
                exclude_none=True,
            )
        )
    return payload
