from abc import ABC, abstractmethod

from app.schemas.routing import (
    MatrixRequest,
    MatrixResult,
    RouteRequest,
    RouteResult,
)


class RoutingProvider(ABC):
    @abstractmethod
    async def route(self, request: RouteRequest) -> RouteResult:
        ...

    @abstractmethod
    async def matrix(self, request: MatrixRequest) -> MatrixResult:
        ...