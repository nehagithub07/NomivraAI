import math

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


PROFILE_MAP = {
    "walking": "foot-walking",
    "driving": "driving-car",
}

MESSAGE = "Route information is temporarily unavailable."


def number(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None

    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    if not math.isfinite(result) or result < 0:
        return None

    return result


class OpenRouteServiceProvider(RoutingProvider):
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    def _key(self) -> str:
        key = self.settings.openrouteservice_api_key.get_secret_value()

        if not key:
            raise AppError(
                "ROUTING_CONFIGURATION_ERROR",
                MESSAGE,
                503,
            )

        return key

    async def _post(
        self,
        path: str,
        payload: dict,
    ) -> dict:
        url = (
            f"{str(self.settings.openrouteservice_base_url).rstrip('/')}"
            f"/{path.lstrip('/')}"
        )

        try:
            response = await self.client.post(
                url,
                headers={
                    "Authorization": self._key(),
                    "Accept": "application/json",
                },
                json=payload,
                timeout=httpx.Timeout(
                    20,
                    connect=4,
                    pool=4,
                ),
            )

        except httpx.TimeoutException:
            raise AppError(
                "ROUTING_PROVIDER_TIMEOUT",
                MESSAGE,
                503,
            ) from None

        except httpx.RequestError:
            raise AppError(
                "ROUTING_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            ) from None

        if response.status_code in (401, 403):
            raise AppError(
                "ROUTING_PROVIDER_AUTH_ERROR",
                MESSAGE,
                503,
            )

        if response.status_code == 429:
            raise AppError(
                "ROUTING_PROVIDER_RATE_LIMITED",
                "Routing is temporarily busy. Please try again shortly.",
                429,
            )

        if response.status_code == 404:
            raise AppError(
                "ROUTE_NOT_FOUND",
                "No route could be found between these places.",
                404,
            )

        if response.status_code == 400:
            raise AppError(
                "ROUTING_PROVIDER_INVALID_REQUEST",
                MESSAGE,
                502,
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
            raise AppError(
                "ROUTING_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None

        if not isinstance(data, dict):
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
        profile = PROFILE_MAP[request.mode]

        data = await self._post(
            f"directions/{profile}/geojson",
            {
                "coordinates": [
                    [
                        point.longitude,
                        point.latitude,
                    ]
                    for point in request.points
                ],
                "instructions": False,
            },
        )

        try:
            features = data["features"]

            if not isinstance(features, list) or not features:
                raise ValueError

            feature = features[0]

            if not isinstance(feature, dict):
                raise ValueError

            properties = feature["properties"]
            geometry = feature["geometry"]

            if not isinstance(properties, dict):
                raise ValueError

            if not isinstance(geometry, dict):
                raise ValueError

            summary = properties["summary"]
            raw_segments = properties["segments"]

            if not isinstance(summary, dict):
                raise ValueError

            if not isinstance(raw_segments, list):
                raise ValueError

            if len(raw_segments) != len(request.points) - 1:
                raise ValueError

            distance = number(summary.get("distance"))
            duration = number(summary.get("duration"))

            if distance is None or duration is None:
                raise ValueError

            coordinates = geometry.get("coordinates")

            if (
                geometry.get("type") != "LineString"
                or not isinstance(coordinates, list)
                or len(coordinates) < 2
            ):
                raise ValueError

            clean_coordinates: list[list[float]] = []

            for pair in coordinates:
                if (
                    not isinstance(pair, list)
                    or len(pair) < 2
                    or not isinstance(pair[0], (int, float))
                    or not isinstance(pair[1], (int, float))
                ):
                    raise ValueError

                clean_coordinates.append(
                    [
                        float(pair[0]),
                        float(pair[1]),
                    ]
                )

            segments: list[RouteSegment] = []

            for index, raw_segment in enumerate(raw_segments):
                if not isinstance(raw_segment, dict):
                    raise ValueError

                segment_distance = number(
                    raw_segment.get("distance")
                )

                segment_duration = number(
                    raw_segment.get("duration")
                )

                if (
                    segment_distance is None
                    or segment_duration is None
                ):
                    raise ValueError

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
                total_distance_meters=distance,
                total_duration_seconds=duration,
                segments=segments,
                geometry=RouteGeometry(
                    type="LineString",
                    coordinates=clean_coordinates,
                ),
            )

        except (
            KeyError,
            ValueError,
            TypeError,
            ValidationError,
        ):
            raise AppError(
                "ROUTING_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None

    async def matrix(
        self,
        request: MatrixRequest,
    ) -> MatrixResult:
        profile = PROFILE_MAP[request.mode]

        data = await self._post(
            f"matrix/{profile}",
            {
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

        def clean_matrix(value):
            if not isinstance(value, list) or len(value) != count:
                raise ValueError

            output = []

            for row in value:
                if not isinstance(row, list) or len(row) != count:
                    raise ValueError

                output.append(
                    [
                        number(item)
                        if item is not None
                        else None
                        for item in row
                    ]
                )

            return output

        try:
            return MatrixResult(
                provider="openrouteservice",
                mode=request.mode,
                durations=clean_matrix(durations),
                distances=clean_matrix(distances),
            )

        except (ValueError, ValidationError):
            raise AppError(
                "ROUTING_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None