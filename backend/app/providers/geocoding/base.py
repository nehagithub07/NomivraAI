from abc import ABC, abstractmethod

from app.schemas.destination import DestinationCandidate


class GeocodingProvider(ABC):
    @abstractmethod
    async def search(
        self, query: str, limit: int, language: str, country_code: str | None = None
    ) -> list[DestinationCandidate]: ...

    @abstractmethod
    async def resolve(self, provider_id: str, language: str = "en") -> DestinationCandidate: ...
