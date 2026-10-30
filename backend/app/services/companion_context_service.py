import re
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.errors import AppError
from app.schemas.companion import CompanionContext


def destination_today(context: CompanionContext, now: datetime | None = None):
    try:
        if not context.timezone:
            return None
        return (now or datetime.now(UTC)).astimezone(ZoneInfo(context.timezone)).date()
    except (ZoneInfoNotFoundError, ValueError):
        return None


def resolve_trip_date(value: str, context: CompanionContext, now: datetime | None = None) -> str:
    value = value.strip().lower()
    today = destination_today(context, now)
    match = re.fullmatch(r"day[_ ]([1-9]|1[0-4])", value)
    if match:
        result = context.start_date + timedelta(days=int(match[1])-1)
    elif value in ("today", "tonight", "tomorrow"):
        if today is None:
            raise AppError("COMPANION_INVALID_DATE", "Choose a calendar date; destination timezone is unavailable.", 422)
        result = today + timedelta(days=value == "tomorrow")
    elif value == "next_day":
        if context.reference_date is None:
            raise AppError("COMPANION_INVALID_DATE", "Specify which day you mean before asking for the next day.", 422)
        result = context.reference_date + timedelta(days=1)
    elif value in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday"):
        weekday = ("monday","tuesday","wednesday","thursday","friday","saturday","sunday").index(value)
        first = context.start_date + timedelta(days=(weekday-context.start_date.weekday()) % 7)
        if first > context.end_date or first + timedelta(days=7) <= context.end_date:
            raise AppError("COMPANION_INVALID_DATE", "Choose a calendar date or trip day number.", 422)
        result = first
    else:
        try:
            result = date.fromisoformat(value)
        except ValueError:
            raise AppError("COMPANION_INVALID_DATE", "Choose a calendar date or trip day number.", 422) from None
    if not context.start_date <= result <= context.end_date:
        raise AppError("COMPANION_INVALID_DATE", "That date is outside this trip.", 422)
    return result.isoformat()


def compact_context(context: CompanionContext):
    if context.end_date < context.start_date:
        raise AppError("COMPANION_INVALID_CONTEXT", "Reload your saved trip.", 422)
    return {**context.model_dump(mode="json"), "destination_today": str(destination_today(context)) if destination_today(context) else None,
            "trip_days": (context.end_date-context.start_date).days+1}
