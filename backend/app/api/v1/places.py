import logging

from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.core.errors import AppError
from app.providers.places.overpass import OpenStreetMapOverpassProvider
from app.schemas.place import PlaceDiscoveryRequest, PlaceDiscoveryResponse
from app.services.destination_service import PlaceDiscoveryService

router = APIRouter(prefix="/places", dependencies=[Depends(require_internal_key)])
logger = logging.getLogger("nomvira.discovery")


@router.post("/discover")
async def discover(request: Request, body: PlaceDiscoveryRequest) -> PlaceDiscoveryResponse:
    settings = request.app.state.settings
    if body.radius_meters and body.radius_meters > settings.max_poi_radius_meters:
        raise AppError("INVALID_DISCOVERY_RADIUS", "Choose a smaller discovery area.", 422)
    logger.info("place_discovery_requested")
    # Match the lighter Overpass adapter's radius cap in the response as well.
    body = body.model_copy(
        update={
            "radius_meters": min(body.radius_meters or settings.default_poi_radius_meters, 5000),
        }
    )
    async with request.app.state.limits.discovery():
        return await PlaceDiscoveryService(
            OpenStreetMapOverpassProvider(request.app.state.http, settings),
            settings.default_poi_radius_meters,
        ).discover(body)
