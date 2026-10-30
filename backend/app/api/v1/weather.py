from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.schemas.weather import WeatherOverviewRequest, WeatherReport

router = APIRouter(prefix="/weather", dependencies=[Depends(require_internal_key)])


@router.post("/forecast", response_model=WeatherReport)
async def forecast(request: Request, body: WeatherOverviewRequest):
    return await request.app.state.weather.report(body)
