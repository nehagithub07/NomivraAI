from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.api.dependencies import require_internal_key

router = APIRouter()


@router.get("/api/v1/diagnostics", dependencies=[Depends(require_internal_key)])
async def diagnostics(request: Request):
    settings = request.app.state.settings
    configured = {
        "places": bool(settings.geoapify_api_key.get_secret_value() or settings.overpass_api_url),
        "hotels": bool(settings.stayapi_api_key.get_secret_value()),
        "food": bool(
            settings.stayapi_api_key.get_secret_value()
            if settings.food_provider == "google_maps"
            else settings.geoapify_api_key.get_secret_value()
        ),
        "itinerary": bool(settings.gemini_api_key.get_secret_value()),
        "companion": bool(settings.gemini_api_key.get_secret_value()),
        "maps_routing": bool(settings.openrouteservice_api_key.get_secret_value()),
        "rag_embeddings": bool(settings.gemini_api_key.get_secret_value()),
    }
    return {
        "configured": configured,
        "database_schema_verified": False,
        "metrics": request.app.state.monitor.snapshot(),
    }


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "nomivra-api"}


@router.get("/ready")
async def ready(request: Request):
    # No external quota or credentials in health responses. Lifespan must be complete.
    initialized = all(
        hasattr(request.app.state, name)
        for name in (
            "http",
            "accommodations",
            "food",
            "itineraries",
            "companion",
            "routing",
            "memory_embeddings",
        )
    )
    if initialized:
        initialized = not request.app.state.http.is_closed
    return JSONResponse(
        {"status": "ready" if initialized else "unavailable"},
        status_code=200 if initialized else 503,
    )
