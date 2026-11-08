from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.services.memory_embeddings import EmbeddingRequest

router = APIRouter(prefix="/memory", dependencies=[Depends(require_internal_key)])


@router.post("/embed")
async def embed(request: Request, body: EmbeddingRequest):
    return await request.app.state.memory_embeddings.embed(body)
