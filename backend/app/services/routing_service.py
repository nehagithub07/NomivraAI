import json
import time

from app.providers.routing.base import RoutingProvider
from app.schemas.routing import (
    MatrixRequest,
    MatrixResult,
    RouteRequest,
    RouteResult,
)


WALKING_LONG_TRANSFER = 45 * 60
DRIVING_LONG_TRANSFER = 60 * 60


class RoutingService:
    def __init__(
        self,
        provider: RoutingProvider,
        *,
        ttl_seconds: int = 21600,
        max_entries: int = 256,
    ):
        self.provider = provider
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries

        self.route_cache: dict[
            str,
            tuple[float, RouteResult],
        ] = {}

        self.matrix_cache: dict[
            str,
            tuple[float, MatrixResult],
        ] = {}

    def _key(self, request) -> str:
        return json.dumps(
            request.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
        )

    def _get(self, cache, key):
        current = cache.get(key)

        if not current:
            return None

        expires_at, value = current

        if expires_at <= time.monotonic():
            cache.pop(key, None)
            return None

        return value

    def _save(self, cache, key, value):
        if len(cache) >= self.max_entries:
            first_key = next(iter(cache))
            cache.pop(first_key, None)

        cache[key] = (
            time.monotonic() + self.ttl_seconds,
            value,
        )

    async def route(
        self,
        request: RouteRequest,
    ) -> RouteResult:
        key = self._key(request)

        cached = self._get(
            self.route_cache,
            key,
        )

        if cached:
            return cached.model_copy(
                update={"cached": True}
            )

        result = await self.provider.route(request)

        limit = (
            WALKING_LONG_TRANSFER
            if request.mode == "walking"
            else DRIVING_LONG_TRANSFER
        )

        segments = [
            segment.model_copy(
                update={
                    "warning": (
                        "long_transfer"
                        if segment.duration_seconds > limit
                        else None
                    )
                }
            )
            for segment in result.segments
        ]

        result = result.model_copy(
            update={
                "segments": segments,
                "cached": False,
            }
        )

        self._save(
            self.route_cache,
            key,
            result,
        )

        return result

    async def matrix(
        self,
        request: MatrixRequest,
    ) -> MatrixResult:
        key = self._key(request)

        cached = self._get(
            self.matrix_cache,
            key,
        )

        if cached:
            return cached.model_copy(
                update={"cached": True}
            )

        result = await self.provider.matrix(request)

        self._save(
            self.matrix_cache,
            key,
            result,
        )

        return result