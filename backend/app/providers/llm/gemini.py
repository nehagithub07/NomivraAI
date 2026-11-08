import asyncio
import json
import logging
import time
from contextvars import ContextVar
from typing import Any

import httpx
from google import genai
from google.genai import errors, types
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.core.observability import model_request
from app.providers.llm.base import LLMProvider
from app.providers.llm.context import compact_planning_context
from app.providers.llm.prompt import SYSTEM_PROMPT
from app.providers.llm.weather_prompt import WEATHER_SYSTEM_PROMPT
from app.schemas.itinerary import (
    GeneratedItinerary,
    TripPlanningContext,
)
from app.schemas.weather import WeatherPlanningContext

logger = logging.getLogger("nomvira.itinerary")


# ---------------------------------------------------------
# Gemini limits
# ---------------------------------------------------------

# One itinerary generation attempt.
#
# The complete itinerary service can still perform one
# semantic repair attempt if validation fails.
GEMINI_ATTEMPT_TIMEOUT_SECONDS = 40

# Keep enough room for multi-day structured JSON.
#
# Gemini thinking tokens count toward max_output_tokens, so
# making this too small can truncate otherwise valid JSON.
GEMINI_MAX_OUTPUT_TOKENS = 6144

# Companion calls are intentionally smaller/faster.
COMPANION_ATTEMPT_TIMEOUT_SECONDS = 30
COMPANION_MAX_OUTPUT_TOKENS = 2048

MAX_MODEL_RESPONSE_BYTES = 100_000


MESSAGE = "AI planning is temporarily unavailable. Your trip and previous itinerary are safe."

COMPANION_MESSAGE = "Your travel companion is temporarily unavailable. Please try again."


# ---------------------------------------------------------
# Gemini itinerary JSON schema
# ---------------------------------------------------------
#
# Keep the generation schema intentionally compact.
#
# Gemini only chooses trusted candidate IDs and scheduling
# metadata. GeneratedItinerary performs strict Pydantic
# validation after generation.
# ---------------------------------------------------------

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
                                        {
                                            "type": "string",
                                        },
                                        {
                                            "type": "null",
                                        },
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


def api_status(
    error: errors.APIError,
) -> int | None:
    """
    Normalize google-genai API error codes.

    The SDK normally exposes an integer HTTP-style code,
    but this helper avoids unexpected type failures.
    """

    value = getattr(
        error,
        "code",
        None,
    )

    if isinstance(
        value,
        int,
    ):
        return value

    try:
        return int(value)

    except (
        TypeError,
        ValueError,
    ):
        return None


def itinerary_thinking_level(
    model: str,
) -> str:
    """
    Gemini 3.6 Flash supports minimal thinking.

    Gemini 3.8 Flash does not support minimal, so use low
    for other configured Gemini models.
    """

    normalized = model.strip().casefold()

    if normalized == "gemini-3.6-flash":
        return "minimal"

    return "low"


def ensure_model_content_size(
    content: Any,
) -> None:
    """
    Prevent unexpectedly large provider responses from
    propagating through the application.
    """

    try:
        size = len(content.model_dump_json().encode("utf-8"))

    except (
        AttributeError,
        TypeError,
        ValueError,
    ):
        raise ValueError("Gemini returned invalid model content.") from None

    if size > MAX_MODEL_RESPONSE_BYTES:
        raise ValueError("Gemini returned oversized model content.")


