import asyncio
import copy
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable


class AccommodationCache[T]:
    """Bounded process memory, coalesced loads and cancellation-safe waiters."""

    def __init__(self, ttl_seconds: float, max_entries: int = 128):
        self.ttl_seconds, self.max_entries = ttl_seconds, max_entries
        self.entries: OrderedDict[tuple, tuple[float, T]] = OrderedDict()
        self.pending: dict[tuple, asyncio.Task[T]] = {}

    def peek(self, key: tuple) -> T | None:
        entry = self.entries.get(key)
        if entry and entry[0] > time.monotonic():
            self.entries.move_to_end(key)
            return copy.deepcopy(entry[1])
        self.entries.pop(key, None)
        return None

    def remove(self, key: tuple) -> None:
        self.entries.pop(key, None)

    async def load(self, key: tuple, loader: Callable[[], Awaitable[T]]) -> T:
        cached = self.peek(key)
        if cached is not None or key in self.entries:
            return cached
        task = self.pending.get(key)
        if task is None:

            async def fill() -> T:
                try:
                    result = await loader()
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
        return copy.deepcopy(await asyncio.shield(task))
