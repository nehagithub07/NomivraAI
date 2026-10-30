from collections import Counter

from app.core.errors import AppError
from app.providers.llm.weather_prompt import WEATHER_ADAPTATION_PROMPT_VERSION
from app.schemas.itinerary import GeneratedItinerary, ItineraryGenerationResponse
from app.schemas.weather import (
    ScheduledWeatherItem,
    WeatherAdaptationRequest,
    WeatherAdaptationResponse,
    WeatherPlanningContext,
)
from app.services.itinerary_context_service import build_planning_context
from app.services.itinerary_validation_service import resolve_itinerary, semantic_errors
from app.services.weather_risk_service import SUITABILITY, classify_setting, detect_conflicts


def scheduled_items(plan, context):
    attractions = {c.candidate_id: c for c in context.attractions}
    return [
        ScheduledWeatherItem(
            date=day.date,
            period=item.period,
            itinerary_item_id=f"{day.date}:{index}",
            candidate_id=item.candidate_id,
            candidate_type=item.candidate_type,
            title=attractions[item.candidate_id].name
            if item.candidate_id in attractions
            else "Saved activity",
            category=attractions[item.candidate_id].category
            if item.candidate_id in attractions
            else None,
        )
        for day in plan.days
        for index, item in enumerate(day.items)
    ]


def placements(plan):
    return Counter(
        (day.date, item.period, item.candidate_type, item.candidate_id)
        for day in plan.days
        for item in day.items
    )


def adaptation_errors(plan: GeneratedItinerary, context: WeatherPlanningContext):
    errors = semantic_errors(plan, context)
    before, after = placements(context.original), placements(plan)
    movable = {(c.date, c.period, "attraction", c.candidate_id) for c in context.conflicts}
    for place, count in before.items():
        if place not in movable and after[place] < count:
            errors.append("preserve_unaffected_activities_and_food_hotel_choices")
    settings = context.candidate_settings
    slots = {(day.date, p.period): p for day in context.verified_weather.days for p in day.periods}
    additions = list((after - before).elements())
    removals = list((before - after).elements())
    if len(additions) > len(removals):
        errors.append("do_not_add_unrelated_activities")
    original_themes = {day.date: day.theme for day in context.original.days}
    affected_dates = {c.date for c in context.conflicts}
    for day in plan.days:
        if day.date not in affected_dates and day.theme != original_themes.get(day.date):
            errors.append("preserve_unaffected_day_themes")
    for date, period, kind, identity in removals:
        if (date, period, kind, identity) not in movable:
            continue
        moved = [a for a in additions if a[2:] == (kind, identity)]
        replacements = [
            a
            for a in additions
            if a[:2] == (date, period) and a[2] == "attraction" and settings.get(a[3]) == "indoor"
        ]
        if not moved and not replacements:
            errors.append("keep_conflicted_activity_or_replace_with_supplied_indoor_candidate")
        for target in moved:
            source_slot, target_slot = slots.get((date, period)), slots.get(target[:2])
            setting = settings.get(identity, "unknown")
            old_score = SUITABILITY[setting][source_slot.risk.level] if source_slot else None
            new_score = (
                SUITABILITY[setting][target_slot.risk.level]
                if target_slot and target_slot.complete
                else None
            )
            if old_score is None or new_score is None or new_score <= old_score:
                errors.append("move_only_to_better_verified_weather")
    for added in additions:
        if added[2] != "attraction" or not any(
            added[2:] == removed[2:]
            or (added[:2] == removed[:2] and settings.get(added[3]) == "indoor")
            for removed in removals
            if removed in movable
        ):
            errors.append("changes_must_address_supplied_weather_conflicts")
    return sorted(set(errors))


