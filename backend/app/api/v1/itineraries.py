from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.schemas.itinerary import ItineraryGenerationRequest, ItineraryGenerationResponse
from app.schemas.weather import WeatherAdaptationRequest, WeatherAdaptationResponse

router = APIRouter(prefix="/itineraries", dependencies=[Depends(require_internal_key)])


@router.post("/generate")
async def generate(
    request: Request, body: ItineraryGenerationRequest
) -> ItineraryGenerationResponse:
    return await request.app.state.itineraries.generate(body)


@router.post("/adapt-weather", response_model=WeatherAdaptationResponse)
async def adapt_weather(request: Request, body: WeatherAdaptationRequest):
    return await request.app.state.weather_adaptation.adapt(body)