class GeminiLLMProvider(LLMProvider):
    def __init__(
        self,
        settings: Settings,
    ):
        self.settings = settings
        self._chat_model = ContextVar("companion_model", default=settings.gemini_model)

    @property
    def model_name(self) -> str:
        return self._chat_model.get()

    # =====================================================
    # AI Travel Companion
    # =====================================================

    async def chat(
        self,
        contents: list,
        declarations: list[dict],
        *,
        preferred_model: str | None = None,
    ):
        from app.companion.prompts import (
            SYSTEM_PROMPT as COMPANION_PROMPT,
        )

        key = self.settings.gemini_api_key.get_secret_value()

        if not key:
            raise AppError(
                "COMPANION_CONFIGURATION_ERROR",
                COMPANION_MESSAGE,
                503,
            )

        model = preferred_model or self.settings.gemini_model

        logger.info(
            ("companion_provider_started model=%s message_count=%d tool_count=%d"),
            model,
            len(contents),
            len(declarations),
        )

        started = time.monotonic()

        # Only attach tool configuration when the
        # companion actually has declared tools.
        tools = None
        tool_config = None
        automatic_function_calling = None

        if declarations:
            tools = [
                types.Tool(
                    function_declarations=[
                        types.FunctionDeclaration(**declaration) for declaration in declarations
                    ]
                )
            ]

            automatic_function_calling = types.AutomaticFunctionCallingConfig(disable=True)

            tool_config = types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(mode="ANY")
            )

        try:
            async with genai.Client(
                api_key=key,
                enterprise=False,
                vertexai=False,
                http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=1)),
            ).aio as client:
                async with asyncio.timeout(COMPANION_ATTEMPT_TIMEOUT_SECONDS):
                    config = types.GenerateContentConfig(
                        system_instruction=COMPANION_PROMPT,
                        tools=tools,
                        automatic_function_calling=automatic_function_calling,
                        tool_config=tool_config,
                        thinking_config=types.ThinkingConfig(
                            thinking_level=itinerary_thinking_level(model),
                            include_thoughts=False,
                        ),
                        max_output_tokens=COMPANION_MAX_OUTPUT_TOKENS,
                    )
                    # Continuations retain the model that produced their opaque
                    # thought signatures. Failover is safe before the first reply.
                    fallback = model if preferred_model else self.settings.gemini_itinerary_model
                    try:
                        async with asyncio.timeout(
                            12 if fallback != model else COMPANION_ATTEMPT_TIMEOUT_SECONDS
                        ):
                            response = await model_request(client.models.generate_content,
                                model=model,
                                contents=contents,
                                config=config,
                            )
                    except (errors.APIError, TimeoutError) as error:
                        # An overloaded model can return 503 while another
                        # configured Gemini model remains available. Keep the
                        # fallback inside the same total deadline and tools.
                        if (
                            fallback == model
                            or isinstance(error, errors.APIError)
                            and api_status(error) != 503
                        ):
                            raise
                        model = fallback
                        logger.info("companion_provider_fallback model=%s", model)
                        config = config.model_copy(
                            update={
                                "thinking_config": types.ThinkingConfig(
                                    thinking_level=itinerary_thinking_level(model),
                                    include_thoughts=False,
                                )
                            }
                        )
                        response = await model_request(client.models.generate_content,
                            model=model,
                            contents=contents,
                            config=config,
                        )
                    self._chat_model.set(model)

            if not response.candidates or not response.candidates[0].content:
                logger.warning("companion_provider_invalid_response reason=missing_content")

                raise ValueError("Gemini returned no companion content.")

            content = response.candidates[0].content

            ensure_model_content_size(content)

            logger.info(
                ("companion_provider_completed elapsed_ms=%d"),
                int((time.monotonic() - started) * 1000),
            )

            return content

        except errors.APIError as error:
            status = api_status(error)

            logger.warning(
                ("companion_provider_failed status=%s"),
                status,
            )

            if status == 429:
                raise AppError(
                    "COMPANION_PROVIDER_RATE_LIMITED",
                    COMPANION_MESSAGE,
                    429,
                ) from None

            if status in (
                401,
                403,
            ):
                raise AppError(
                    "COMPANION_CONFIGURATION_ERROR",
                    COMPANION_MESSAGE,
                    503,
                ) from None

            if status in (
                400,
                404,
            ):
                raise AppError(
                    "COMPANION_CONFIGURATION_ERROR",
                    COMPANION_MESSAGE,
                    503,
                ) from None

            if status in (
                408,
                504,
            ):
                raise AppError(
                    "COMPANION_PROVIDER_TIMEOUT",
                    COMPANION_MESSAGE,
                    503,
                ) from None

            if status is not None and 500 <= status <= 599:
                raise AppError(
                    "COMPANION_PROVIDER_UNAVAILABLE",
                    COMPANION_MESSAGE,
                    503,
                ) from None

            raise AppError(
                "COMPANION_PROVIDER_UNAVAILABLE",
                COMPANION_MESSAGE,
                503,
            ) from None

        except (TimeoutError, httpx.TimeoutException):
            logger.warning(
                ("companion_provider_timeout elapsed_ms=%d"),
                int((time.monotonic() - started) * 1000),
            )

            raise AppError(
                "COMPANION_PROVIDER_TIMEOUT",
                COMPANION_MESSAGE,
                503,
            ) from None

        except (
            ValidationError,
            ValueError,
            TypeError,
        ) as error:
            logger.warning(
                ("companion_provider_invalid_response error_type=%s"),
                type(error).__name__,
            )

            raise AppError(
                "COMPANION_PROVIDER_INVALID_RESPONSE",
                COMPANION_MESSAGE,
                502,
            ) from None

        except httpx.RequestError as error:
            logger.warning(
                ("companion_provider_connection_error error_type=%s"),
                type(error).__name__,
            )

            raise AppError(
                "COMPANION_PROVIDER_UNAVAILABLE",
                COMPANION_MESSAGE,
                503,
            ) from None

        except AppError:
            raise

        except Exception as error:
            logger.error(
                ("companion_provider_failed reason=unexpected error_type=%s"),
                type(error).__name__,
            )

            raise AppError(
                "COMPANION_PROVIDER_UNAVAILABLE",
                COMPANION_MESSAGE,
                503,
            ) from None

    # =====================================================
    # AI Itinerary Generator
    # =====================================================

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

        content: dict[
            str,
            Any,
        ] = {"planning_context": compact_planning_context(context)}

        # -------------------------------------------------
        # Semantic repair
        # -------------------------------------------------
        #
        # We do not ask Gemini to regenerate blindly.
        #
        # It receives:
        # - previous structured output
        # - concrete semantic validation errors
        #
        # The service limits how many repairs can occur.
        # -------------------------------------------------

        if previous is not None:
            content["repair"] = {
                "previous": previous.model_dump(mode="json"),
                "errors": validation_errors or [],
            }

        model = self.settings.gemini_itinerary_model

        system_prompt = (
            WEATHER_SYSTEM_PROMPT
            if isinstance(
                context,
                WeatherPlanningContext,
            )
            else SYSTEM_PROMPT
        )

        prompt = json.dumps(
            content,
            ensure_ascii=False,
            separators=(
                ",",
                ":",
            ),
        )

        prompt_bytes = len(system_prompt.encode("utf-8")) + len(prompt.encode("utf-8"))

        logger.info(
            (
                "itinerary_provider_started "
                "model=%s "
                "trip_days=%d "
                "attraction_count=%d "
                "food_count=%d "
                "proximity_pair_count=%d "
                "repair=%s "
                "prompt_bytes=%d"
            ),
            model,
            len(context.dates),
            len(context.attractions),
            len(context.food),
            len(context.proximity),
            previous is not None,
            prompt_bytes,
        )

        started = time.monotonic()

        try:
            # ---------------------------------------------
            # Do not add a second long SDK timeout here.
            #
            # asyncio.timeout() is the application-level
            # deadline for one model attempt.
            # ---------------------------------------------

            async with genai.Client(
                api_key=key,
                enterprise=False,
                vertexai=False,
                http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=1)),
            ).aio as client:
                async with asyncio.timeout(GEMINI_ATTEMPT_TIMEOUT_SECONDS):
                    response = await model_request(client.models.generate_content,
                        model=model,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            response_mime_type="application/json",
                            response_json_schema=GEMINI_ITINERARY_SCHEMA,
                            thinking_config=types.ThinkingConfig(
                                thinking_level=itinerary_thinking_level(model),
                                include_thoughts=False,
                            ),
                            max_output_tokens=max(
                                GEMINI_MAX_OUTPUT_TOKENS, min(16384, len(context.dates) * 1024)
                            ),
                        ),
                    )

            text = response.text

            if (
                not isinstance(
                    text,
                    str,
                )
                or not text.strip()
            ):
                logger.warning("itinerary_provider_invalid_response reason=response_text_missing")

                raise ValueError("Gemini response did not contain text.")

            response_bytes = len(text.encode("utf-8"))

            logger.info(
                ("itinerary_provider_completed elapsed_ms=%d response_bytes=%d"),
                int((time.monotonic() - started) * 1000),
                response_bytes,
            )

            if response_bytes > MAX_MODEL_RESPONSE_BYTES:
                logger.warning("itinerary_provider_invalid_response reason=response_too_large")

                raise ValueError("Gemini response exceeded maximum size.")

            # ---------------------------------------------
            # Strict application-side validation
            # ---------------------------------------------

            return GeneratedItinerary.model_validate_json(text)

        except errors.APIError as error:
            status = api_status(error)

            logger.warning(
                ("itinerary_provider_failed status=%s elapsed_ms=%d"),
                status,
                int((time.monotonic() - started) * 1000),
            )

            if status == 429:
                code = "ITINERARY_PROVIDER_RATE_LIMITED"

                http_status = 429

            elif status in (
                401,
                403,
            ):
                code = "ITINERARY_PROVIDER_AUTH_ERROR"

                http_status = 503

            elif status in (
                400,
                404,
            ):
                # Common examples:
                # - invalid model name
                # - unsupported configuration
                # - invalid structured-output schema
                code = "ITINERARY_CONFIGURATION_ERROR"

                http_status = 503

            elif status in (
                408,
                504,
            ):
                code = "ITINERARY_PROVIDER_TIMEOUT"

                http_status = 503

            elif status is not None and 500 <= status <= 599:
                code = "ITINERARY_PROVIDER_UNAVAILABLE"

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
            logger.warning(
                ("itinerary_provider_timeout elapsed_ms=%d"),
                int((time.monotonic() - started) * 1000),
            )

            raise AppError(
                "ITINERARY_PROVIDER_TIMEOUT",
                MESSAGE,
                503,
            ) from None

        except (
            ValidationError,
            ValueError,
            TypeError,
        ) as error:
            logger.warning(
                ("itinerary_provider_invalid_response error_type=%s"),
                type(error).__name__,
            )

            raise AppError(
                "ITINERARY_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None

        except httpx.RequestError as error:
            logger.warning(
                ("itinerary_provider_unavailable error_type=%s"),
                type(error).__name__,
            )

            raise AppError(
                "ITINERARY_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            ) from None

        except AppError:
            raise

        except Exception as error:
            logger.error(
                ("itinerary_provider_failed reason=unexpected error_type=%s"),
                type(error).__name__,
            )

            raise AppError(
                "ITINERARY_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            ) from None
