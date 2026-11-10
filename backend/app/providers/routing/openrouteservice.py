import asyncio
import logging
import math
from typing import Any

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import AppError
from app.providers.routing.base import RoutingProvider
from app.schemas.routing import (
    MatrixRequest,
    MatrixResult,
    RouteGeometry,
    RouteRequest,
    RouteResult,
    RouteSegment,
)

logger = logging.getLogger("nomvira.routing")


PROFILE_MAP = {
    "walking": "foot-walking",
    "driving": "driving-car",
}


MESSAGE = "Route information is temporarily unavailable."


# The Next.js BFF timeout should stay ABOVE this.
PROVIDER_TOTAL_TIMEOUT_SECONDS = 50


def nonnegative_number(
    value: Any,
) -> float | None:
    """
    Parse distance/duration values.

    Distances and durations may be zero,
    but must never be negative or non-finite.
    """

    if value is None or isinstance(
        value,
        bool,
    ):
        return None

    try:
        result = float(value)

    except (
        TypeError,
        ValueError,
        OverflowError,
    ):
        return None

    if not math.isfinite(result) or result < 0:
        return None

    return result


def coordinate_number(
    value: Any,
) -> float | None:
    """
    Parse longitude/latitude values.

    Unlike distances, coordinates are allowed
    to be negative.
    """

    if value is None or isinstance(
        value,
        bool,
    ):
        return None

    try:
        result = float(value)

    except (
        TypeError,
        ValueError,
        OverflowError,
    ):
        return None

    if not math.isfinite(result):
        return None

    return result


def safe_provider_error(
    response: httpx.Response,
) -> Any:
    """
    Capture a small provider error for logs.

    Never log headers, because Authorization
    contains the ORS API key.
    """

    try:
        body = response.json()

        if isinstance(
            body,
            (
                dict,
                list,
            ),
        ):
            return body

    except ValueError:
        pass

    return {
        "message": response.text[:500].replace(
            "\n",
            " ",
        )
    }


