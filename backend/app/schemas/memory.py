from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TravelPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    interests: list[
        Literal[
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
    ] = Field(max_length=8)
    travelPace: Literal["relaxed", "balanced", "packed"]
    budgetStyle: Literal["budget", "balanced", "premium"]
    dietaryPreferences: list[
        Literal[
            "vegetarian",
            "vegan",
            "halal",
            "kosher",
            "gluten_free",
        ]
    ] = Field(max_length=5)
    accommodationPreferences: list[
        Literal[
            "hotel",
            "hostel",
            "homestay",
            "apartment",
            "resort",
        ]
    ] = Field(min_length=1, max_length=5)


class RetrievedMemory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    kind: Literal["preference", "feedback", "trip"]
    feedback: Literal["prefer", "avoid"]
    preferences: TravelPreferences
