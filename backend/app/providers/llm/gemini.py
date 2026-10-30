import asyncio
import json
import logging
import time

import httpx
from google import genai
from google.genai import errors, types
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.providers.llm.base import LLMProvider
from app.providers.llm.context import compact_planning_context
from app.providers.llm.prompt import SYSTEM_PROMPT
from app.providers.llm.weather_prompt import WEATHER_SYSTEM_PROMPT
from app.schemas.itinerary import GeneratedItinerary, TripPlanningContext
from app.schemas.weather import WeatherPlanningContext

logger = logging.getLogger("nomvira.itinerary")
GEMINI_ATTEMPT_TIMEOUT_SECONDS = 60
GEMINI_MAX_OUTPUT_TOKENS = 6144

MESSAGE = "AI planning is temporarily unavailable. Your trip and previous itinerary are safe."


# Keep Gemini's generation schema intentionally simple.
# GeneratedItinerary performs strict validation after generation.
GEMINI_ITINERARY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "days": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "date": {
                        "type": "string",
                        "format": "date",
                    },
                    "day_number": {
                        "type": "integer",
                    },
                    "theme": {
                        "type": "string",
                        "enum": [
                            "discovery",
                            "culture",
                            "nature",
                            "mixed",
                            "relaxation",
                        ],
                    },
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "candidate_type": {
                                    "type": "string",
                                    "enum": [
                                        "attraction",
                                        "food",
                                        "hotel",
                                        "free_time",
                                    ],
                                },
                                "candidate_id": {
                                    "anyOf": [
                                        {"type": "string"},
                                        {"type": "null"},
                                    ],
                                },
                                "period": {
                                    "type": "string",
                                    "enum": [
                                        "morning",
                                        "afternoon",
                                        "evening",
                                    ],
                                },
                                "reason_code": {
                                    "type": "string",
                                    "enum": [
                                        "interest_match",
                                        "area_grouping",
                                        "pace_balance",
                                        "food_option",
                                        "selected_stay",
                                        "free_time",
                                    ],
                                },
                            },
                            "required": [
                                "candidate_type",
                                "candidate_id",
                                "period",
                                "reason_code",
                            ],
                        },
                    },
                },
                "required": [
                    "date",
                    "day_number",
                    "theme",
                    "items",
                ],
            },
        },
        "warnings": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": [
                    "insufficient_candidates",
                ],
            },
        },
    },
    "required": [
        "days",
    ],
}


