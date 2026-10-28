from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

LocationID = Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{0,14}$")]


class Coordinates(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


class DestinationSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    q: str = Field(min_length=3, max_length=100, pattern=r"^[^\x00-\x1f\x7f]+$")
    language: str = Field(default="en", pattern=r"^[a-z]{2,3}$")
    limit: int = Field(default=8, ge=1, le=10)
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")


class DestinationCandidate(Coordinates):
    provider: Literal["open_meteo"] = "open_meteo"
    provider_location_id: LocationID
    name: str = Field(min_length=1, max_length=160)
    display_name: str = Field(min_length=1, max_length=600)
    country: str | None = Field(default=None, max_length=160)
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    admin1: str | None = Field(default=None, max_length=160)
    admin2: str | None = Field(default=None, max_length=160)
    timezone: str | None = None
    feature_code: str | None = Field(default=None, max_length=20)
    population: int | None = Field(default=None, ge=0, le=9007199254740991)


class DestinationSearchResponse(BaseModel):
    destinations: list[DestinationCandidate]
