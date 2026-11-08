from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(
        self, code: str, message: str, status_code: int = 502, *, retry_after_seconds: int = 60
    ):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retry_after_seconds = max(1, min(86400, retry_after_seconds))


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            headers={"Retry-After": str(exc.retry_after_seconds)}
            if exc.status_code == 429
            else None,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        # Pydantic's default error includes input; never echo headers, tokens or payloads.
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "invalid_request",
                    "message": "Check your request details.",
                }
            },
        )
