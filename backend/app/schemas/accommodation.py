from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, model_validator

AccommodationType = Literal[
    "hotel", "hostel", "apartment", "homestay", "guest_house", "resort", "vacation_rental", "other"
]
ProviderName = Literal["stayapi", "fixture"]
Money = Annotated[Decimal, Field(ge=0, le=1_000_000_000, max_digits=14, decimal_places=2)]
SortOrder = Literal["recommended", "price_asc", "price_desc", "guest_rating", "distance"]


class AccommodationSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    user_id: UUID
    destination_key: str = Field(min_length=1, max_length=100)
    destination_name: str = Field(min_length=1, max_length=600, pattern=r"^[^\x00-\x1f\x7f]+$")
    destination_country: str | None = Field(default=None, max_length=160)
    destination_admin1: str | None = Field(default=None, max_length=160)
    destination_timezone: str | None = Field(default=None, max_length=100)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    check_in: date
    check_out: date
    travelers: int = Field(ge=1, le=20, strict=True)
    rooms: int = Field(ge=1, le=10, strict=True)
    currency: Literal["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"]
    accommodation_preferences: list[AccommodationType] = Field(default_factory=list, max_length=8)
    trip_budget: Money
    budget_style: Literal["budget", "balanced", "premium"]
    refresh: bool = False
    demo: bool = False  # Explicit user action, never an automatic provider substitution.

    @model_validator(mode="after")
    def valid_stay(self):
        if self.check_out <= self.check_in:
            raise ValueError("Hotel checkout must be after check-in")
        if self.nights > 90 or self.rooms > self.travelers:
            raise ValueError("Unsupported stay duration or occupancy")
        try:
            today = datetime.now(ZoneInfo(self.destination_timezone or "UTC")).date()
        except ZoneInfoNotFoundError:
            raise ValueError("Unknown destination timezone") from None
        if self.check_in < today:
            raise ValueError("Hotel check-in cannot be in the past")
        return self

    @property
    def nights(self) -> int:
        return (self.check_out - self.check_in).days

    def inventory_key(self, provider: str) -> tuple:
        # User scope prevents another account from observing a user's search history.
        # Budget/style/preferences do not change inventory or spend provider quota.
        return (
            provider,
            str(self.user_id),
            self.destination_key,
            self.destination_name.casefold(),
            self.destination_country,
            self.destination_admin1,
            self.latitude,
            self.longitude,
            self.check_in,
            self.check_out,
            self.travelers,
            self.rooms,
            self.currency,
        )


class AccommodationCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    provider: ProviderName
    provider_accommodation_id: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=300)
    accommodation_type: AccommodationType | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    address: str | None = Field(default=None, max_length=600)
    star_rating: float | None = Field(default=None, ge=0, le=5, allow_inf_nan=False)
    guest_rating: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    guest_rating_scale: float | None = Field(default=None, gt=0, le=100, allow_inf_nan=False)
    review_count: int | None = Field(default=None, ge=0, le=2_147_483_647)
    nightly_price: Money | None = None
    total_price: Money | None = None
    taxes_and_fees: Money | None = None
    taxes_included: bool | None = None
    advertised_price: Money | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    distance_km: float | None = Field(default=None, ge=0, le=40080, allow_inf_nan=False)
    amenities: list[str] = Field(default_factory=list, max_length=40)
    image_url: str | None = Field(default=None, max_length=2000)
    booking_url: str | None = Field(default=None, max_length=2000)
    available: bool | None = None

    @model_validator(mode="after")
    def valid_rating(self):
        if self.guest_rating is not None and (
            self.guest_rating_scale is None or self.guest_rating > self.guest_rating_scale
        ):
            raise ValueError("Guest rating requires its actual scale")
        return self


class ScoreComponents(BaseModel):
    budget_fit: float
    guest_quality: float
    location: float
    preference: float
    property_quality: float
    review_confidence: float


class RankedAccommodation(AccommodationCandidate):
    recommendation_score: float
    scores: ScoreComponents
    labels: list[str]
    within_stay_budget: bool | None
    comparable_price: bool


class AccommodationInventory(BaseModel):
    provider: ProviderName
    demo: bool
    searched_at: datetime
    expires_at: datetime
    candidates: list[AccommodationCandidate]


class AccommodationSearchResponse(BaseModel):
    provider: ProviderName
    demo: bool
    cached: bool
    searched_at: datetime
    expires_at: datetime
    hotel_nights: int
    rooms: int
    stay_budget: Money
    currency: str
    candidates: list[RankedAccommodation]
    returned_before_filters: int
    attribution: str
