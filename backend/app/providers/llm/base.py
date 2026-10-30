from abc import ABC, abstractmethod

from app.schemas.itinerary import GeneratedItinerary, TripPlanningContext


class LLMProvider(ABC):
    async def chat(self, contents: list, declarations: list[dict]):
        """Return one model Content. Application code executes every function call."""
        raise NotImplementedError

    @abstractmethod
    async def generate_itinerary(
        self,
        context: TripPlanningContext,
        *,
        previous: GeneratedItinerary | None = None,
        validation_errors: list[str] | None = None,
    ) -> GeneratedItinerary:
        """Plan with supplied IDs; optional feedback permits exactly one service-owned repair."""
