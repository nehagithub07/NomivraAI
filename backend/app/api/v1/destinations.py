from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.api.dependencies import require_internal_key
from app.providers.geocoding.open_meteo import OpenMeteoGeocodingProvider
from app.schemas.destination import (
    DestinationCandidate,
    DestinationSearchRequest,
    DestinationSearchResponse,
    LocationID,
)
from app.services.destination_service import DestinationService

router = APIRouter(prefix="/destinations", dependencies=[Depends(require_internal_key)])


@router.get("/search")
async def search(
    request: Request, query: Annotated[DestinationSearchRequest, Query()]
) -> DestinationSearchResponse:
    request.app.state.limits.search()
    service = DestinationService(
        OpenMeteoGeocodingProvider(request.app.state.http, request.app.state.settings)
    )
    key = (query.q.casefold(), query.language, query.limit, query.country_code)
    return await request.app.state.search_cache.get_or_load(key, lambda: service.search(query))


@router.get("/{provider_location_id}")
async def resolve(request: Request, provider_location_id: LocationID) -> DestinationCandidate:
    request.app.state.limits.search()
    return await OpenMeteoGeocodingProvider(
        request.app.state.http, request.app.state.settings
    ).resolve(provider_location_id)
