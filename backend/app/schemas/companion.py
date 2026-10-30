from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.itinerary import Interest, PlanningInput, StrictModel

Text = Annotated[str, Field(min_length=1, max_length=2000, pattern=r"^[^\x00]+$")]
ToolName = Literal[
    "get_trip_overview",
    "get_itinerary",
    "get_weather",
    "get_budget_summary",
    "get_selected_hotel",
    "get_saved_food",
    "get_discovered_places",
    "get_trip_preferences",
    "find_trip_places",
    "find_food_options",
    "find_hotel_options",
    "add_budget_entry",
    "move_itinerary_activity",
    "replace_itinerary_activity",
    "create_itinerary_version",
    "adapt_itinerary_for_weather",
    "select_hotel",
    "save_food_selection",
]


class CompanionContext(StrictModel):
    destination: str = Field(min_length=1, max_length=160)
    country: str | None = Field(default=None, max_length=160)
    timezone: str | None = Field(default=None, max_length=100)
    start_date: date
    end_date: date
    travelers: int = Field(ge=1, le=20)
    currency: Literal["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"]
    budget_style: Literal["budget", "balanced", "premium"]
    travel_pace: Literal["relaxed", "balanced", "packed"]
    interests: list[Interest] = Field(max_length=12)
    dietary_preferences: list[str] = Field(max_length=5)
    accommodation_preferences: list[str] = Field(max_length=5)
    itinerary_version: UUID | None = None
    selected_hotel: bool = False
    saved_food_count: int = Field(ge=0)
    discovered_place_count: int = Field(ge=0)
    reference_date: date | None = None
    budget_summary: dict | None = None
    weather_availability: str = "not_loaded"
    selected_hotel_name: str | None = Field(default=None, max_length=300)


class ChatHistoryMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: Text


class ToolCall(StrictModel):
    id: str = Field(min_length=1, max_length=150)
    name: ToolName
    arguments: dict
    permission: Literal["READ", "WRITE_CONFIRMATION_REQUIRED"]


class ToolResult(StrictModel):
    call_id: str = Field(min_length=1, max_length=150)
    name: ToolName
    status: Literal["ok", "unavailable", "invalid_arguments", "confirmation_required"]
    data: dict


class CompanionChatRequest(StrictModel):
    user_id: UUID
    trip_id: UUID
    message: Text | None = None
    context: CompanionContext | None = None
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=12)
    continuation_id: str | None = Field(default=None, min_length=32, max_length=100)
    results: list[ToolResult] = Field(default_factory=list, max_length=5)


class CompanionCard(StrictModel):
    tool_name: ToolName
    data: dict


class CompanionResponse(StrictModel):
    message: str = Field(max_length=2000)
    cards: list[CompanionCard] = Field(default_factory=list, max_length=5)
    suggested_actions: list[str] = Field(default_factory=list, max_length=3)
    pending_call: ToolCall | None = None
    tool_audit: list[dict] = Field(default_factory=list, max_length=5)
    prompt_version: str
    model_name: str
    demo: bool
    reference_date: date | None = None


class CompanionStep(StrictModel):
    continuation_id: str | None = None
    calls: list[ToolCall] = Field(default_factory=list, max_length=5)
    response: CompanionResponse | None = None


class CompanionActionValidation(StrictModel):
    context: CompanionContext
    tool_name: ToolName
    arguments: dict
    original_message: Text


class CompanionEditRequest(StrictModel):
    context: PlanningInput
    original: dict
    tool_name: Literal["move_itinerary_activity", "replace_itinerary_activity"]
    arguments: dict
