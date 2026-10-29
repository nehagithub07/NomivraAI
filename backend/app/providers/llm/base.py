from abc import ABC, abstractmethod

from app.schemas.itinerary import GeneratedItinerary, TripPlanningContext


class LLMProvider(ABC):
    @abstractmethod
    async def generate_itinerary(
        self,
        context: TripPlanningContext,
        *,
        previous: GeneratedItinerary | None = None,
        validation_errors: list[str] | None = None,
    ) -> GeneratedItinerary:
        """Plan with supplied IDs; optional feedback permits exactly one service-owned repair."""
