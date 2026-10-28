from abc import ABC, abstractmethod

from app.schemas.place import PlaceCandidate


class PlacesProvider(ABC):
    @abstractmethod
    async def discover_nearby(
        self, latitude: float, longitude: float, radius_meters: int, limit: int
    ) -> list[PlaceCandidate]: ...
