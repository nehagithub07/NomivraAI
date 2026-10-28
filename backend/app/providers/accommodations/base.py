from abc import ABC, abstractmethod

from app.schemas.accommodation import AccommodationCandidate, AccommodationSearchRequest


class AccommodationProvider(ABC):
    @abstractmethod
    async def search(self, request: AccommodationSearchRequest) -> list[AccommodationCandidate]:
        """Return normalized inventory. Selection never creates a booking."""
