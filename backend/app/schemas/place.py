from typing import Literal

from pydantic import ConfigDict, Field

from app.schemas.destination import Coordinates

PlaceCategory = Literal[
    "attraction", "museum", "viewpoint", "historic", "monument", "park", "gallery", "arts_centre"
]


class PlaceDiscoveryRequest(Coordinates):
    model_config = ConfigDict(extra="forbid")
    radius_meters: int | None = Field(default=None, ge=100, le=20000)
    limit: int = Field(default=20, ge=1, le=30)


class PlaceCandidate(Coordinates):
    provider: Literal["openstreetmap"] = "openstreetmap"
    provider_place_id: str = Field(pattern=r"^(node|way|relation)/[1-9][0-9]{0,18}$")
    name: str = Field(min_length=1, max_length=500)
    category: PlaceCategory
    distance_km: float = Field(ge=0, allow_inf_nan=False)
    tags: dict[str, str] = Field(default_factory=dict)


class PlaceDiscoveryResponse(Coordinates):
    radius_meters: int
    places: list[PlaceCandidate]
