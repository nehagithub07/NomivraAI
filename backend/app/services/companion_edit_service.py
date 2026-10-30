"""Deterministic edits reuse the itinerary semantic validator and fact hydrator."""

from app.core.errors import AppError
from app.schemas.companion import CompanionEditRequest
from app.schemas.itinerary import GeneratedItinerary
from app.services.itinerary_context_service import build_planning_context
from app.services.itinerary_validation_service import resolve_itinerary, semantic_errors


def edit_itinerary(request: CompanionEditRequest):
    context = build_planning_context(request.context)
    original = GeneratedItinerary.model_validate(request.original)
    plan = original.model_copy(deep=True)
    args = request.arguments
    matches = [
        (day, item)
        for day in plan.days
        for item in day.items
        if item.candidate_type == "attraction" and item.candidate_id == args.get("candidate_id")
    ]
    if len(matches) != 1 or semantic_errors(original, context):
        raise AppError(
            "COMPANION_INVALID_ARGUMENTS",
            "Load a current itinerary and choose one of its activities.",
            422,
        )
    source, item = matches[0]
    if request.tool_name == "move_itinerary_activity":
        targets = [day for day in plan.days if str(day.date) == args.get("target_date")]
        if not targets or args.get("target_period") not in ("morning", "afternoon", "evening"):
            raise AppError(
                "COMPANION_INVALID_DATE", "Choose a date and period within this trip.", 422
            )
        source.items.remove(item)
        item.period = args["target_period"]
        targets[0].items.append(item)
    else:
        item.candidate_id = args.get("replacement_candidate_id")
    for day in plan.days:
        day.items.sort(key=lambda item: ("morning", "afternoon", "evening").index(item.period))
    if semantic_errors(plan, context) or any(not day.items for day in plan.days):
        raise AppError(
            "COMPANION_INVALID_ARGUMENTS",
            "That change exceeds your pace or uses an unavailable place.",
            422,
        )
    return {"itinerary": resolve_itinerary(plan, context).model_dump(mode="json")}