class GeminiLLMProvider(LLMProvider):
    def __init__(self, settings: Settings):
        self.settings = settings

    async def chat(self, contents: list, declarations: list[dict]):
        from app.companion.prompts import SYSTEM_PROMPT as COMPANION_PROMPT

        message = "Your travel companion is temporarily unavailable. Please try again."
        key = self.settings.gemini_api_key.get_secret_value()
        if not key:
            raise AppError("COMPANION_CONFIGURATION_ERROR", message, 503)
        try:
            async with genai.Client(
                api_key=key,
                enterprise=False,
                vertexai=False,
                http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=1)),
            ).aio as client:
                async with asyncio.timeout(20):
                    response = await client.models.generate_content(
                        model=self.settings.gemini_model,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            system_instruction=COMPANION_PROMPT,
                            tools=[
                                types.Tool(
                                    function_declarations=[
                                        types.FunctionDeclaration(**item) for item in declarations
                                    ]
                                )
                            ],
                            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                                disable=True
                            ),
                            tool_config=types.ToolConfig(
                                function_calling_config=types.FunctionCallingConfig(mode="ANY")
                            ),
                            thinking_config=types.ThinkingConfig(
                                thinking_level="low", include_thoughts=False
                            ),
                            max_output_tokens=2048,
                        ),
                    )
            if not response.candidates or not response.candidates[0].content:
                raise ValueError("Missing model content")
            content = response.candidates[0].content
            if len(content.model_dump_json()) > 100_000:
                raise ValueError("Oversized model content")
            return content
        except errors.APIError as error:
            limited = error.code == 429
            code = (
                "RATE_LIMITED"
                if limited
                else "TIMEOUT"
                if error.code in (408, 504)
                else "UNAVAILABLE"
            )
            raise AppError(f"COMPANION_PROVIDER_{code}", message, 429 if limited else 503) from None
        except (TimeoutError, httpx.TimeoutException):
            raise AppError("COMPANION_PROVIDER_TIMEOUT", message, 503) from None
        except (ValueError, TypeError, ValidationError):
            raise AppError("COMPANION_PROVIDER_INVALID_RESPONSE", message, 502) from None
        except Exception:
            raise AppError("COMPANION_PROVIDER_UNAVAILABLE", message, 503) from None

    async def generate_itinerary(
        self,
        context: TripPlanningContext | WeatherPlanningContext,
        *,
        previous: GeneratedItinerary | None = None,
        validation_errors: list[str] | None = None,
    ) -> GeneratedItinerary:
        key = self.settings.gemini_api_key.get_secret_value()

        if not key:
            raise AppError(
                "ITINERARY_CONFIGURATION_ERROR",
                MESSAGE,
                503,
            )

        content = {"planning_context": compact_planning_context(context)}

        if previous is not None:
            content["repair"] = {
                "previous": previous.model_dump(mode="json"),
                "errors": validation_errors or [],
            }

        model = self.settings.gemini_itinerary_model
        system_prompt = (
            WEATHER_SYSTEM_PROMPT if isinstance(context, WeatherPlanningContext) else SYSTEM_PROMPT
        )
        prompt = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
        logger.info(
            "itinerary_provider_started model=%s trip_days=%d attraction_count=%d "
            "food_count=%d proximity_pair_count=%d prompt_bytes=%d",
            model,
            len(context.dates),
            len(context.attractions),
            len(context.food),
            len(context.proximity),
            len(system_prompt.encode("utf-8")) + len(prompt.encode("utf-8")),
        )
        started = time.monotonic()

        try:
            # Do NOT set HttpOptions.timeout here.
            #
            # Setting timeout=90_000 caused the Gemini request itself to
            # receive a ~90 second server deadline and return
            # DEADLINE_EXCEEDED.
            #
            # The application-level asyncio timeout below remains the
            # authoritative timeout for one Gemini generation attempt.
            async with genai.Client(
                api_key=key,
                enterprise=False,
                vertexai=False,
                http_options=types.HttpOptions(
                    retry_options=types.HttpRetryOptions(
                        attempts=1,
                    ),
                ),
            ).aio as client:
                async with asyncio.timeout(GEMINI_ATTEMPT_TIMEOUT_SECONDS):
                    response = await client.models.generate_content(
                        model=model,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            response_mime_type="application/json",
                            response_json_schema=GEMINI_ITINERARY_SCHEMA,
                            thinking_config=types.ThinkingConfig(
                                thinking_level="minimal" if model == "gemini-3.6-flash" else "low",
                            ),
                            max_output_tokens=GEMINI_MAX_OUTPUT_TOKENS,
                        ),
                    )

            text = response.text

            if not isinstance(text, str):
                logger.warning("itinerary_provider_invalid_response reason=response_text_missing")
                raise ValueError("Gemini response did not contain text.")

            response_bytes = len(text.encode("utf-8"))
            logger.info(
                "itinerary_provider_completed elapsed_ms=%d response_bytes=%d",
                (time.monotonic() - started) * 1000,
                response_bytes,
            )
            if response_bytes > 100_000:
                logger.warning("itinerary_provider_invalid_response reason=response_too_large")
                raise ValueError("Gemini response exceeded maximum size.")

            # Strict application-side Pydantic validation.
            return GeneratedItinerary.model_validate_json(text)

        except errors.APIError as error:
            status = error.code

            logger.warning(
                "itinerary_provider_failed status=%s",
                status,
            )

            if status == 429:
                code = "ITINERARY_PROVIDER_RATE_LIMITED"
                http_status = 429

            elif status in (401, 403):
                code = "ITINERARY_PROVIDER_AUTH_ERROR"
                http_status = 503

            elif status in (400, 404):
                code = "ITINERARY_CONFIGURATION_ERROR"
                http_status = 503

            elif status in (408, 504):
                code = "ITINERARY_PROVIDER_TIMEOUT"
                http_status = 503

            else:
                code = "ITINERARY_PROVIDER_UNAVAILABLE"
                http_status = 503

            raise AppError(
                code,
                MESSAGE,
                http_status,
            ) from None

        except (TimeoutError, httpx.TimeoutException):
            logger.warning("itinerary_provider_timeout")

            raise AppError(
                "ITINERARY_PROVIDER_TIMEOUT",
                MESSAGE,
                503,
            ) from None

        except (ValidationError, ValueError, TypeError) as error:
            logger.warning(
                "itinerary_provider_invalid_response error_type=%s",
                type(error).__name__,
            )

            raise AppError(
                "ITINERARY_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None

        except httpx.RequestError:
            logger.warning("itinerary_provider_unavailable")

            raise AppError(
                "ITINERARY_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            ) from None

        except Exception as error:
            logger.warning(
                "itinerary_provider_failed reason=unexpected error_type=%s",
                type(error).__name__,
            )

            raise AppError(
                "ITINERARY_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            ) from None
