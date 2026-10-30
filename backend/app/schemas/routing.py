from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


TravelMode = Literal["walking", "driving"]


class RoutePoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    label: str | None = Field(default=None, max_length=200)


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points: list[RoutePoint] = Field(min_length=2, max_length=10)
    mode: TravelMode = "walking"


class RouteGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["LineString"]
    coordinates: list[list[float]] = Field(min_length=2)


class RouteSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_index: int = Field(ge=0)
    to_index: int = Field(ge=1)

    from_label: str | None = None
    to_label: str | None = None

    distance_meters: float = Field(ge=0)
    duration_seconds: float = Field(ge=0)

    warning: Literal["long_transfer"] | None = None


class RouteResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["openrouteservice"]
    mode: TravelMode

    total_distance_meters: float = Field(ge=0)
    total_duration_seconds: float = Field(ge=0)

    segments: list[RouteSegment]

    geometry: RouteGeometry

    cached: bool = False


class MatrixRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points: list[RoutePoint] = Field(min_length=2, max_length=20)
    mode: TravelMode = "walking"


class MatrixResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["openrouteservice"]
    mode: TravelMode

    durations: list[list[float | None]]
    distances: list[list[float | None]]

    cached: bool = False