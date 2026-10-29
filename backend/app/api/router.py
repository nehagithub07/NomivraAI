from fastapi import APIRouter

from app.api.v1.accommodations import router as accommodations_router
from app.api.v1.budget import router as budget_router
from app.api.v1.destinations import router as destinations_router
from app.api.v1.food import router as food_router
from app.api.v1.itineraries import router as itineraries_router
from app.api.v1.places import router as places_router

router = APIRouter(prefix="/api/v1")
router.include_router(destinations_router)
router.include_router(places_router)
router.include_router(accommodations_router)
router.include_router(food_router)
router.include_router(itineraries_router)
router.include_router(budget_router)
