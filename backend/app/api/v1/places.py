import logging

from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.core.errors import AppError
from app.providers.places.overpass import (
    OpenStreetMapOverpassProvider,
)
from app.schemas.place import (
    PlaceDiscoveryRequest,
    PlaceDiscoveryResponse,
)
from app.services.destination_service import (
    PlaceDiscoveryService,
)

router = APIRouter(
    prefix="/places",
    dependencies=[
        Depends(require_internal_key),
    ],
)

logger = logging.getLogger(
    "nomvira.discovery"
)


@router.post(
    "/discover",
    response_model=PlaceDiscoveryResponse,
)
async def discover(
    request: Request,
    body: PlaceDiscoveryRequest,
) -> PlaceDiscoveryResponse:
    settings = (
        request.app.state.settings
    )

    requested_radius = (
        body.radius_meters
        if body.radius_meters
        is not None
        else settings.default_poi_radius_meters
    )


    # -----------------------------------------------------
    # Validate configured/requested radius
    # -----------------------------------------------------

    if (
        requested_radius
        >
        settings.max_poi_radius_meters
    ):
        raise AppError(
            "INVALID_DISCOVERY_RADIUS",
            (
                "Choose a smaller discovery area. "
                f"The maximum supported radius is "
                f"{settings.max_poi_radius_meters} meters."
            ),
            422,
        )


    if (
        requested_radius
        < 100
    ):
        raise AppError(
            "INVALID_DISCOVERY_RADIUS",
            (
                "The discovery radius must be "
                "at least 100 meters."
            ),
            422,
        )


    # -----------------------------------------------------
    # Normalize request
    # -----------------------------------------------------
    #
    # The provider now supports city-level discovery up
    # to the configured maximum (30 km in our setup).
    #
    # Do NOT add the old 5 km cap here.
    # -----------------------------------------------------

    normalized_body = (
        body.model_copy(
            update={
                "radius_meters":
                    requested_radius,
            }
        )
    )


    logger.info(
        (
            "place_discovery_requested "
            "radius_meters=%d "
            "limit=%d"
        ),
        requested_radius,
        normalized_body.limit,
    )


    # -----------------------------------------------------
    # Provider + service
    # -----------------------------------------------------

    provider = (
        OpenStreetMapOverpassProvider(
            request.app.state.http,
            settings,
        )
    )

    service = (
        PlaceDiscoveryService(
            provider,
            settings.default_poi_radius_meters,
        )
    )


    # -----------------------------------------------------
    # Concurrency guard
    # -----------------------------------------------------

    async with (
        request.app.state
        .limits
        .discovery()
    ):
        result = (
            await service.discover(
                normalized_body
            )
        )


    logger.info(
        (
            "place_discovery_completed "
            "radius_meters=%d "
            "places=%d"
        ),
        result.radius_meters,
        len(
            result.places
        ),
    )


    return result