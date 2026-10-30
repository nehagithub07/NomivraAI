import asyncio
import logging
from typing import Any

import httpx

from app.core.errors import AppError


logger = logging.getLogger("nomvira.providers")


async def request_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    provider: str,
    total_timeout: float = 12,
    **kwargs: Any,
) -> dict[str, Any]:
    message = (
        "Destination search is temporarily unavailable."
        if provider == "GEOCODING"
        else "Place discovery is temporarily unavailable."
    )

    try:
        async with asyncio.timeout(total_timeout):
            response = await client.request(
                method,
                url,
                **kwargs,
            )

    except httpx.ConnectTimeout:
        if provider == "PLACES":
            logger.warning(
                "places_provider_timeout phase=connect"
            )

            raise AppError(
                "PLACES_PROVIDER_CONNECT_TIMEOUT",
                message,
                503,
            ) from None

        raise AppError(
            f"{provider}_PROVIDER_UNAVAILABLE",
            message,
            503,
        ) from None

    except httpx.ReadTimeout:
        if provider == "PLACES":
            logger.warning(
                "places_provider_timeout phase=read"
            )

            raise AppError(
                "PLACES_PROVIDER_READ_TIMEOUT",
                message,
                503,
            ) from None

        raise AppError(
            f"{provider}_PROVIDER_UNAVAILABLE",
            message,
            503,
        ) from None

    except httpx.WriteTimeout:
        if provider == "PLACES":
            logger.warning(
                "places_provider_timeout phase=write"
            )

            raise AppError(
                "PLACES_PROVIDER_WRITE_TIMEOUT",
                message,
                503,
            ) from None

        raise AppError(
            f"{provider}_PROVIDER_UNAVAILABLE",
            message,
            503,
        ) from None

    except httpx.PoolTimeout:
        if provider == "PLACES":
            logger.warning(
                "places_provider_timeout phase=pool"
            )

            raise AppError(
                "PLACES_PROVIDER_POOL_TIMEOUT",
                message,
                503,
            ) from None

        raise AppError(
            f"{provider}_PROVIDER_UNAVAILABLE",
            message,
            503,
        ) from None

    except TimeoutError:
        if provider == "PLACES":
            logger.warning(
                "places_provider_timeout phase=total"
            )

            raise AppError(
                "PLACES_PROVIDER_TIMEOUT",
                message,
                503,
            ) from None

        raise AppError(
            f"{provider}_PROVIDER_UNAVAILABLE",
            message,
            503,
        ) from None

    except httpx.RequestError as error:
        if provider == "PLACES":
            logger.warning(
                "places_provider_failure reason=transport type=%s",
                type(error).__name__,
            )

            if isinstance(
                error,
                httpx.ConnectError,
            ):
                raise AppError(
                    "PLACES_PROVIDER_CONNECTION_ERROR",
                    message,
                    503,
                ) from None

        raise AppError(
            f"{provider}_PROVIDER_UNAVAILABLE",
            message,
            503,
        ) from None


    if response.status_code == 429:
        if provider == "PLACES":
            logger.warning(
                "places_provider_rate_limited status=429"
            )

            raise AppError(
                "PLACES_PROVIDER_RATE_LIMITED",
                "Place discovery is temporarily busy. Please try again shortly.",
                429,
            )

        raise AppError(
            f"{provider}_PROVIDER_RATE_LIMITED",
            message,
            429,
        )


    if response.status_code == 404:
        if provider == "GEOCODING":
            raise AppError(
                "DESTINATION_NOT_FOUND",
                "Destination not found.",
                404,
            )

        if provider == "PLACES":
            logger.warning(
                "places_provider_failure status=404"
            )

            raise AppError(
                "PLACES_PROVIDER_UNAVAILABLE",
                message,
                503,
            )


    if response.status_code == 400:
        if provider == "PLACES":
            safe_body = response.text[
                :500
            ].replace(
                "\n",
                " ",
            )

            logger.warning(
                "places_provider_failure status=400 body=%s",
                safe_body,
            )

        raise AppError(
            f"{provider}_PROVIDER_INVALID_REQUEST",
            message,
            502,
        )


    if response.status_code >= 400:
        if provider == "PLACES":
            safe_body = response.text[
                :500
            ].replace(
                "\n",
                " ",
            )

            logger.warning(
                "places_provider_failure status=%d body=%s",
                response.status_code,
                safe_body,
            )

        raise AppError(
            f"{provider}_PROVIDER_UNAVAILABLE",
            message,
            503,
        )


    try:
        data = response.json()

        if (
            not isinstance(data, dict)
            or data.get("error")
            or data.get("remark")
        ):
            if provider == "PLACES":
                logger.warning(
                    "places_provider_failure reason=provider_remark remark=%s",
                    str(
                        data.get("remark")
                        or data.get("error")
                    )[:500],
                )

            raise ValueError

        return data

    except ValueError:
        if provider == "PLACES":
            logger.warning(
                "places_provider_failure reason=invalid_response"
            )

        raise AppError(
            f"{provider}_PROVIDER_INVALID_RESPONSE",
            message,
            502,
        ) from None