import json
import logging
import sys
import time
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.core.observability import (
    current_feature,
    current_monitor,
    current_request_id,
    feature_name,
)

logger = logging.getLogger("nomvira.requests")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = uuid4().hex
        monitor = request.app.state.monitor
        feature = feature_name(request.url.path)
        contexts = [
            (current_monitor, current_monitor.set(monitor)),
            (current_request_id, current_request_id.set(request_id)),
            (current_feature, current_feature.set(feature)),
        ]
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            # Do not propagate raw provider exceptions to Uvicorn or expose their inputs.
            logger.error("request_failed id=%s", request_id)
            response = JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "unavailable",
                        "message": "The service couldn't complete this request. Please try again.",
                    }
                },
            )
        except BaseException:
            for context, token in reversed(contexts):
                context.reset(token)
            raise
        response.headers["X-Request-ID"] = request_id
        response.headers["Cache-Control"] = "no-store"
        monitor.features[feature]["requests"] += 1
        monitor.features[feature]["failures"] += int(response.status_code >= 400)
        # Path/query/header values are untrusted and may contain credentials. Log no URLs.
        logger.info(
            "request_complete id=%s method=%s status=%s elapsed_ms=%d",
            request_id,
            request.method,
            response.status_code,
            (time.monotonic() - started) * 1000,
            extra={
                "metrics": {
                    "feature": feature,
                    "status": response.status_code,
                    "elapsed_ms": round((time.monotonic() - started) * 1000),
                }
            },
        )
        for context, token in reversed(contexts):
            context.reset(token)
        return response


class JsonLogFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "event": record.getMessage().split(" ", 1)[0],
            "message": record.getMessage(),
        }
        if current_request_id.get():
            payload["request_id"] = current_request_id.get()
        if hasattr(record, "metrics"):
            payload.update(record.metrics)
        # Never serialize exc_info: provider exceptions may include credentials or inputs.
        return json.dumps(payload, ensure_ascii=True)


def configure_logging() -> None:
    application = logging.getLogger("nomvira")
    application.setLevel(logging.INFO)
    # Uvicorn configures its own loggers, not the application namespace.
    # Respect an existing host/test logging setup and avoid duplicate handlers.
    if not application.hasHandlers():
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonLogFormatter())
        application.addHandler(handler)
    # Provider request URLs contain search input. Log no outbound URLs by default.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
