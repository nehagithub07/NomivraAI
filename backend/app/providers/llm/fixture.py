from app.providers.llm.base import LLMProvider
from app.schemas.itinerary import (
    GeneratedItinerary,
    ItineraryDay,
    ItineraryItem,
    TripPlanningContext,
)


class FixtureLLMProvider(LLMProvider):
    """Development-only planner. Uses supplied real IDs; creates no provider data."""

    async def generate_itinerary(
        self, context: TripPlanningContext, **_kwargs
    ) -> GeneratedItinerary:
        if hasattr(context, "original"):
            return context.original.model_copy(deep=True)
        pool = iter(
            sorted(
                context.attractions,
                key=lambda item: (item.latitude, item.longitude, item.candidate_id),
            )
        )
        days = []
        for i, day in enumerate(context.dates):
            items = []
            for slot in range(context.max_attractions_per_day):
                candidate = next(pool, None)
                if candidate:
                    items.append(
                        ItineraryItem(
                            candidate_type="attraction",
                            candidate_id=candidate.candidate_id,
                            period="morning" if slot == 0 else "afternoon",
                            reason_code="pace_balance",
                        )
                    )
            if context.food:
                items.append(
                    ItineraryItem(
                        candidate_type="food",
                        candidate_id=context.food[i % len(context.food)].candidate_id,
                        period="evening",
                        reason_code="food_option",
                    )
                )
            else:
                items.append(
                    ItineraryItem(
                        candidate_type="free_time",
                        candidate_id=None,
                        period="evening",
                        reason_code="free_time",
                    )
                )
            days.append(ItineraryDay(date=day, day_number=i + 1, theme="mixed", items=items))
        return GeneratedItinerary(days=days, warnings=[])
