import asyncio
import hashlib
import math
import time
from collections import OrderedDict
from typing import Literal
from uuid import UUID

from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import Settings
from app.core.errors import AppError
from app.core.observability import cache_event, model_request

MODEL = "gemini-embedding-001"
DIMENSIONS = 768


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID
    text: str = Field(min_length=1, max_length=2000)
    purpose: Literal["document", "query"]


class MemoryEmbeddings:
    """No document cache. Query cache contains only user-scoped hashes and vectors."""

    def __init__(self, settings: Settings):
        self.key = settings.gemini_api_key.get_secret_value()
        self.cache: OrderedDict[tuple, tuple[float, list[float]]] = OrderedDict()
        self.lock = asyncio.Lock()

    async def embed(self, body: EmbeddingRequest) -> dict:
        if not self.key:
            raise AppError("MEMORY_UNAVAILABLE", "Travel memory indexing is unavailable.", 503)
        cache_key = (body.user_id, hashlib.sha256(body.text.encode()).digest())
        try:
            # Bound queueing, provider latency and retries; do not delay core travel flows.
            async with asyncio.timeout(5), self.lock:
                now = time.monotonic()
                if body.purpose == "query" and cache_key in self.cache:
                    expires, vector = self.cache[cache_key]
                    if expires > now:
                        self.cache.move_to_end(cache_key)
                        cache_event("hit")
                        return {"embedding": vector, "model": MODEL}
                    del self.cache[cache_key]
                if body.purpose == "query":
                    cache_event("miss")
                async with genai.Client(
                    api_key=self.key,
                    http_options=types.HttpOptions(
                        timeout=4000, retry_options=types.HttpRetryOptions(attempts=1)
                    ),
                ).aio as client:
                    response = await model_request(
                        client.models.embed_content,
                        model=MODEL,
                        contents=body.text,
                        config=types.EmbedContentConfig(
                            output_dimensionality=DIMENSIONS,
                            task_type=(
                                "RETRIEVAL_QUERY"
                                if body.purpose == "query"
                                else "RETRIEVAL_DOCUMENT"
                            ),
                        ),
                    )
                vector = response.embeddings[0].values if response.embeddings else None
                if (
                    not vector
                    or len(vector) != DIMENSIONS
                    or not all(math.isfinite(v) for v in vector)
                ):
                    raise ValueError("Invalid embedding")
                norm = math.sqrt(sum(v * v for v in vector))
                if not math.isfinite(norm) or norm <= 0:
                    raise ValueError("Invalid embedding")
                vector = [v / norm for v in vector]
                if body.purpose == "query":
                    self.cache[cache_key] = (now + 300, vector)
                    while len(self.cache) > 256:
                        self.cache.popitem(last=False)
                return {"embedding": vector, "model": MODEL}
        except AppError:
            raise
        except Exception:
            # Never log request text, credentials or raw provider exceptions.
            raise AppError(
                "MEMORY_UNAVAILABLE", "Travel memory indexing is unavailable.", 503
            ) from None
