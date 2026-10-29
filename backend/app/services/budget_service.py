from datetime import UTC, date, datetime
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.errors import AppError
from app.schemas.budget import (
    BudgetAllocation,
    BudgetCategorySummary,
    BudgetInput,
    KnownHotelCost,
    TripBudgetSummary,
    ValidateBudgetEntryRequest,
)

# Integers make the allocation policy auditable; all money stays Decimal.
ALLOCATION_PERCENTAGES = {
    "budget": dict(accommodation=30, food=25, activities=15, transport=20, miscellaneous=10),
    "balanced": dict(accommodation=35, food=25, activities=20, transport=12, miscellaneous=8),
    "premium": dict(accommodation=45, food=25, activities=15, transport=10, miscellaneous=5),
}
assert all(sum(policy.values()) == 100 for policy in ALLOCATION_PERCENTAGES.values())
CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def percent(used: Decimal, total: Decimal) -> Decimal:
    return money(used * 100 / total) if total else ZERO


def validate_entry(body: ValidateBudgetEntryRequest):
    if body.currency != body.entry.currency:
        raise AppError("BUDGET_CURRENCY_MISMATCH", "Use your trip's currency for expenses.", 422)
    return body.entry


def summarize_budget(source: BudgetInput, *, now: datetime | None = None) -> TripBudgetSummary:
    now = now or datetime.now(UTC)
    warnings = [
        "Food and attraction prices are unknown unless you enter them. "
        "Allocations are suggestions.",
        "Known hotel costs are quotes, not confirmed bookings or payments.",
    ]
    try:
        today = now.astimezone(ZoneInfo(source.timezone or "UTC")).date()
    except (ZoneInfoNotFoundError, ValueError):
        today = now.date()
        warnings.append("Destination timezone is unavailable; daily guidance uses UTC.")
    return _summarize(source, now, today, warnings)


def _summarize(source: BudgetInput, now: datetime, today: date, warnings: list[str]):
    allocations = []
    allocated = ZERO
    policy = ALLOCATION_PERCENTAGES[source.budget_style]
    for index, (category, percentage) in enumerate(policy.items()):
        # Assign the rounding remainder to the final category: the sum always equals the budget.
        amount = (
            money(source.budget_total - allocated)
            if index == len(policy) - 1
            else (source.budget_total * percentage / 100).quantize(CENT, rounding=ROUND_DOWN)
        )
        allocated += amount
        allocations.append(
            BudgetAllocation(category=category, percentage=percentage, amount=amount)
        )

    hotel = source.hotel
    known = KnownHotelCost(
        selection_id=hotel.selection_id if hotel else None,
        provider=hotel.provider if hotel else None,
        amount=None,
        quote_expires_at=hotel.quote_expires_at if hotel else None,
        included=False,
        exclusion_reason="unavailable",
    )
    if hotel and hotel.amount is not None:
        expiry = hotel.quote_expires_at
        if hotel.currency != source.currency:
            known.exclusion_reason = "currency_mismatch"
        elif not expiry or not expiry.tzinfo or expiry <= now:
            known.exclusion_reason = "expired"
        else:
            known.amount = money(hotel.amount)
            known.included = True
            known.exclusion_reason = None
    if any(entry.category == "accommodation" for entry in source.entries):
        known.included = False
        known.exclusion_reason = "manual_replacement"
        warnings.append(
            "Manual accommodation entries replace the entire automatic hotel quote. "
            "Enter the full expected accommodation cost, including any unpaid balance."
        )
    elif not known.included:
        warnings.append(
            "No current matching-currency hotel price is included. "
            "Refresh Hotels or add a manual accommodation estimate."
        )

    categories = []
    for allocation in allocations:
        rows = [entry for entry in source.entries if entry.category == allocation.category]
        planned = money(
            sum((entry.amount for entry in rows if entry.entry_type == "planned"), ZERO)
        )
        actual = money(sum((entry.amount for entry in rows if entry.entry_type == "actual"), ZERO))
        automatic = (
            known.amount if allocation.category == "accommodation" and known.included else ZERO
        )
        committed = automatic + planned + actual
        categories.append(
            BudgetCategorySummary(
                category=allocation.category,
                allocated=allocation.amount,
                known=automatic,
                planned=planned,
                actual=actual,
                committed=committed,
                remaining=allocation.amount - committed,
                percent_used=percent(committed, allocation.amount) if allocation.amount else None,
            )
        )
    known_total = sum((c.known for c in categories), ZERO)
    planned_total = sum((c.planned for c in categories), ZERO)
    actual_total = sum((c.actual for c in categories), ZERO)
    committed = known_total + planned_total + actual_total
    remaining = money(source.budget_total - committed)
    remaining_days = max(0, (source.end_date - max(today, source.start_date)).days + 1)
    daily = (
        (max(ZERO, remaining) / remaining_days).quantize(CENT, rounding=ROUND_DOWN)
        if remaining_days
        else None
    )
    status = (
        "over_budget"
        if committed > source.budget_total
        else ("watch" if committed * 100 >= source.budget_total * 75 else "healthy")
    )
    insights = [
        {
            "healthy": "Your known, planned and actual costs are currently within budget.",
            "watch": "Your known, planned and actual costs use at least 75% of your budget.",
            "over_budget": "Your known, planned and actual costs currently exceed your budget.",
        }[status]
    ]
    if known.included and categories[0].allocated:
        insights.append(
            f"Your selected hotel uses {percent(known.amount, categories[0].allocated)}% "
            "of your accommodation allocation."
        )
    if daily is not None:
        insights.append(
            f"You have {source.currency} {daily:.2f} per remaining trip day "
            "for unassigned spending. "
            "Already planned expenses have been reserved."
        )
    return TripBudgetSummary(
        trip_id=source.trip_id,
        currency=source.currency,
        budget_style=source.budget_style,
        total_budget=money(source.budget_total),
        known_costs=known_total,
        planned_costs=planned_total,
        actual_costs=actual_total,
        committed_costs=committed,
        remaining_budget=remaining,
        actual_remaining_budget=money(source.budget_total - actual_total),
        percent_used=percent(committed, source.budget_total),
        budget_status=status,
        allocations=allocations,
        categories=categories,
        hotel=known,
        unknown_costs={"food": None, "activities": None},
        trip_days=(source.end_date - source.start_date).days + 1,
        hotel_nights=(source.end_date - source.start_date).days,
        remaining_days=remaining_days,
        budget_per_traveler=(source.budget_total / source.travelers).quantize(
            CENT, rounding=ROUND_DOWN
        ),
        recommended_daily_flexible_spend=daily,
        daily_flexible_spend_per_traveler=(daily / source.travelers).quantize(
            CENT, rounding=ROUND_DOWN
        )
        if daily is not None
        else None,
        entries=source.entries,
        insights=insights,
        warnings=warnings,
    )
