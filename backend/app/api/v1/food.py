from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.schemas.food import FoodSearchRequest, FoodSearchResponse

router = APIRouter(prefix="/food", dependencies=[Depends(require_internal_key)])


@router.post("/search")
async def search(request: Request, body: FoodSearchRequest) -> FoodSearchResponse:
    return await request.app.state.food.search(body)
