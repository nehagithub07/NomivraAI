import asyncio
import logging
import time
from collections import OrderedDict

from app.core.config import Settings
from app.core.errors import AppError
from app.providers.llm.base import LLMProvider
from app.providers.llm.fixture import FixtureLLMProvider
from app.providers.llm.gemini import MESSAGE, GeminiLLMProvider
from app.providers.llm.prompt import ITINERARY_PROMPT_VERSION
from app.schemas.itinerary import ItineraryGenerationRequest, ItineraryGenerationResponse
from app.services.itinerary_context_service import build_planning_context
from app.services.itinerary_validation_service import resolve_itinerary, semantic_errors

logger = logging.getLogger("nomvira.itinerary")


class ItineraryGenerationService:
    def __init__(self, settings: Settings, provider: LLMProvider | None = None):
        self.settings = settings
        self.provider = provider or (
            FixtureLLMProvider()
            if settings.llm_provider == "fixture"
            else GeminiLLMProvider(settings)
        )
        self.concurrent = asyncio.Semaphore(2)
        self.events: OrderedDict[str, float] = OrderedDict()

    async def generate(
        self,
        request: ItineraryGenerationRequest,
        *,
        context_override=None,
        validator=None,
        prompt_version=ITINERARY_PROMPT_VERSION,
    ) -> ItineraryGenerationResponse:
        demo = self.settings.llm_provider == "fixture"
        if demo and self.settings.app_env == "production":
            raise AppError("ITINERARY_CONFIGURATION_ERROR", MESSAGE, 503)
        context = context_override or build_planning_context(request.context)
        validate = validator or semantic_errors
        now, user = time.monotonic(), str(request.user_id)
        if self.concurrent.locked() or now - self.events.get(user, float("-inf")) < 30:
            raise AppError(
                "ITINERARY_RATE_LIMITED", "Please wait before generating another itinerary.", 429
            )
        async with self.concurrent:
            self.events[user] = now
            self.events.move_to_end(user)
            while len(self.events) > 256:
                self.events.popitem(last=False)
            logger.info("itinerary_generation_started provider=%s", self.settings.llm_provider)
            try:
                async with asyncio.timeout(65):
                    plan = await self.provider.generate_itinerary(context)
                    failures = validate(plan, context)
                    repaired = bool(failures)
                    if failures:
                        logger.info("itinerary_repair_requested error_count=%d", len(failures))
                        plan = await self.provider.generate_itinerary(
                            context, previous=plan, validation_errors=failures
                        )
                        if validate(plan, context):
                            logger.warning("itinerary_semantic_validation_failed")
                            raise AppError(
                                "ITINERARY_VALIDATION_FAILED",
                                "We couldn't create a reliable plan. "
                                "Your previous itinerary is safe. Please try again later.",
                                502,
                            )
            except TimeoutError:
                raise AppError("ITINERARY_PROVIDER_TIMEOUT", MESSAGE, 503) from None
            document = resolve_itinerary(plan, context)
            if demo:
                document.warnings.append(
                    "Development fixture planner uses supplied candidates; "
                    "no Gemini request was made."
                )
            logger.info(
                "itinerary_generation_completed days=%d repaired=%s", len(document.days), repaired
            )
            return ItineraryGenerationResponse(
                provider=self.settings.llm_provider,
                model_name="deterministic-fixture-v1" if demo else self.settings.gemini_model,
                prompt_version=prompt_version,
                demo=demo,
                itinerary=document,
                budget=context.budget,
            )
