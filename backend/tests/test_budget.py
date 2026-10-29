from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app
from app.schemas.budget import (
    BudgetEntry,
    BudgetInput,
    CreateBudgetEntry,
    UpdateBudgetEntry,
    ValidateBudgetEntryRequest,
)
from app.services.budget_service import ALLOCATION_PERCENTAGES, summarize_budget, validate_entry

TRIP = UUID("00000000-0000-4000-8000-000000000001")
NOW = datetime(2099, 4, 12, 12, tzinfo=UTC)
KEY = "test-internal-application-key-never-real"


def entry(**changes):
    return BudgetEntry.model_validate(
        dict(
            id=uuid4(),
            trip_id=TRIP,
            category="transport",
            entry_type="planned",
            description="Airport train",
            amount="28.00",
            currency="USD",
            expense_date=None,
            created_at=NOW,
            updated_at=NOW,
        )
        | changes
    )


def source(**changes):
    return BudgetInput.model_validate(
        {
            "trip_id": TRIP,
            "budget_total": "3000.00",
            "currency": "USD",
            "budget_style": "balanced",
            "travelers": 2,
            "start_date": "2099-04-12",
            "end_date": "2099-04-14",
            "timezone": "UTC",
            **changes,
        }
    )


def hotel(**changes):
    return (
        dict(
            selection_id=uuid4(),
            provider="stayapi",
            amount="600.00",
            currency="USD",
            quote_expires_at=NOW + timedelta(minutes=10),
        )
        | changes
    )


@pytest.mark.parametrize(
    "style,percentages",
    [
        ("budget", [30, 25, 15, 20, 10]),
        ("balanced", [35, 25, 20, 12, 8]),
        ("premium", [45, 25, 15, 10, 5]),
    ],
)
def test_allocation_policies(style, percentages):
    result = summarize_budget(source(budget_style=style), now=NOW)
    assert list(ALLOCATION_PERCENTAGES[style].values()) == percentages
    assert [a.percentage for a in result.allocations] == percentages
    assert sum(a.percentage for a in result.allocations) == 100
    assert sum(a.amount for a in result.allocations) == Decimal("3000.00")
    assert [a.amount for a in result.allocations] == [Decimal(p) * 30 for p in percentages]


@pytest.mark.parametrize("total", ["0.01", "0.03", "10.01", "99.99", "100000000.00"])
def test_allocation_remainder_never_loses_or_creates_money(total):
    for style in ALLOCATION_PERCENTAGES:
        result = summarize_budget(source(budget_total=total, budget_style=style), now=NOW)
        assert sum(a.amount for a in result.allocations) == Decimal(total)
        assert all(a.amount >= 0 for a in result.allocations)


def test_real_hotel_known_cost_provenance_and_no_invented_food_activity_prices():
    result = summarize_budget(source(hotel=hotel()), now=NOW)
    assert result.known_costs == Decimal("600.00")
    assert result.hotel.source == "hotel_selection" and result.hotel.provider == "stayapi"
    assert result.hotel.included
    assert result.unknown_costs == {"food": None, "activities": None}
    assert result.categories[1].committed == 0 and result.categories[2].committed == 0
    assert result.remaining_budget == Decimal("2400.00")


@pytest.mark.parametrize(
    "changes,reason",
    [
        ({"amount": None}, "unavailable"),
        ({"quote_expires_at": NOW}, "expired"),
        ({"quote_expires_at": None}, "expired"),
        ({"currency": "EUR"}, "currency_mismatch"),
        ({"currency": "CHF"}, "currency_mismatch"),
        ({"quote_expires_at": datetime(2099, 4, 13)}, "expired"),
    ],
)
def test_missing_expired_foreign_or_naive_hotel_quote_not_counted(changes, reason):
    result = summarize_budget(source(hotel=hotel(**changes)), now=NOW)
    assert result.known_costs == 0 and result.hotel.amount is None
    assert not result.hotel.included and result.hotel.exclusion_reason == reason


def test_no_selected_hotel_is_unknown_not_a_fabricated_zero_price():
    result = summarize_budget(source(), now=NOW)
    assert result.hotel.amount is None and result.known_costs == 0
    assert result.remaining_budget == Decimal("3000.00")
    assert any("No current" in warning for warning in result.warnings)


def test_planned_actual_remaining_and_daily_per_person_math():
    result = summarize_budget(
        source(
            hotel=hotel(),
            entries=[
                entry(amount="200.00"),
                entry(category="food", entry_type="actual", amount="100.00"),
            ],
        ),
        now=NOW,
    )
    assert result.known_costs == 600
    assert result.planned_costs == 200 and result.actual_costs == 100
    assert result.committed_costs == 900 and result.remaining_budget == 2100
    assert result.actual_remaining_budget == 2900
    assert result.budget_per_traveler == 1500
    assert result.recommended_daily_flexible_spend == 700
    assert result.daily_flexible_spend_per_traveler == 350
    assert result.trip_days == 3 and result.hotel_nights == 2


@pytest.mark.parametrize(
    "used,status",
    [("2249.99", "healthy"), ("2250", "watch"), ("3000", "watch"), ("3000.01", "over_budget")],
)
def test_status_thresholds_use_exact_decimal_before_rounding(used, status):
    result = summarize_budget(source(entries=[entry(amount=used)]), now=NOW)
    assert result.budget_status == status
    assert result.recommended_daily_flexible_spend >= 0


