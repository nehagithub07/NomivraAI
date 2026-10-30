import json
import re
from decimal import Decimal

from pydantic import ValidationError

from app.companion.permissions import ToolPermission, may_propose_write
from app.companion.tool_registry import TOOLS
from app.core.errors import AppError
from app.schemas.companion import CompanionContext, ToolCall, ToolResult
from app.services.companion_context_service import resolve_trip_date

FORBIDDEN_KEYS = {
    "authorization",
    "headers",
    "cookie",
    "cookies",
    "selection_proof",
    "signature",
    "payload",
    "raw",
    "owner_id",
    "user_id",
    "trip_id",
    "service_role_key",
    "api_key",
}


def validate_call(name: str, arguments: dict, context: CompanionContext, message: str):
    tool = TOOLS.get(name)
    if tool is None:
        raise AppError("COMPANION_INVALID_TOOL", "That tool is not available.", 422)
    try:
        args = tool.input_schema.model_validate(arguments).model_dump(mode="json")
    except ValidationError:
        raise AppError(
            "COMPANION_INVALID_ARGUMENTS", "Check the requested trip details.", 422
        ) from None
    if tool.permission == ToolPermission.WRITE_CONFIRMATION_REQUIRED and not may_propose_write(
        message
    ):
        raise AppError(
            "COMPANION_CONFIRMATION_REQUIRED",
            "Ask for a concrete change before proposing an action.",
            422,
        )
    for key in ("date", "target_date", "expense_date"):
        if args.get(key):
            args[key] = resolve_trip_date(args[key], context)
    if name == "add_budget_entry":
        if args["currency"] != context.currency or Decimal(args["amount"]) > 100000000:
            raise AppError(
                "COMPANION_INVALID_ARGUMENTS", "Use the trip currency and a valid amount.", 422
            )
        text = re.sub(r"\bday\s*\d+\b|\d{4}-\d{2}-\d{2}", "", message, flags=re.I)
        amounts = [
            Decimal(value.replace(",", "")) for value in re.findall(r"\d[\d,]*(?:\.\d{1,2})?", text)
        ]
        if Decimal(args["amount"]) not in amounts:
            raise AppError(
                "COMPANION_INVALID_ARGUMENTS", "Enter the expense amount explicitly.", 422
            )
        currency_markers = {
            "EUR": r"€|\bEUR\b|\beuros?\b",
            "GBP": r"£|\bGBP\b|\bpounds?\b",
            "INR": r"₹|\bINR\b|\brupees?\b",
            "JPY": r"¥|\bJPY\b|\byen\b",
            "USD": r"\bUSD\b",
            "CAD": r"\bCAD\b",
            "AUD": r"\bAUD\b",
        }
        if any(
            code != context.currency and re.search(pattern, message, re.I)
            for code, pattern in currency_markers.items()
        ):
            raise AppError(
                "COMPANION_INVALID_ARGUMENTS", "Currency conversion is not supported.", 422
            )
        args["amount"] = f"{Decimal(args['amount']):.2f}"
    return args


def checked_result(result: ToolResult, call: ToolCall):
    if result.call_id != call.id or result.name != call.name:
        raise AppError("COMPANION_INVALID_RESULT", "Reload the companion and try again.", 422)

    def walk(value):
        if isinstance(value, dict):
            if any(str(key).lower() in FORBIDDEN_KEYS for key in value):
                raise AppError(
                    "COMPANION_INVALID_RESULT", "Tool data could not be safely used.", 502
                )
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    if len(json.dumps(result.data).encode()) > 32000:
        raise AppError("COMPANION_INVALID_RESULT", "Tool data is too large.", 502)
    walk(result.data)
    if call.permission == "WRITE_CONFIRMATION_REQUIRED" and result.status not in (
        "confirmation_required",
        "invalid_arguments",
        "unavailable",
    ):
        raise AppError("COMPANION_INVALID_RESULT", "Changes require confirmation first.", 502)
    return result
