import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.core.errors import AppError

logger = logging.getLogger("nomvira.discovery")


class ProviderLimits:
    """One-process backstop for shared public services; bounded waiting only."""

    def __init__(
        self,
        *,
        discovery_wait_seconds: float = 8.0,
        discovery_cooldown_seconds: float = 2.0,
        max_discovery_waiters: int = 4,
    ):
        self.search_events: list[float] = []
        self.discovery_lock = asyncio.Lock()
        self.last_discovery = float("-inf")
        self.discovery_wait_seconds = discovery_wait_seconds
        self.discovery_cooldown_seconds = discovery_cooldown_seconds
        self.max_discovery_waiters = max_discovery_waiters
        self._discovery_waiters = 0
        self._discovery_owner: asyncio.Task | None = None

    def search(self) -> None:
        now = time.monotonic()

        self.search_events = [instant for instant in self.search_events if now - instant < 60]

        if len(self.search_events) >= 60:
            raise AppError(
                "GEOCODING_RATE_LIMITED",
                "Please wait before searching again.",
                429,
            )

        self.search_events.append(now)

    async def begin_discovery(self) -> None:
        """Serialize calls with a bounded queue and a cancellation-safe courtesy gap."""
        if self._discovery_waiters >= self.max_discovery_waiters:
            logger.warning("discovery_local_rate_limited reason=queue_full")
            raise AppError(
                "PLACES_RATE_LIMITED",
                "Place discovery is busy. Please try again shortly.",
                429,
            )
        acquired = False
        started = time.monotonic()
        self._discovery_waiters += 1
        if self.discovery_lock.locked():
            logger.info("discovery_slot_waiting pending=%d", self._discovery_waiters)
        try:
            # The single deadline covers both lock waiting and the courtesy cooldown.
            async with asyncio.timeout(self.discovery_wait_seconds):
                await self.discovery_lock.acquire()
                acquired = True
                delay = self.discovery_cooldown_seconds - (time.monotonic() - self.last_discovery)
                if delay > 0:
                    await asyncio.sleep(delay)
            self._discovery_owner = asyncio.current_task()
            self.last_discovery = time.monotonic()
            logger.info(
                "discovery_slot_acquired wait_ms=%d", (self.last_discovery - started) * 1000
            )
        except BaseException as exc:
            # CancelledError is a BaseException. Release only our own acquired slot.
            if acquired:
                self._discovery_owner = None
                self.discovery_lock.release()
            if isinstance(exc, TimeoutError):
                logger.warning("discovery_local_rate_limited reason=wait_timeout")
                raise AppError(
                    "PLACES_RATE_LIMITED",
                    "Place discovery is busy. Please try again shortly.",
                    429,
                ) from None
            raise
        finally:
            self._discovery_waiters -= 1

    def end_discovery(self) -> None:
        if self._discovery_owner is not asyncio.current_task():
            raise RuntimeError("Discovery slot must be released by its owning task")
        self._discovery_owner = None
        self.discovery_lock.release()
        logger.info("discovery_slot_released")

    @asynccontextmanager
    async def discovery(self) -> AsyncIterator[None]:
        await self.begin_discovery()
        try:
            yield
        finally:
            self.end_discovery()
