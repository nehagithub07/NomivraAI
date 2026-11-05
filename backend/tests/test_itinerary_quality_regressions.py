import pytest
from test_itineraries import fixture_plan, planning

from app.services.itinerary_validation_service import resolve_itinerary, semantic_errors


@pytest.mark.asyncio
async def test_resolved_itinerary_preserves_insufficient_candidates_warning():
    plan, context = await fixture_plan()

    assert not any(
        "not enough saved places" in warning.lower()
        for warning in resolve_itinerary(plan, context).warnings
    )

    plan.warnings = ["insufficient_candidates"]
    result = resolve_itinerary(plan, context)

    assert any(
        "not enough saved places" in warning.lower() for warning in result.warnings
    )


@pytest.mark.asyncio
async def test_each_day_requires_an_attraction_when_candidates_cover_every_day():
    plan, context = await fixture_plan()
    plan.days[1].items = [
        item for item in plan.days[1].items if item.candidate_type != "attraction"
    ]

    assert "daily_attraction_required" in semantic_errors(plan, context)


@pytest.mark.asyncio
async def test_daily_attraction_requirement_relaxes_when_candidates_are_insufficient():
    source = planning(attractions=planning().attractions[:2])
    plan, context = await fixture_plan(source)

    assert "daily_attraction_required" not in semantic_errors(plan, context)
