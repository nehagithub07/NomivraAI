import asyncio
import time

from app.core.errors import AppError


class ProviderLimits:
    """One-process backstop for shared public services; no unbounded queues."""

    def __init__(self):
        self.search_events: list[float] = []
        self.discovery_lock = asyncio.Lock()
        self.last_discovery = float("-inf")

    def search(self) -> None:
        now = time.monotonic()
        self.search_events = [instant for instant in self.search_events if now - instant < 60]
        if len(self.search_events) >= 60:
            raise AppError("GEOCODING_RATE_LIMITED", "Please wait before searching again.", 429)
        self.search_events.append(now)

    async def begin_discovery(self) -> None:
        now = time.monotonic()
        if self.discovery_lock.locked() or now - self.last_discovery < 10:
            raise AppError(
                "PLACES_RATE_LIMITED", "Please wait before discovering places again.", 429
            )
        await self.discovery_lock.acquire()
        self.last_discovery = now
