from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Category = Literal["accommodation", "food", "activities", "transport", "miscellaneous"]
Currency = Literal["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"]
Style = Literal["budget", "balanced", "premium"]
Money = Annotated[Decimal, Field(ge=0, le=100000000, max_digits=12, decimal_places=2)]
Description = Annotated[str, Field(min_length=1, max_length=160, pattern=r"^[^\x00-\x1f\x7f]+$")]
ExpenseDate = Annotated[date, Field(ge=date(1900, 1, 1), le=date(9999, 12, 31))]


class BudgetModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


class CreateBudgetEntry(BudgetModel):
    id: UUID  # Client-generated identity prevents duplicate inserts after uncertain responses.
    category: Category
    entry_type: Literal["planned", "actual"]
    description: Description
    amount: Money
    currency: Currency
    expense_date: ExpenseDate | None = None


class UpdateBudgetEntry(BudgetModel):
    category: Category | None = None
    entry_type: Literal["planned", "actual"] | None = None
    description: Description | None = None
    amount: Money | None = None
    currency: Currency | None = None
    expense_date: ExpenseDate | None = None

    @model_validator(mode="after")
    def valid_patch(self):
        if not self.model_fields_set or any(
            getattr(self, key) is None for key in self.model_fields_set - {"expense_date"}
        ):
            raise ValueError("Supply valid expense fields")
        return self


class BudgetEntry(CreateBudgetEntry):
    trip_id: UUID
    source: Literal["manual"] = "manual"
    created_at: datetime
    updated_at: datetime


class HotelCost(BudgetModel):
    selection_id: UUID
    provider: Literal["stayapi"]
    source: Literal["hotel_selection"] = "hotel_selection"
    amount: Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)] | None
    currency: str | None = Field(pattern=r"^[A-Z]{3}$")
    quote_expires_at: datetime | None


class BudgetInput(BudgetModel):
    trip_id: UUID
    budget_total: Annotated[Decimal, Field(gt=0, le=100000000, decimal_places=2)]
    currency: Currency
    budget_style: Style
    travelers: int = Field(ge=1, le=20)
    start_date: date
    end_date: date
    timezone: str | None = Field(default=None, max_length=100)
    hotel: HotelCost | None = None
    entries: list[BudgetEntry] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def valid_context(self):
        if self.end_date < self.start_date:
            raise ValueError("Invalid trip dates")
        if len({entry.id for entry in self.entries}) != len(self.entries):
            raise ValueError("Duplicate entries")
        if any(
            entry.trip_id != self.trip_id or entry.currency != self.currency
            for entry in self.entries
        ):
            raise ValueError("Expenses must belong to this trip and currency")
        return self


class ValidateBudgetEntryRequest(BudgetModel):
    currency: Currency
    entry: CreateBudgetEntry


class BudgetAllocation(BudgetModel):
    category: Category
    percentage: int
    amount: Decimal


class BudgetCategorySummary(BudgetModel):
    category: Category
    allocated: Decimal
    known: Decimal
    planned: Decimal
    actual: Decimal
    committed: Decimal
    remaining: Decimal
    percent_used: Decimal | None


class KnownHotelCost(BudgetModel):
    selection_id: UUID | None
    source: Literal["hotel_selection"] = "hotel_selection"
    provider: Literal["stayapi"] | None
    amount: Decimal | None
    quote_expires_at: datetime | None
    included: bool
    exclusion_reason: (
        Literal["unavailable", "expired", "currency_mismatch", "manual_replacement"] | None
    )


class TripBudgetSummary(BudgetModel):
    trip_id: UUID
    currency: Currency
    budget_style: Style
    total_budget: Decimal
    known_costs: Decimal
    planned_costs: Decimal
    actual_costs: Decimal
    committed_costs: Decimal
    remaining_budget: Decimal
    actual_remaining_budget: Decimal
    percent_used: Decimal
    budget_status: Literal["healthy", "watch", "over_budget"]
    allocations: list[BudgetAllocation]
    categories: list[BudgetCategorySummary]
    hotel: KnownHotelCost
    unknown_costs: dict[Literal["food", "activities"], None]
    trip_days: int
    hotel_nights: int
    remaining_days: int
    budget_per_traveler: Decimal
    recommended_daily_flexible_spend: Decimal | None
    daily_flexible_spend_per_traveler: Decimal | None
    entries: list[BudgetEntry]
    insights: list[str]
    warnings: list[str]
