from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

FoodCategory = Literal[
    "restaurant", "cafe", "bar", "pub", "fast_food", "food_court", "dessert", "other"
]
Diet = Literal["vegetarian", "vegan", "halal", "kosher", "gluten_free"]
FoodLabel = Literal[
    "Nomivra Pick",
    "Best Match",
    "Nearby Pick",
    "Diet-Friendly",
    "Cuisine Match",
    "Cafe Pick",
    "Local Food Pick",
]


class FoodSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    user_id: UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_meters: int | None = Field(default=None, ge=100, le=15000)
    categories: list[FoodCategory] = Field(
        default_factory=lambda: ["restaurant", "cafe", "bar", "pub", "fast_food", "food_court"],
        min_length=1,
        max_length=8,
    )
    dietary_preferences: list[Diet] = Field(default_factory=list, max_length=5)
    cuisine_preferences: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(
        default_factory=list, max_length=10
    )
    strict_dietary: bool = False
    limit: int = Field(default=20, ge=1, le=40)
    demo: bool = False


class FoodScores(BaseModel):
    dietary_match: float = Field(default=0.5, ge=0, le=1)
    cuisine_match: float = Field(default=0.5, ge=0, le=1)
    distance: float = Field(default=0, ge=0, le=1)
    category_preference: float = Field(default=0, ge=0, le=1)
    data_quality: float = Field(default=0, ge=0, le=1)


class FoodCandidate(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    provider: Literal["geoapify", "fixture"]
    provider_place_id: str = Field(min_length=1, max_length=512)
    name: str = Field(min_length=1, max_length=300)
    category: FoodCategory
    cuisine_types: list[str] = Field(default_factory=list)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    address: str | None = None
    distance_km: float | None = None
    dietary_tags: list[str] = Field(default_factory=list)
    dietary_conflicts: list[str] = Field(default_factory=list)
    opening_hours: str | None = None
    website: str | None = None
    price_level: str | None = None
    rating: float | None = None
    rating_scale: float | None = None
    review_count: int | None = None
    recommendation_score: float = Field(default=0, ge=0, le=1)
    scores: FoodScores = Field(default_factory=FoodScores)
    labels: list[FoodLabel] = Field(default_factory=list)
    dietary_match: Literal["confirmed", "unknown", "not_requested"] = "not_requested"


class FoodSearchResponse(BaseModel):
    provider: Literal["geoapify", "fixture"]
    demo: bool
    cached: bool = False
    searched_at: str
    expires_at: str
    radius_meters: int
    dietary_fallback: bool = False
    candidates: list[FoodCandidate]
