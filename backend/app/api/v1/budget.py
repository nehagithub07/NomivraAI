from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_key
from app.schemas.budget import (
    BudgetInput,
    CreateBudgetEntry,
    TripBudgetSummary,
    ValidateBudgetEntryRequest,
)
from app.services.budget_service import summarize_budget, validate_entry

router = APIRouter(prefix="/budget", dependencies=[Depends(require_internal_key)])


# Like itinerary generation, authoritative data is loaded by the authenticated BFF.
# FastAPI has no database credentials and never trusts a browser-supplied trip context.
@router.post("/summary", response_model=TripBudgetSummary)
async def summary(body: BudgetInput) -> TripBudgetSummary:
    return summarize_budget(body)


@router.post("/entries/validate", response_model=CreateBudgetEntry)
async def validate(body: ValidateBudgetEntryRequest) -> CreateBudgetEntry:
    return validate_entry(body)
