from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_internal_key
from app.companion.tool_executor import validate_call
from app.schemas.companion import (
    CompanionActionValidation,
    CompanionChatRequest,
    CompanionEditRequest,
    CompanionStep,
)
from app.services.companion_edit_service import edit_itinerary

router = APIRouter(prefix="/companion", dependencies=[Depends(require_internal_key)])


@router.post("/chat", response_model=CompanionStep)
async def chat(request: Request, body: CompanionChatRequest):
    return await request.app.state.companion.chat(body)


@router.post("/actions/validate")
async def validate_action(body: CompanionActionValidation):
    return {
        "arguments": validate_call(
            body.tool_name, body.arguments, body.context, body.original_message
        )
    }


@router.post("/itinerary/edit")
async def edit(body: CompanionEditRequest):
    return edit_itinerary(body)
