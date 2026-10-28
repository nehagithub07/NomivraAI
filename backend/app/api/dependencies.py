from secrets import compare_digest
from typing import Annotated

from fastapi import Header, Request

from app.core.errors import AppError


async def require_internal_key(
    request: Request, x_nomvira_internal_key: Annotated[str | None, Header()] = None
) -> None:
    expected = request.app.state.settings.nomvira_internal_api_key.get_secret_value()
    if (
        not expected
        or not x_nomvira_internal_key
        or not compare_digest(x_nomvira_internal_key.encode(), expected.encode())
    ):
        raise AppError("unauthorized", "Application authentication required.", 401)
