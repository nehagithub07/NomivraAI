import asyncio
from typing import Any

import httpx

from app.core.errors import AppError


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
            response = await client.request(method, url, **kwargs)
    except (httpx.RequestError, TimeoutError):
        raise AppError(f"{provider}_PROVIDER_UNAVAILABLE", message, 503) from None
    if response.status_code == 429:
        raise AppError(f"{provider}_PROVIDER_RATE_LIMITED", message, 429)
    if response.status_code == 404:
        raise AppError("DESTINATION_NOT_FOUND", "Destination not found.", 404)
    if response.status_code == 400:
        raise AppError(f"{provider}_PROVIDER_INVALID_REQUEST", message, 502)
    if response.status_code >= 400:
        raise AppError(f"{provider}_PROVIDER_UNAVAILABLE", message, 503)
    try:
        data = response.json()
        if not isinstance(data, dict) or data.get("error") or data.get("remark"):
            raise ValueError
        return data
    except ValueError:
        raise AppError(f"{provider}_PROVIDER_INVALID_RESPONSE", message, 502) from None
