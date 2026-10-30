from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from app.companion.permissions import ToolPermission
from app.schemas.itinerary import StrictModel


class EmptyInput(StrictModel):
    pass


class DateInput(StrictModel):
    date: str | None = Field(
        default=None,
        max_length=32,
        description=(
            "ISO date, today/tomorrow/tonight/next_day, day_2, or weekday. Current trip only."
        ),
    )


class FindInput(StrictModel):
    query: str = Field(default="", max_length=80)
    category: str | None = Field(default=None, max_length=40)
    dietary_preference: Literal["vegetarian", "vegan", "halal", "kosher", "gluten_free"] | None = (
        None
    )
    limit: int = Field(default=5, ge=1, le=10)
    cuisine: str | None = Field(default=None, max_length=80)
    near_selected_hotel: bool = False
    max_total: str | None = Field(default=None, pattern=r"^\d{1,9}(?:\.\d{1,2})?$")


class BudgetInput(StrictModel):
    description: str = Field(min_length=1, max_length=160, pattern=r"^[^\x00-\x1f\x7f]+$")
    category: Literal["accommodation", "food", "activities", "transport", "miscellaneous"]
    entry_type: Literal["planned", "actual"] = "planned"
    amount: str = Field(pattern=r"^\d{1,9}(?:\.\d{1,2})?$")
    currency: Literal["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"]
    expense_date: str | None = Field(default=None, max_length=32)


class MoveInput(StrictModel):
    candidate_id: str = Field(pattern=r"^(node|way|relation)/[1-9][0-9]{0,18}$")
    target_date: str = Field(min_length=1, max_length=32)
    target_period: Literal["morning", "afternoon", "evening"]


class ReplaceInput(StrictModel):
    candidate_id: str = Field(pattern=r"^(node|way|relation)/[1-9][0-9]{0,18}$")
    replacement_candidate_id: str = Field(pattern=r"^(node|way|relation)/[1-9][0-9]{0,18}$")


class HotelInput(StrictModel):
    provider_accommodation_id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")


class FoodInput(StrictModel):
    provider_place_id: str = Field(min_length=1, max_length=512)


class RespondInput(StrictModel):
    intent: Literal[
        "overview",
        "itinerary",
        "budget",
        "weather",
        "hotel",
        "food",
        "places",
        "preferences",
        "options",
        "proposal",
        "unavailable",
        "unsupported",
        "greeting",
        "clarify",
    ]
    reference_call_ids: list[str] = Field(default_factory=list, max_length=5)
    message: str = Field(
        default="",
        max_length=2000,
        description=(
            "Concise grounded explanation using successful tool facts only. N"
            "ever claim an unconfirmed change succeeded."
        ),
    )


@dataclass(frozen=True)
class CompanionTool:
    name: str
    description: str
    input_schema: type[StrictModel]
    permission: ToolPermission = ToolPermission.READ


WRITE = ToolPermission.WRITE_CONFIRMATION_REQUIRED
TOOLS = {
    tool.name: tool
    for tool in [
        CompanionTool(
            "get_trip_overview",
            "Read the current trip's saved destination, dates and travelers.",
            EmptyInput,
        ),
        CompanionTool(
            "get_itinerary",
            "Read the current itinerary, optionally for one deterministically resolved trip date.",
            DateInput,
        ),
        CompanionTool(
            "get_weather",
            "Read verified weather availability, forecasts and itinerary conflicts for this trip.",
            DateInput,
        ),
        CompanionTool(
            "get_budget_summary",
            "Read deterministic budget totals; never calculate money yourself.",
            EmptyInput,
        ),
        CompanionTool(
            "get_selected_hotel",
            "Read the selected stay. Current details may be expired. A selection is not a booking.",
            EmptyInput,
        ),
        CompanionTool(
            "get_saved_food",
            "Read saved food references and known dietary metadata; unknown is not suitable.",
            FindInput,
        ),
        CompanionTool(
            "get_discovered_places",
            "Read the current trip's real persisted attraction candidates.",
            FindInput,
        ),
        CompanionTool(
            "get_trip_preferences",
            "Read the trip's stored interests, pace and dietary/accommodation preferences.",
            EmptyInput,
        ),
        CompanionTool(
            "find_trip_places",
            "Find existing discovered attractions by literal name/category. Never invent a venue.",
            FindInput,
        ),
        CompanionTool(
            "find_food_options",
            (
                "Filter existing cached food candidates, honoring explicit dietar"
                "y metadata. If empty, ask user to search Food."
            ),
            FindInput,
        ),
        CompanionTool(
            "find_hotel_options",
            (
                "Find existing current hotel recommendations. Price order uses re"
                "al comparable quotes. If missing, ask user to search Hotels."
            ),
            FindInput,
        ),
        CompanionTool(
            "add_budget_entry",
            (
                "Propose an expense using an amount explicitly supplied by the us"
                "er. Requires a confirmation card; does not write yet."
            ),
            BudgetInput,
            WRITE,
        ),
        CompanionTool(
            "move_itinerary_activity",
            (
                "Propose moving one existing attraction to another trip date/peri"
                "od in a NEW version. Requires confirmation."
            ),
            MoveInput,
            WRITE,
        ),
        CompanionTool(
            "replace_itinerary_activity",
            (
                "Propose replacing an attraction with another real supplied candi"
                "date, preserving its slot in a NEW version. Requires confirmatio"
                "n."
            ),
            ReplaceInput,
            WRITE,
        ),
        CompanionTool(
            "create_itinerary_version",
            (
                "Propose generating a new itinerary version with existing prefere"
                "nces. Requires confirmation."
            ),
            EmptyInput,
            WRITE,
        ),
        CompanionTool(
            "adapt_itinerary_for_weather",
            (
                "Propose existing weather adaptation; only user confirmation runs"
                " it and may create a new version."
            ),
            EmptyInput,
            WRITE,
        ),
        CompanionTool(
            "select_hotel",
            (
                "Propose changing the selected real cached hotel reference. Does "
                "NOT book. Requires confirmation."
            ),
            HotelInput,
            WRITE,
        ),
        CompanionTool(
            "save_food_selection",
            "Propose saving a real cached food option. Does NOT reserve. Requires confirmation.",
            FoodInput,
            WRITE,
        ),
    ]
}


def declarations():
    result = [
        {
            "name": tool.name,
            "description": tool.description,
            "parameters_json_schema": tool.input_schema.model_json_schema(),
        }
        for tool in TOOLS.values()
    ]
    result.append(
        {
            "name": "respond",
            "description": (
                "Finish with a grounded explanation, response intent and successful "
                "tool call references."
            ),
            "parameters_json_schema": RespondInput.model_json_schema(),
        }
    )
    return result
