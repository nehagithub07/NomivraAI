import asyncio
import json
import logging

import httpx
from google import genai
from google.genai import errors, types
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.providers.llm.base import LLMProvider
from app.providers.llm.prompt import SYSTEM_PROMPT
from app.providers.llm.weather_prompt import WEATHER_SYSTEM_PROMPT
from app.schemas.itinerary import GeneratedItinerary, TripPlanningContext
from app.schemas.weather import WeatherPlanningContext

logger = logging.getLogger("nomvira.itinerary")
MESSAGE = "AI planning is temporarily unavailable. Your trip and previous itinerary are safe."


class GeminiLLMProvider(LLMProvider):
    def __init__(self, settings: Settings):
        self.settings = settings

    async def generate_itinerary(
        self,
        context: TripPlanningContext,
        *,
        previous: GeneratedItinerary | None = None,
        validation_errors: list[str] | None = None,
    ) -> GeneratedItinerary:
        key = self.settings.gemini_api_key.get_secret_value()
        if not key:
            raise AppError("ITINERARY_CONFIGURATION_ERROR", MESSAGE, 503)
        content = {"planning_context": context.model_dump(mode="json", exclude={"trip_id"})}
        if previous is not None:
            content["repair"] = {
                "previous": previous.model_dump(mode="json"),
                "errors": validation_errors or [],
            }
        try:
            # Disable SDK HTTP retries. The service alone owns the one semantic repair.
            async with genai.Client(
                api_key=key,
                enterprise=False,
                vertexai=False,
                http_options=types.HttpOptions(
                    timeout=30_000, retry_options=types.HttpRetryOptions(attempts=1)
                ),
            ).aio as client:
                async with asyncio.timeout(30):
                    response = await client.models.generate_content(
                        model=self.settings.gemini_model,
                        contents=json.dumps(content, ensure_ascii=False),
                        config=types.GenerateContentConfig(
                            system_instruction=WEATHER_SYSTEM_PROMPT
                            if isinstance(context, WeatherPlanningContext)
                            else SYSTEM_PROMPT,
                            response_mime_type="application/json",
                            response_schema=GeneratedItinerary,
                            temperature=0.2,
                            max_output_tokens=12000,
                            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                                disable=True
                            ),
                        ),
                    )
            text = response.text
            if not isinstance(text, str) or len(text.encode()) > 100_000:
                raise ValueError
            return GeneratedItinerary.model_validate_json(text)
        except errors.APIError as error:
            status = error.code
            logger.warning("itinerary_provider_failed status=%s", status)
            code = (
                "ITINERARY_PROVIDER_RATE_LIMITED"
                if status == 429
                else "ITINERARY_PROVIDER_AUTH_ERROR"
                if status in (401, 403)
                else "ITINERARY_CONFIGURATION_ERROR"
                if status in (400, 404)
                else "ITINERARY_PROVIDER_UNAVAILABLE"
            )
            raise AppError(code, MESSAGE, 429 if status == 429 else 503) from None
        except (TimeoutError, httpx.TimeoutException):
            logger.warning("itinerary_provider_timeout")
            raise AppError("ITINERARY_PROVIDER_TIMEOUT", MESSAGE, 503) from None
        except (ValidationError, ValueError, TypeError):
            logger.warning("itinerary_provider_invalid_response")
            raise AppError("ITINERARY_PROVIDER_INVALID_RESPONSE", MESSAGE, 502) from None
        except httpx.RequestError:
            logger.warning("itinerary_provider_unavailable")
            raise AppError("ITINERARY_PROVIDER_UNAVAILABLE", MESSAGE, 503) from None
        except Exception:
            logger.warning("itinerary_provider_failed reason=unexpected")
            raise AppError("ITINERARY_PROVIDER_UNAVAILABLE", MESSAGE, 503) from None