def test_hotel_manual_replacement_never_double_counts_even_if_actual_or_zero():
    for amount in ["600.00", "0.00"]:
        for kind in ["planned", "actual"]:
            result = summarize_budget(
                source(
                    hotel=hotel(),
                    entries=[
                        entry(category="accommodation", entry_type=kind, amount=amount),
                    ],
                ),
                now=NOW,
            )
            assert result.known_costs == 0
            assert result.committed_costs == Decimal(amount)
            assert result.hotel.exclusion_reason == "manual_replacement"
            assert any("entire automatic hotel quote" in text for text in result.warnings)


def test_marking_plan_actual_replaces_not_adds_cost():
    before = entry(amount="42.00")
    after = before.model_copy(update={"entry_type": "actual"})
    planned = summarize_budget(source(entries=[before]), now=NOW)
    actual = summarize_budget(source(entries=[after]), now=NOW)
    assert planned.committed_costs == actual.committed_costs == 42
    assert actual.actual_costs == 42 and actual.planned_costs == 0


def test_decimal_precision_and_round_down_daily_guidance():
    result = summarize_budget(
        source(
            budget_total="1.00",
            entries=[
                entry(amount="0.10"),
                entry(amount="0.20"),
            ],
        ),
        now=NOW,
    )
    assert result.committed_costs == Decimal("0.30")
    assert result.remaining_budget == Decimal("0.70")
    assert result.recommended_daily_flexible_spend == Decimal("0.23")
    assert result.daily_flexible_spend_per_traveler == Decimal("0.11")
    assert result.model_dump(mode="json")["remaining_budget"] == "0.70"


@pytest.mark.parametrize(
    "current,remaining",
    [("2099-04-01", 3), ("2099-04-13", 2), ("2099-04-14", 1), ("2099-04-15", 0)],
)
def test_remaining_days_before_during_after_trip(current, remaining):
    result = summarize_budget(source(), now=datetime.fromisoformat(current).replace(tzinfo=UTC))
    assert result.remaining_days == remaining
    if remaining == 0:
        assert result.recommended_daily_flexible_spend is None


def test_destination_timezone_and_single_day_nights():
    result = summarize_budget(
        source(timezone="Asia/Tokyo"), now=datetime(2099, 4, 12, 23, tzinfo=UTC)
    )
    assert result.remaining_days == 2
    assert summarize_budget(source(end_date="2099-04-12"), now=NOW).hotel_nights == 0


@pytest.mark.parametrize("amount", ["-0.01", "NaN", "Infinity", "100000000.01", "1.001"])
def test_invalid_amounts_rejected(amount):
    with pytest.raises(ValidationError):
        entry(amount=amount)


def test_zero_valid_but_invalid_category_description_date_currency_rejected():
    assert entry(amount="0.00").amount == 0
    for change in [
        {"category": "other"},
        {"description": " "},
        {"description": "line\nbreak"},
        {"expense_date": "2099-02-30"},
        {"currency": "XYZ"},
    ]:
        with pytest.raises(ValidationError):
            entry(**change)
    for patch in [
        {},
        {"amount": None},
        {"description": None},
        {"currency": "JPY", "source": "provider"},
    ]:
        with pytest.raises(ValidationError):
            UpdateBudgetEntry.model_validate(patch)


def test_cross_trip_duplicate_and_currency_contexts_rejected():
    row = entry()
    for rows in [[row, row], [entry(trip_id=uuid4())], [entry(currency="EUR")]]:
        with pytest.raises(ValidationError):
            source(entries=rows)
    data = row.model_dump(exclude={"trip_id", "source", "created_at", "updated_at"})
    with pytest.raises(Exception) as failure:
        validate_entry(ValidateBudgetEntryRequest(currency="EUR", entry=CreateBudgetEntry(**data)))
    assert failure.value.code == "BUDGET_CURRENCY_MISMATCH"


async def test_budget_endpoints_require_internal_auth_and_hide_invalid_input():
    app = create_app(Settings(_env_file=None, nomvira_internal_api_key=KEY))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (
            await client.post("/api/v1/budget/summary", json=source().model_dump(mode="json"))
        ).status_code == 401
        headers = {"X-Nomvira-Internal-Key": KEY}
        response = await client.post(
            "/api/v1/budget/summary", json=source().model_dump(mode="json"), headers=headers
        )
        assert response.status_code == 200 and response.json()["remaining_budget"] == "3000.00"
        invalid = source().model_dump(mode="json") | {"budget_total": "PRIVATE-invalid"}
        response = await client.post("/api/v1/budget/summary", json=invalid, headers=headers)
        assert response.status_code == 422 and "PRIVATE" not in response.text
        row = entry().model_dump(
            mode="json", exclude={"trip_id", "source", "created_at", "updated_at"}
        )
        response = await client.post(
            "/api/v1/budget/entries/validate",
            json={"currency": "EUR", "entry": row},
            headers=headers,
        )
        assert (
            response.status_code == 422
            and response.json()["error"]["code"] == "BUDGET_CURRENCY_MISMATCH"
        )
