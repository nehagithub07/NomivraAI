from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.schemas.routing import (
    MatrixRequest,
    MatrixResult,
    RouteRequest,
    RouteResult,
)


router = APIRouter(
    prefix="/routing",
    dependencies=[Depends(require_internal_key)],
)


@router.post(
    "/route",
    response_model=RouteResult,
)
async def route(
    request: Request,
    body: RouteRequest,
):
    return await request.app.state.routing.route(body)


@router.post(
    "/matrix",
    response_model=MatrixResult,
)
async def matrix(
    request: Request,
    body: MatrixRequest,
):
    return await request.app.state.routing.matrix(body)