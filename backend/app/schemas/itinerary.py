from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.food import Diet, FoodCategory
from app.schemas.place import PlaceCategory

Interest = Literal[
    "food",
    "history",
    "culture",
    "nature",
    "adventure",
    "art",
    "shopping",
    "nightlife",
    "beaches",
    "relaxation",
    "photography",
    "local_experiences",
]
Pace = Literal["relaxed", "balanced", "packed"]
Period = Literal["morning", "afternoon", "evening"]
Kind = Literal["attraction", "food", "hotel", "free_time"]
Reason = Literal[
    "interest_match", "area_grouping", "pace_balance", "food_option", "selected_stay", "free_time"
]
Theme = Literal["discovery", "culture", "nature", "mixed", "relaxation"]
Text = Annotated[str, Field(min_length=1, max_length=300)]
Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PlanningAttraction(StrictModel):
    candidate_id: str = Field(pattern=r"^(node|way|relation)/[1-9][0-9]{0,18}$")
    name: str = Field(min_length=1, max_length=500)
    category: PlaceCategory
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    distance_km: float = Field(ge=0, le=40080)
    opening_hours: str | None = Field(default=None, max_length=500)


class PlanningFood(StrictModel):
    candidate_id: str = Field(min_length=1, max_length=512)
    provider: Literal["geoapify"] = "geoapify"
    name: Text
    category: FoodCategory
    cuisine_types: list[Annotated[str, Field(max_length=100)]] = Field(
        default_factory=list, max_length=40
    )
    dietary_tags: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=20
    )
    dietary_conflicts: list[Diet] = Field(default_factory=list, max_length=5)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    distance_km: float | None = Field(default=None, ge=0, le=40080)
    recommendation_score: float | None = Field(default=None, ge=0, le=1)


class PlanningHotel(StrictModel):
    candidate_id: UUID  # The owned selection ID, not a generated hotel ID.
    provider: Literal["stayapi"] = "stayapi"
    provider_accommodation_id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    name: Text | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    total_price: Money | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    guest_rating: float | None = Field(default=None, ge=0)
    guest_rating_scale: float | None = Field(default=None, gt=0, le=100)
    quote_expires_at: datetime | None = None


class PlanningInput(StrictModel):
    trip_id: UUID
    destination_name: str = Field(min_length=1, max_length=160)
    country: str | None = Field(default=None, max_length=160)
    timezone: str | None = Field(default=None, max_length=100)
    start_date: date
    end_date: date
    travelers: int = Field(ge=1, le=20)
    budget_total: Money
    currency: Literal["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"]
    budget_style: Literal["budget", "balanced", "premium"]
    travel_pace: Pace
    interests: list[Interest] = Field(max_length=12)
    accommodation_preferences: list[Text] = Field(max_length=5)
    dietary_preferences: list[Diet] = Field(max_length=5)
    special_requests: str | None = Field(default=None, max_length=500)
    attractions: list[PlanningAttraction] = Field(max_length=30)
    food: list[PlanningFood] = Field(default_factory=list, max_length=20)
    hotel: PlanningHotel | None = None


class BudgetSummary(StrictModel):
    currency: str
    trip_budget: str
    known_accommodation_total: str | None
    remaining_known_budget: str | None
    excludes_unknown_costs: Literal[True] = True


class Proximity(StrictModel):
    first_id: str
    second_id: str
    straight_line_km: float


class TripPlanningContext(PlanningInput):
    dates: list[date]
    max_attractions_per_day: int
    budget: BudgetSummary
    proximity: list[Proximity]
    warnings: list[str]


class ItineraryItem(StrictModel):
    candidate_type: Kind
    candidate_id: str | None = Field(max_length=512)
    period: Period
    reason_code: Reason


class ItineraryDay(StrictModel):
    date: date
    day_number: int = Field(ge=1, le=14, strict=True)
    theme: Theme
    items: list[ItineraryItem] = Field(min_length=1, max_length=7)


class GeneratedItinerary(StrictModel):
    # No model-authored factual prose. Titles, notes and facts are hydrated by the server.
    days: list[ItineraryDay] = Field(min_length=1, max_length=14)
    warnings: list[Literal["insufficient_candidates"]] = Field(default_factory=list, max_length=1)


class ResolvedItem(StrictModel):
    candidate_type: Kind
    candidate_id: str | None
    candidate_provider: Literal["openstreetmap", "geoapify", "stayapi"] | None
    period: Period
    title: str = Field(min_length=1, max_length=500)
    reason: str = Field(max_length=300)
    notes: str | None = Field(max_length=500)
    category: str | None = Field(max_length=80)
    latitude: float | None = Field(ge=-90, le=90)
    longitude: float | None = Field(ge=-180, le=180)
    opening_hours: str | None = Field(max_length=500)


class ResolvedDay(StrictModel):
    date: date
    day_number: int
    theme: str
    items: list[ResolvedItem]


class ItineraryDocument(StrictModel):
    title: str = Field(max_length=200)
    summary: str = Field(max_length=500)
    days: list[ResolvedDay]
    warnings: list[Annotated[str, Field(max_length=500)]] = Field(max_length=20)


class ItineraryGenerationRequest(StrictModel):
    user_id: UUID  # Rate-limit scope only; never sent to Gemini.
    context: PlanningInput


class ItineraryGenerationResponse(StrictModel):
    provider: Literal["gemini", "fixture"]
    model_name: str
    prompt_version: str
    demo: bool
    itinerary: ItineraryDocument
    budget: BudgetSummary  # Transient hotel quote math; never stored in itinerary versions.
