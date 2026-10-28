from app.providers.geocoding.base import GeocodingProvider
from app.providers.places.base import PlacesProvider
from app.schemas.destination import DestinationSearchRequest, DestinationSearchResponse
from app.schemas.place import PlaceDiscoveryRequest, PlaceDiscoveryResponse


class DestinationService:
    def __init__(self, geocoding: GeocodingProvider):
        self.geocoding = geocoding

    async def search(self, request: DestinationSearchRequest) -> DestinationSearchResponse:
        return DestinationSearchResponse(
            destinations=await self.geocoding.search(
                request.q, request.limit, request.language, request.country_code
            )
        )


class PlaceDiscoveryService:
    def __init__(self, places: PlacesProvider, default_radius: int):
        self.places, self.default_radius = places, default_radius

    async def discover(self, request: PlaceDiscoveryRequest) -> PlaceDiscoveryResponse:
        radius = request.radius_meters or self.default_radius
        return PlaceDiscoveryResponse(
            latitude=request.latitude,
            longitude=request.longitude,
            radius_meters=radius,
            places=await self.places.discover_nearby(
                request.latitude, request.longitude, radius, request.limit
            ),
        )
