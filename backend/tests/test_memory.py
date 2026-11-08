import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.main import create_app
from app.schemas.memory import RetrievedMemory
from app.services.memory_embeddings import EmbeddingRequest, MemoryEmbeddings

KEY = "test-memory-internal-key-not-a-real-secret"


def sdk(monkeypatch, values=None, error=None):
    call = AsyncMock(
        return_value=SimpleNamespace(embeddings=[SimpleNamespace(values=values)]),
        side_effect=error,
    )

    class Client:
        def __init__(self, **kwargs):
            self.aio = self
            self.models = SimpleNamespace(embed_content=call)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

    monkeypatch.setattr("app.services.memory_embeddings.genai.Client", Client)
    return call


@pytest.mark.asyncio
async def test_embeddings_are_normalized_cached_per_user_and_documents_not_cached(monkeypatch):
    call = sdk(monkeypatch, [2.0] + [0.0] * 767)
    service = MemoryEmbeddings(Settings(gemini_api_key="test-key"))
    body = EmbeddingRequest(user_id=uuid4(), text='{"interests":["nature"]}', purpose="query")
    result = await service.embed(body)
    assert len(result["embedding"]) == 768
    assert result["embedding"][0] == 1
    assert await service.embed(body) == result
    assert call.await_count == 1
    assert call.call_args.kwargs["config"].task_type == "RETRIEVAL_QUERY"
    await service.embed(body.model_copy(update={"user_id": uuid4()}))
    assert call.await_count == 2
    document = body.model_copy(update={"purpose": "document"})
    await service.embed(document)
    await service.embed(document)
    assert call.await_count == 4
    assert call.call_args.kwargs["config"].task_type == "RETRIEVAL_DOCUMENT"
    assert all(body.text not in str(key) for key in service.cache)
    service.cache[next(iter(service.cache))] = (0, result["embedding"])
    await service.embed(body)
    assert call.await_count == 5


@pytest.mark.asyncio
@pytest.mark.parametrize("values", [[], [0.0] * 768, [float("nan")] * 768, [1.0] * 3])
async def test_bad_embeddings_fail_closed(monkeypatch, values):
    sdk(monkeypatch, values)
    service = MemoryEmbeddings(Settings(gemini_api_key="test-key"))
    with pytest.raises(AppError, match="unavailable"):
        await service.embed(EmbeddingRequest(user_id=uuid4(), text="nature", purpose="query"))
    assert not service.cache


@pytest.mark.asyncio
async def test_unavailable_embeddings_and_backend_auth(monkeypatch):
    call = sdk(monkeypatch, error=RuntimeError("private provider details"))
    body = {"user_id": str(uuid4()), "text": "nature", "purpose": "query"}
    app = create_app(Settings(app_env="test", nomvira_internal_api_key=KEY, gemini_api_key=""))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (await client.post("/api/v1/memory/embed", json=body)).status_code == 401
            response = await client.post(
                "/api/v1/memory/embed", json=body, headers={"X-Nomvira-Internal-Key": KEY}
            )
            assert response.status_code == 503
            assert call.await_count == 0  # Missing key makes no provider calls.
            app.state.memory_embeddings = MemoryEmbeddings(Settings(gemini_api_key="test-key"))
            response = await client.post(
                "/api/v1/memory/embed", json=body, headers={"X-Nomvira-Internal-Key": KEY}
            )
            assert response.status_code == 503
            assert "private provider" not in response.text
            assert (
                await client.post(
                    "/api/v1/memory/embed",
                    json={**body, "text": "x" * 2001},
                    headers={"X-Nomvira-Internal-Key": KEY},
                )
            ).status_code == 422


def test_retrieved_context_rejects_sensitive_or_invented_fields():
    record = {
        "id": str(uuid4()),
        "kind": "feedback",
        "feedback": "avoid",
        "preferences": {
            "interests": ["nature"],
            "travelPace": "relaxed",
            "budgetStyle": "balanced",
            "dietaryPreferences": [],
            "accommodationPreferences": ["hotel"],
        },
    }
    assert RetrievedMemory.model_validate(record).feedback == "avoid"
    with pytest.raises(ValidationError):
        RetrievedMemory.model_validate({**record, "conversation": "secret"})
    with pytest.raises(ValidationError):
        RetrievedMemory.model_validate(
            {**record, "preferences": {**record["preferences"], "api_key": "secret"}}
        )


@pytest.mark.asyncio
async def test_real_sdk_embedding_request_contract(monkeypatch):
    from app.services import memory_embeddings

    original = memory_embeddings.genai.Client
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        assert "gemini-embedding-001" in str(request.url)
        return httpx.Response(200, json={"embeddings": [{"values": [2.0] + [0.0] * 767}]})

    def client(**kwargs):
        options = kwargs["http_options"]
        assert options.timeout == 4000 and options.retry_options.attempts == 1
        kwargs["http_options"] = options.model_copy(
            update={"async_client_args": {"transport": httpx.MockTransport(handler)}}
        )
        return original(**kwargs)

    monkeypatch.setattr(memory_embeddings.genai, "Client", client)
    service = MemoryEmbeddings(Settings(gemini_api_key="test-key"))
    result = await service.embed(
        EmbeddingRequest(user_id=uuid4(), text="nature balanced hotel", purpose="document")
    )
    assert result["embedding"][0] == 1
    assert len(requests) == 1
    document = requests[0]["requests"][0]
    assert document["taskType"] == "RETRIEVAL_DOCUMENT"
    assert document["outputDimensionality"] == 768
    assert document["content"]["parts"] == [{"text": "nature balanced hotel"}]
    assert "user_id" not in json.dumps(requests)
