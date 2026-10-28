from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.schemas.accommodation import AccommodationSearchRequest, AccommodationSearchResponse

router = APIRouter(prefix="/accommodations", dependencies=[Depends(require_internal_key)])


@router.post("/search")
async def search(request: Request, body: AccommodationSearchRequest) -> AccommodationSearchResponse:
    return await request.app.state.accommodations.search(body)
