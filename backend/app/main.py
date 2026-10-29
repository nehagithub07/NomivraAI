from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app.api.router import router
from app.api.v1.health import router as health_router
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import RequestLoggingMiddleware, configure_logging
from app.core.rate_limit import ProviderLimits
from app.core.search_cache import DestinationSearchCache
from app.services.food_recommendation_service import FoodRecommendationService
from app.services.hotel_recommendation_service import HotelRecommendationService


def create_app(
    settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configure_logging()
        async with httpx.AsyncClient(
            headers={"User-Agent": app.state.settings.provider_user_agent},
            timeout=httpx.Timeout(10, connect=3, pool=3),
            limits=httpx.Limits(
                max_connections=30, max_keepalive_connections=10, keepalive_expiry=60
            ),
            transport=transport,
            follow_redirects=False,
        ) as client:
            app.state.http = client
            app.state.accommodations = HotelRecommendationService(app.state.settings, client)
            app.state.food = FoodRecommendationService(app.state.settings, client)
            yield

    app = FastAPI(title="Nomvira API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings or get_settings()
    app.state.limits = ProviderLimits()
    app.state.search_cache = DestinationSearchCache()
    app.add_middleware(RequestLoggingMiddleware)
    register_error_handlers(app)
    app.include_router(health_router)
    app.include_router(router)
    # Browser traffic goes through authenticated Next handlers. CORS is unnecessary.
    return app


app = create_app()
