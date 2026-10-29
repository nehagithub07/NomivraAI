from abc import ABC, abstractmethod

from app.schemas.food import FoodCandidate, FoodSearchRequest


class FoodProvider(ABC):
    @abstractmethod
    async def search(self, request: FoodSearchRequest) -> list[FoodCandidate]: ...
