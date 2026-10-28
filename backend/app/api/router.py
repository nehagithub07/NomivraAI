from fastapi import APIRouter

from app.api.v1.destinations import router as destinations_router
from app.api.v1.places import router as places_router

router = APIRouter(prefix="/api/v1")
router.include_router(destinations_router)
router.include_router(places_router)