class OpenRouteServiceProvider(RoutingProvider):
    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient,
    ):
        self.settings = settings
        self.client = client

    def _key(
        self,
    ) -> str:
        key = self.settings.openrouteservice_api_key.get_secret_value()

        if not key:
            raise AppError(
                "ROUTING_CONFIGURATION_ERROR",
                "Routing isn't configured.",
                503,
            )

        return key

    def _profile(
        self,
        mode: str,
    ) -> str:
        profile = PROFILE_MAP.get(mode)

        if not profile:
            raise AppError(
                "ROUTING_INVALID_MODE",
                "This travel mode isn't supported.",
                422,
            )

        return profile

    async def _post(
        self,
        path: str,
        payload: dict,
    ) -> dict:
        base = str(self.settings.openrouteservice_base_url).rstrip("/")

        url = f"{base}/{path.lstrip('/')}"

        logger.info(
            "routing_provider_request path=%s",
            path,
        )

        # ORS directions /geojson returns GeoJSON, while
        # matrix and other endpoints return regular JSON.
        accept_type = "application/geo+json" if path.endswith("/geojson") else "application/json"

        try:
            async with asyncio.timeout(PROVIDER_TOTAL_TIMEOUT_SECONDS):
                response = await self.client.post(
                    url,
                    headers={
                        "Authorization": self._key(),
                        "Accept": accept_type,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=httpx.Timeout(
                        connect=8.0,
                        read=40.0,
                        write=10.0,
                        pool=8.0,
                    ),
                    follow_redirects=False,
                )

        except httpx.ConnectTimeout:
            logger.warning(
                ("routing_provider_timeout phase=connect path=%s"),
                path,
            )

            raise AppError(
                "ROUTING_PROVIDER_CONNECT_TIMEOUT",
                ("The routing provider could not be reached in time."),
                503,
            ) from None

        except httpx.ReadTimeout:
            logger.warning(
                ("routing_provider_timeout phase=read path=%s"),
                path,
            )

            raise AppError(
                "ROUTING_PROVIDER_READ_TIMEOUT",
                ("The routing provider took too long to calculate this route."),
                503,
            ) from None

        except httpx.WriteTimeout:
            logger.warning(
                ("routing_provider_timeout phase=write path=%s"),
                path,
            )

            raise AppError(
                "ROUTING_PROVIDER_WRITE_TIMEOUT",
                MESSAGE,
                503,
            ) from None

        except httpx.PoolTimeout:
            logger.warning(
                ("routing_provider_timeout phase=pool path=%s"),
                path,
            )

            raise AppError(
                "ROUTING_PROVIDER_POOL_TIMEOUT",
                MESSAGE,
                503,
            ) from None

        except TimeoutError:
            logger.warning(
                ("routing_provider_timeout phase=total path=%s"),
                path,
            )

            raise AppError(
                "ROUTING_PROVIDER_TIMEOUT",
                MESSAGE,
                503,
            ) from None

        except httpx.ConnectError as error:
            logger.warning(
                ("routing_provider_connection_error path=%s type=%s detail=%s"),
                path,
                type(error).__name__,
                str(error)[:300],
            )

            raise AppError(
                "ROUTING_PROVIDER_CONNECTION_ERROR",
                ("The routing server could not be reached. Please try again shortly."),
                503,
            ) from None

        except httpx.RemoteProtocolError as error:
            logger.warning(
                ("routing_provider_protocol_error path=%s type=%s detail=%s"),
                path,
                type(error).__name__,
                str(error)[:300],
            )

            raise AppError(
                "ROUTING_PROVIDER_CONNECTION_ERROR",
                ("The routing server connection was interrupted. Please try again."),
                503,
            ) from None

        except httpx.RequestError as error:
            logger.warning(
                ("routing_provider_request_error path=%s type=%s detail=%s"),
                path,
                type(error).__name__,
                str(error)[:300],
            )

            raise AppError(
                "ROUTING_PROVIDER_CONNECTION_ERROR",
                ("The routing server could not be reached. Please try again."),
                503,
            ) from None

        logger.info(
            ("routing_provider_response path=%s status=%s"),
            path,
            response.status_code,
        )

        if response.status_code >= 400:
            logger.warning(
                ("routing_provider_failed path=%s status=%s response=%s"),
                path,
                response.status_code,
                safe_provider_error(response),
            )

        # ---------------------------------------------
        # Authentication/configuration
        # ---------------------------------------------

        if response.status_code in (
            401,
            403,
        ):
            raise AppError(
                "ROUTING_PROVIDER_AUTH_ERROR",
                ("Routing isn't configured correctly right now."),
                503,
            )

        # ---------------------------------------------
        # Provider rate limit
        # ---------------------------------------------

        if response.status_code == 429:
            raise AppError(
                "ROUTING_PROVIDER_RATE_LIMITED",
                ("Routing is temporarily busy. Please try again shortly."),
                429,
            )

        # ---------------------------------------------
        # Invalid request
        # ---------------------------------------------

        if response.status_code in (
            400,
            422,
        ):
            raise AppError(
                "ROUTING_PROVIDER_INVALID_REQUEST",
                ("The routing provider could not calculate this route."),
                502,
            )

        # ---------------------------------------------
        # No routable result
        # ---------------------------------------------

        if response.status_code == 404:
            raise AppError(
                "ROUTE_NOT_FOUND",
                ("No route could be found between these places."),
                404,
            )

        # ---------------------------------------------
        # Request too large
        # ---------------------------------------------

        if response.status_code == 413:
            raise AppError(
                "ROUTING_REQUEST_TOO_LARGE",
                ("This route contains too many points to calculate at once."),
                422,
            )

        # ---------------------------------------------
        # HeiGIT/openrouteservice unavailable
        # ---------------------------------------------

        if response.status_code in (
            502,
            503,
            504,
        ):
            raise AppError(
                "ROUTING_PROVIDER_UNAVAILABLE",
                ("The routing provider is temporarily unavailable."),
                503,
            )

        if response.status_code >= 500:
            raise AppError(
                "ROUTING_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            )

        if response.status_code >= 400:
            raise AppError(
                "ROUTING_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            )

        try:
            data = response.json()

        except ValueError:
            logger.warning(
                ("routing_provider_invalid_response path=%s reason=invalid_json"),
                path,
            )

            raise AppError(
                "ROUTING_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None

        if not isinstance(
            data,
            dict,
        ):
            logger.warning(
                ("routing_provider_invalid_response path=%s reason=not_object"),
                path,
            )

            raise AppError(
                "ROUTING_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            )

        if data.get("error"):
            logger.warning(
                ("routing_provider_invalid_response path=%s reason=provider_error"),
                path,
            )

            raise AppError(
                "ROUTING_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            )

        return data

    async def route(
        self,
        request: RouteRequest,
    ) -> RouteResult:
        profile = self._profile(request.mode)

        data = await self._post(
            (f"directions/{profile}/geojson"),
            {
                # ORS expects:
                # [longitude, latitude]
                "coordinates": [
                    [
                        point.longitude,
                        point.latitude,
                    ]
                    for point in request.points
                ],
                # ORS omits per-leg segments when instructions are disabled.
                # The route summary needs these to show travel between stops.
                "instructions": True,
            },
        )

        try:
            features = data["features"]

            if (
                not isinstance(
                    features,
                    list,
                )
                or not features
            ):
                raise ValueError("Missing route features")

            feature = features[0]

            if not isinstance(
                feature,
                dict,
            ):
                raise ValueError("Invalid route feature")

            properties = feature["properties"]

            geometry = feature["geometry"]

            if not isinstance(
                properties,
                dict,
            ):
                raise ValueError("Invalid route properties")

            if not isinstance(
                geometry,
                dict,
            ):
                raise ValueError("Invalid route geometry")

            summary = properties["summary"]

            raw_segments = properties["segments"]

            if not isinstance(
                summary,
                dict,
            ):
                raise ValueError("Invalid route summary")

            if not isinstance(
                raw_segments,
                list,
            ):
                raise ValueError("Invalid route segments")

            expected_segments = len(request.points) - 1

            if len(raw_segments) != expected_segments:
                raise ValueError("Unexpected route segment count")

            total_distance = nonnegative_number(summary.get("distance"))

            total_duration = nonnegative_number(summary.get("duration"))

            if total_distance is None or total_duration is None:
                raise ValueError("Invalid route summary values")

            if geometry.get("type") != "LineString":
                raise ValueError("Unexpected geometry type")

            raw_coordinates = geometry.get("coordinates")

            if (
                not isinstance(
                    raw_coordinates,
                    list,
                )
                or len(raw_coordinates) < 2
            ):
                raise ValueError("Invalid route coordinates")

            clean_coordinates: list[list[float]] = []

            for pair in raw_coordinates:
                if (
                    not isinstance(
                        pair,
                        list,
                    )
                    or len(pair) < 2
                ):
                    raise ValueError("Invalid coordinate pair")

                longitude = coordinate_number(pair[0])

                latitude = coordinate_number(pair[1])

                if (
                    longitude is None
                    or latitude is None
                    or not -180 <= longitude <= 180
                    or not -90 <= latitude <= 90
                ):
                    raise ValueError("Invalid route coordinate")

                clean_coordinates.append(
                    [
                        longitude,
                        latitude,
                    ]
                )

            segments: list[RouteSegment] = []

            for (
                index,
                raw_segment,
            ) in enumerate(raw_segments):
                if not isinstance(
                    raw_segment,
                    dict,
                ):
                    raise ValueError("Invalid route segment")

                segment_distance = nonnegative_number(raw_segment.get("distance"))

                segment_duration = nonnegative_number(raw_segment.get("duration"))

                if segment_distance is None or segment_duration is None:
                    raise ValueError("Invalid route segment values")

                segments.append(
                    RouteSegment(
                        from_index=index,
                        to_index=index + 1,
                        from_label=request.points[index].label,
                        to_label=request.points[index + 1].label,
                        distance_meters=segment_distance,
                        duration_seconds=segment_duration,
                    )
                )

            return RouteResult(
                provider="openrouteservice",
                mode=request.mode,
                total_distance_meters=total_distance,
                total_duration_seconds=total_duration,
                segments=segments,
                geometry=RouteGeometry(
                    type="LineString",
                    coordinates=clean_coordinates,
                ),
            )

        except (
            KeyError,
            IndexError,
            ValueError,
            TypeError,
            ValidationError,
        ) as error:
            logger.warning(
                ("routing_provider_invalid_response operation=route error_type=%s"),
                type(error).__name__,
            )

            raise AppError(
                "ROUTING_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None

    async def matrix(
        self,
        request: MatrixRequest,
    ) -> MatrixResult:
        profile = self._profile(request.mode)

        data = await self._post(
            f"matrix/{profile}",
            {
                # ORS expects:
                # [longitude, latitude]
                "locations": [
                    [
                        point.longitude,
                        point.latitude,
                    ]
                    for point in request.points
                ],
                "metrics": [
                    "distance",
                    "duration",
                ],
                "units": "m",
            },
        )

        durations = data.get("durations")

        distances = data.get("distances")

        count = len(request.points)

        def clean_matrix(
            value: Any,
        ) -> list[list[float | None]]:
            if (
                not isinstance(
                    value,
                    list,
                )
                or len(value) != count
            ):
                raise ValueError("Invalid matrix dimensions")

            output: list[list[float | None]] = []

            for row in value:
                if (
                    not isinstance(
                        row,
                        list,
                    )
                    or len(row) != count
                ):
                    raise ValueError("Invalid matrix row")

                clean_row: list[float | None] = []

                for item in row:
                    if item is None:
                        clean_row.append(None)

                        continue

                    parsed = nonnegative_number(item)

                    if parsed is None:
                        raise ValueError("Invalid matrix value")

                    clean_row.append(parsed)

                output.append(clean_row)

            return output

        try:
            clean_durations = clean_matrix(durations)

            clean_distances = clean_matrix(distances)

            return MatrixResult(
                provider="openrouteservice",
                mode=request.mode,
                durations=clean_durations,
                distances=clean_distances,
            )

        except (
            ValueError,
            TypeError,
            ValidationError,
        ) as error:
            logger.warning(
                ("routing_provider_invalid_response operation=matrix error_type=%s"),
                type(error).__name__,
            )

            raise AppError(
                "ROUTING_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None