class WeatherAdaptationService:
    def __init__(self, weather, itineraries):
        self.weather = weather
        self.itineraries = itineraries

    async def adapt(self, request: WeatherAdaptationRequest):
        if (
            self.itineraries.settings.llm_provider == "fixture"
            and self.itineraries.settings.app_env == "production"
        ):
            raise AppError(
                "ITINERARY_CONFIGURATION_ERROR",
                "Development planning is disabled in production.",
                503,
            )
        # Older saved plans may reference candidates outside the new generation shortlist.
        context = build_planning_context(request.context, trim_candidates=False)
        if semantic_errors(request.original, context):
            raise AppError(
                "WEATHER_CONTEXT_CHANGED",
                "Your saved plan or candidates changed. Generate a current itinerary first.",
                409,
            )
        source = request.forecast
        if (
            source.start_date != context.start_date
            or source.end_date != context.end_date
            or source.timezone != context.timezone
        ):
            raise AppError("WEATHER_CONTEXT_CHANGED", "Refresh your trip before adapting.", 409)
        # Never accept a client weather snapshot. Reuse only the backend's unexpired provider cache.
        forecast = await self.weather.forecast(
            source.model_copy(update={"cache_only": False, "refresh": False})
        )
        conflicts = detect_conflicts(forecast, scheduled_items(request.original, context))
        if not forecast.days or not conflicts:
            response = ItineraryGenerationResponse(
                provider=self.itineraries.settings.llm_provider,
                model_name="deterministic-fixture-v1"
                if self.itineraries.settings.llm_provider == "fixture"
                else self.itineraries.settings.gemini_itinerary_model,
                prompt_version=WEATHER_ADAPTATION_PROMPT_VERSION,
                demo=self.itineraries.settings.llm_provider == "fixture",
                itinerary=resolve_itinerary(request.original, context),
                budget=context.budget,
            )
            return WeatherAdaptationResponse(
                **response.model_dump(),
                changed=False,
                parent_version_id=request.parent_version_id,
                weather_fetched_at=forecast.fetched_at,
                remaining_conflicts=[],
                explanation="No forecast-covered conflicts need adaptation. "
                "Your saved itinerary is unchanged.",
            )
        planning = WeatherPlanningContext(
            **context.model_dump(),
            original=request.original,
            verified_weather=forecast,
            conflicts=conflicts,
            candidate_settings={
                c.candidate_id: classify_setting(c.category) for c in context.attractions
            },
            slot_scores=[
                {
                    "date": str(d.date),
                    "period": p.period,
                    "risk": p.risk.level,
                    "scores": {
                        setting: scores[p.risk.level] for setting, scores in SUITABILITY.items()
                    },
                }
                for d in forecast.days
                for p in d.periods
            ],
        )
        response = await self.itineraries.generate(
            request,
            context_override=planning,
            validator=adaptation_errors,
            prompt_version=WEATHER_ADAPTATION_PROMPT_VERSION,
        )
        # Reconstruct only the normalized ID/period plan to compare display-independent changes.
        from app.schemas.itinerary import ItineraryDay, ItineraryItem

        adapted = GeneratedItinerary(
            days=[
                ItineraryDay(
                    date=day.date,
                    day_number=day.day_number,
                    theme=day.theme.lower(),
                    items=[
                        ItineraryItem(
                            candidate_type=i.candidate_type,
                            candidate_id=i.candidate_id,
                            period=i.period,
                            reason_code=(
                                "pace_balance"
                                if i.candidate_type == "attraction"
                                else "food_option"
                                if i.candidate_type == "food"
                                else "selected_stay"
                                if i.candidate_type == "hotel"
                                else "free_time"
                            ),
                        )
                        for i in day.items
                    ],
                )
                for day in response.itinerary.days
            ]
        )
        remaining = detect_conflicts(forecast, scheduled_items(adapted, planning))
        changed = placements(adapted) != placements(request.original)
        if remaining:
            response.itinerary.warnings.append(
                "Some outdoor activities still have weather conflicts. "
                "Suitable alternatives may be limited; review before visiting."
            )
        response.itinerary.warnings.append(
            "Weather adaptation uses a forecast, not an official safety warning. "
            "Confirm current conditions locally. Budget entries are unchanged; "
            "review any affected expenses yourself."
        )
        return WeatherAdaptationResponse(
            **response.model_dump(),
            changed=changed,
            parent_version_id=request.parent_version_id,
            weather_fetched_at=forecast.fetched_at,
            remaining_conflicts=remaining,
            explanation="Created a minimally adjusted plan using verified forecasts."
            if changed
            else "No suitable improvement was found. Your saved itinerary is unchanged.",
        )
