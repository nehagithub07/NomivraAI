from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.core.errors import AppError
from app.providers.places.overpass import OpenStreetMapOverpassProvider
from app.schemas.place import PlaceDiscoveryRequest, PlaceDiscoveryResponse
from app.services.destination_service import PlaceDiscoveryService

router = APIRouter(prefix="/places", dependencies=[Depends(require_internal_key)])


@router.post("/discover")
async def discover(request: Request, body: PlaceDiscoveryRequest) -> PlaceDiscoveryResponse:
    settings = request.app.state.settings
    if body.radius_meters and body.radius_meters > settings.max_poi_radius_meters:
        raise AppError("INVALID_DISCOVERY_RADIUS", "Choose a smaller discovery area.", 422)
    limits = request.app.state.limits
    await limits.begin_discovery()
    try:
        return await PlaceDiscoveryService(
            OpenStreetMapOverpassProvider(request.app.state.http, settings),
            settings.default_poi_radius_meters,
        ).discover(body)
    finally:
        limits.discovery_lock.release()
