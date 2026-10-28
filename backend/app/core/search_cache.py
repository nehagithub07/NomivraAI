import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable

from app.schemas.destination import DestinationSearchResponse


class DestinationSearchCache:
    """Small, ephemeral public-result cache; user-bound proofs stay in the BFF."""

    def __init__(self, ttl_seconds: float = 300, max_entries: int = 128):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self.entries: OrderedDict[tuple, tuple[float, DestinationSearchResponse]] = OrderedDict()
        self.pending: dict[tuple, asyncio.Task[DestinationSearchResponse]] = {}

    async def get_or_load(
        self, key: tuple, load: Callable[[], Awaitable[DestinationSearchResponse]]
    ) -> DestinationSearchResponse:
        cached = self.entries.get(key)
        if cached and cached[0] > time.monotonic():
            self.entries.move_to_end(key)
            return cached[1].model_copy(deep=True)
        self.entries.pop(key, None)
        task = self.pending.get(key)
        if task is None:

            async def fill() -> DestinationSearchResponse:
                try:
                    result = await load()
                    self.entries[key] = (time.monotonic() + self.ttl_seconds, result)
                    self.entries.move_to_end(key)
                    while len(self.entries) > self.max_entries:
                        self.entries.popitem(last=False)
                    return result
                finally:
                    self.pending.pop(key, None)

            task = asyncio.create_task(fill())
            task.add_done_callback(lambda done: None if done.cancelled() else done.exception())
            self.pending[key] = task
        # A cancelled waiter must not cancel another user's identical search.
        return (await asyncio.shield(task)).model_copy(deep=True)
