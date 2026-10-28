import logging
import time
from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

logger = logging.getLogger("nomvira.requests")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = uuid4().hex
        started = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["Cache-Control"] = "no-store"
        # Path/query/header values are untrusted and may contain credentials. Log no URLs.
        logger.info(
            "request_complete id=%s method=%s status=%s elapsed_ms=%d",
            request_id,
            request.method,
            response.status_code,
            (time.monotonic() - started) * 1000,
        )
        return response


def configure_logging() -> None:
    # Provider request URLs contain search input. Log no outbound URLs by default.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
