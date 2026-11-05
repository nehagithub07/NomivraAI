import asyncio
import logging
import re
import unicodedata
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from app.core.accommodation_cache import AccommodationCache
from app.core.config import Settings
from app.core.errors import AppError
from app.providers.accommodations.base import AccommodationProvider
from app.providers.places.overpass import haversine_km
from app.schemas.accommodation import (
    AccommodationCandidate,
    AccommodationSearchRequest,
)

logger = logging.getLogger("nomvira.stayapi")


TYPE_MAP = {
    "hotel": "hotel",
    "hostel": "hostel",
    "apartment": "apartment",
    "homestay": "homestay",
    "guest house": "guest_house",
    "guest_house": "guest_house",
    "resort": "resort",
    "vacation rental": "vacation_rental",
    "vacation_rental": "vacation_rental",
    "holiday home": "vacation_rental",
    "holiday_home": "vacation_rental",
    "motel": "other",
    "other": "other",
}


ALLOWED_DESTINATION_TYPES = {
    "CITY",
    "DISTRICT",
    "REGION",
    "LANDMARK",
}


DESTINATION_TYPE_PRIORITY = {
    "CITY": 4,
    "DISTRICT": 3,
    "REGION": 2,
    "LANDMARK": 1,
}


def money(
    value,
) -> Decimal | None:
    if value is None or isinstance(
        value,
        bool,
    ):
        return None

    try:
        result = Decimal(str(value))

    except (
        ValueError,
        InvalidOperation,
        TypeError,
    ):
        return None

    if not result.is_finite() or not 0 <= result <= 1_000_000_000:
        return None

    return result.quantize(
        Decimal(".01"),
        rounding=ROUND_HALF_UP,
    )


def number(
    value,
) -> float | None:
    if value is None or isinstance(
        value,
        bool,
    ):
        return None

    try:
        result = float(value)

    except (
        ValueError,
        TypeError,
        OverflowError,
    ):
        return None

    if result != result or abs(result) == float("inf"):
        return None

    return result


def text(
    value,
    maximum: int = 300,
) -> str | None:
    if not isinstance(
        value,
        str,
    ):
        return None

    cleaned = " ".join(value.split())[:maximum]

    return cleaned or None


def safe_source_url(
    value,
    domain: str,
) -> str | None:
    if (
        not isinstance(
            value,
            str,
        )
        or len(value) > 2000
    ):
        return None

    try:
        url = urlsplit(value)

        host = (url.hostname or "").lower()

        if (
            url.scheme == "https"
            and not url.username
            and not url.password
            and url.port
            in {
                None,
                443,
            }
            and (host == domain or host.endswith("." + domain))
        ):
            return value

    except ValueError:
        pass

    return None


def folded(
    value: str,
) -> str:
    return " ".join(
        "".join(
            char
            for char in unicodedata.normalize(
                "NFKD",
                value.casefold(),
            )
            if not unicodedata.combining(char)
        ).split()
    )


def parse_property_type(
    raw: dict,
) -> str | None:
    value = raw.get("property_type") or raw.get("accommodation_type")

    if not isinstance(
        value,
        str,
    ):
        return None

    key = " ".join(
        value.strip()
        .lower()
        .replace(
            "-",
            " ",
        )
        .replace(
            "_",
            " ",
        )
        .split()
    )

    return TYPE_MAP.get(key)


def parse_distance_km(
    value,
) -> float | None:
    numeric = number(value)

    if numeric is not None:
        if numeric < 0:
            return None

        return numeric

    if not isinstance(
        value,
        str,
    ):
        return None

    match = re.search(
        (
            r"([0-9]+(?:\.[0-9]+)?)"
            r"\s*"
            r"(km|kilometers?|mi|miles?|m|meters?)"
            r"\b"
        ),
        value.casefold(),
    )

    if not match:
        return None

    distance = number(match.group(1))

    if distance is None or distance < 0:
        return None

    unit = match.group(2)

    if unit in {
        "mi",
        "mile",
        "miles",
    }:
        return distance * 1.609344

    if unit in {
        "m",
        "meter",
        "meters",
    }:
        return distance / 1000

    return distance


def normalize_hotel(
    raw: dict,
    request: AccommodationSearchRequest,
) -> AccommodationCandidate | None:

    if not isinstance(
        raw,
        dict,
    ):
        return None

    # -----------------------------------------------------
    # Identity
    # -----------------------------------------------------

    ident = raw.get("hotel_id")

    name = text(raw.get("name") or raw.get("hotel_name"))

    if (
        isinstance(
            ident,
            bool,
        )
        or not re.fullmatch(
            r"[1-9][0-9]{0,19}",
            str(ident),
        )
        or not name
    ):
        return None

    # -----------------------------------------------------
    # StayAPI current response structure
    #
    # rating:
    # {
    #   "score": 8.8,
    #   "review_count": 3617,
    #   "display": "Excellent"
    # }
    #
    # price:
    # {
    #   "amount": ...,
    #   "currency": "USD",
    #   ...
    # }
    # -----------------------------------------------------

    price = (
        raw.get("price")
        if isinstance(
            raw.get("price"),
            dict,
        )
        else {}
    )

    rating = (
        raw.get("rating")
        if isinstance(
            raw.get("rating"),
            dict,
        )
        else {}
    )

    # -----------------------------------------------------
    # Guest rating
    # -----------------------------------------------------

    score = number(rating.get("score"))

    # Backward-compatible fallback.
    if score is None:
        score = number(raw.get("review_score"))

    scale = number(rating.get("scale"))

    # Booking guest ratings are normally /10.
    if scale is None and score is not None:
        scale = 10.0

    if score is None or scale is None or not 0 < scale <= 100 or not 0 <= score <= scale:
        score = None
        scale = None

    # -----------------------------------------------------
    # Review count
    # -----------------------------------------------------

    reviews = number(rating.get("review_count"))

    if reviews is None:
        reviews = number(raw.get("review_count"))

    review_count = (
        int(reviews)
        if (reviews is not None and 0 <= reviews <= 2_147_483_647 and reviews.is_integer())
        else None
    )

    # -----------------------------------------------------
    # Stars
    # -----------------------------------------------------

    stars = number(raw.get("star_rating"))

    star_rating = stars if (stars is not None and 0 < stars <= 5) else None

    # -----------------------------------------------------
    # Coordinates
    # -----------------------------------------------------

    latitude = number(raw.get("latitude"))

    longitude = number(raw.get("longitude"))

    if (
        latitude is None
        or longitude is None
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        latitude = None
        longitude = None

    # -----------------------------------------------------
    # Currency
    # -----------------------------------------------------

    currency_value = price.get("currency") or raw.get("currency_code")

    currency = (
        currency_value.strip().upper()
        if isinstance(
            currency_value,
            str,
        )
        else None
    )

    currency = (
        currency
        if (
            currency
            and re.fullmatch(
                r"[A-Z]{3}",
                currency,
            )
        )
        else None
    )

    # -----------------------------------------------------
    # Prices
    #
    # Prefer explicit StayAPI total_price_value whenever
    # supplied.
    #
    # Current search responses may expose price.amount as
    # the request-specific displayed quote. We use it as
    # fallback when an explicit total is unavailable.
    # -----------------------------------------------------

    explicit_total = money(price.get("total_price_value"))

    if explicit_total is None:
        explicit_total = money(raw.get("total_price_value"))

    advertised_price = money(price.get("amount"))

    # Backward-compatible fallback.
    if advertised_price is None:
        advertised_price = money(raw.get("min_total_price"))

    # An advertised amount has no guaranteed nightly/whole-stay basis. Only
    # explicit totals can participate in budget calculations and price sorting.
    total_price = explicit_total

    nightly_price = None

    if total_price is not None and request.nights > 0:
        nightly_price = (total_price / Decimal(request.nights)).quantize(
            Decimal(".01"),
            rounding=ROUND_HALF_UP,
        )

    taxes_and_fees = money(price.get("taxes_and_charges_value"))

    if taxes_and_fees is None:
        taxes_and_fees = money(raw.get("taxes_and_charges_value"))

    # -----------------------------------------------------
    # Availability
    # -----------------------------------------------------

    sold_out = raw.get("is_sold_out")

    available = (
        not sold_out
        if isinstance(
            sold_out,
            bool,
        )
        else None
    )

    # -----------------------------------------------------
    # Distance
    # -----------------------------------------------------

    distance = None

    if latitude is not None and longitude is not None:
        distance = round(
            haversine_km(
                request.latitude,
                request.longitude,
                latitude,
                longitude,
            ),
            3,
        )

    else:
        raw_distance = raw.get("distance_from_center")

        if raw_distance is None:
            raw_distance = raw.get("distance")

        parsed_distance = parse_distance_km(raw_distance)

        distance = (
            round(
                parsed_distance,
                3,
            )
            if parsed_distance is not None
            else None
        )

    # -----------------------------------------------------
    # Amenities
    # -----------------------------------------------------

    amenities_value = raw.get("amenities")

    amenities = (
        amenities_value
        if isinstance(
            amenities_value,
            list,
        )
        else []
    )

    # -----------------------------------------------------
    # Final validated candidate
    # -----------------------------------------------------

    try:
        return AccommodationCandidate(
            provider="stayapi",
            provider_accommodation_id=str(ident),
            name=name,
            accommodation_type=parse_property_type(raw),
            latitude=latitude,
            longitude=longitude,
            address=text(
                raw.get("address"),
                600,
            ),
            star_rating=star_rating,
            guest_rating=score,
            guest_rating_scale=scale,
            review_count=review_count,
            nightly_price=(nightly_price if currency else None),
            total_price=(total_price if currency else None),
            taxes_and_fees=(taxes_and_fees if currency else None),
            taxes_included=None,
            advertised_price=(advertised_price if currency else None),
            currency=currency,
            distance_km=distance,
            amenities=[
                cleaned
                for item in amenities[:40]
                if (
                    cleaned := text(
                        item,
                        100,
                    )
                )
            ],
            image_url=safe_source_url(
                raw.get("image_url"),
                "bstatic.com",
            ),
            # Some search responses do not expose a
            # property-specific Booking URL.
            booking_url=safe_source_url(
                raw.get("url"),
                "booking.com",
            ),
            available=available,
        )

    except ValidationError:
        return None


def resolve_destination(
    data: dict,
    request: AccommodationSearchRequest,
) -> tuple[str, str] | None:

    suggestions = data.get(
        "suggestions",
        [],
    )

    if not isinstance(
        suggestions,
        list,
    ):
        raise AppError(
            "ACCOMMODATION_PROVIDER_INVALID_RESPONSE",
            "Hotel search is unavailable.",
            502,
        )

    options: list[dict] = [
        option
        for option in suggestions[:10]
        if isinstance(
            option,
            dict,
        )
    ]

    # The destination lookup endpoint also returns the
    # best resolved destination at the top level.
    primary = {
        "dest_id": data.get("dest_id"),
        "dest_type": data.get("dest_type"),
        "label": data.get("normalized_query"),
    }

    if primary["dest_id"] is not None:
        options.insert(
            0,
            primary,
        )

    if not options:
        return None

    city = folded(request.destination_name.split(",")[0])

    country = folded(request.destination_country or "")

    admin = folded(request.destination_admin1 or "")

    ranked: list[
        tuple[
            int,
            int,
            str,
            str,
        ]
    ] = []

    seen: set[
        tuple[
            str,
            str,
        ]
    ] = set()

    for option in options:
        ident = str(option.get("dest_id") or "")

        kind = str(option.get("dest_type") or "").upper()

        label = folded(str(option.get("label") or ""))

        if (
            not re.fullmatch(
                r"-?[1-9][0-9]{0,19}",
                ident,
            )
            or kind not in ALLOWED_DESTINATION_TYPES
            or not label
        ):
            continue

        key = (
            ident,
            kind,
        )

        if key in seen:
            continue

        seen.add(key)

        parts = [part.strip() for part in label.split(",") if part.strip()]

        first_part = parts[0] if parts else ""

        exact_city = first_part == city

        contains_city = bool(city and re.search(r"\b" + re.escape(city) + r"\b", first_part))

        if city and not exact_city and not contains_city:
            continue

        if country:
            country_matches = any(part == country for part in parts[1:])

            if not country_matches:
                continue

        else:
            country_matches = False

        admin_matches = bool(admin and any(admin in part for part in parts[1:]))

        score = (
            (100 if exact_city else 40)
            + (20 if country_matches else 0)
            + (10 if admin_matches else 0)
            + DESTINATION_TYPE_PRIORITY[kind]
        )

        ranked.append(
            (
                score,
                DESTINATION_TYPE_PRIORITY[kind],
                ident,
                kind,
            )
        )

    if not ranked:
        raise AppError(
            "ACCOMMODATION_DESTINATION_UNRESOLVED",
            "We couldn't match hotels to this destination safely.",
            422,
        )

    ranked.sort(reverse=True)

    best = ranked[0]
    if any(option[:2] == best[:2] and option[2:] != best[2:] for option in ranked[1:]):
        raise AppError(
            "ACCOMMODATION_DESTINATION_UNRESOLVED",
            "Please choose a more specific hotel destination.",
            422,
        )

    _, _, ident, kind = ranked[0]

    return (
        ident,
        kind,
    )


class StayApiAccommodationProvider(AccommodationProvider):
    def __init__(
        self,
        client: httpx.AsyncClient,
        settings: Settings,
    ):
        self.client = client
        self.settings = settings

        self.destinations = AccommodationCache[
            tuple[
                str,
                str,
            ]
            | None
        ](900)
        self.property_types = AccommodationCache[str | None](86400, 512)
        self.details_concurrency = asyncio.Semaphore(3)

    async def classify(self, candidate: AccommodationCandidate) -> AccommodationCandidate:
        async def load():
            async with self.details_concurrency:
                data = await self.request(
                    "/v2/booking/hotel/details",
                    {"hotel_id": candidate.provider_accommodation_id},
                )
            detail = data.get("data")
            return parse_property_type(detail) if isinstance(detail, dict) else None

        try:
            kind = await self.property_types.load(candidate.provider_accommodation_id, load)
            return candidate.model_copy(update={"accommodation_type": kind})
        except AppError:
            return candidate

    async def request(
        self,
        endpoint: str,
        params: dict,
    ) -> dict:

        key = self.settings.stayapi_api_key.get_secret_value()

        if not key:
            raise AppError(
                "ACCOMMODATION_CONFIGURATION_ERROR",
                "Live hotel search isn't configured.",
                503,
            )

        url = str(self.settings.stayapi_base_url).rstrip("/") + endpoint

        try:
            async with asyncio.timeout(25):
                response = await self.client.get(
                    url,
                    params=params,
                    headers={
                        "X-API-Key": key,
                        "Accept": "application/json",
                    },
                    timeout=httpx.Timeout(
                        connect=5.0,
                        read=20.0,
                        write=10.0,
                        pool=5.0,
                    ),
                    follow_redirects=False,
                )

        except httpx.ConnectTimeout:
            logger.warning(
                "stayapi_timeout phase=connect endpoint=%s",
                endpoint,
            )

            raise AppError(
                "ACCOMMODATION_PROVIDER_UNAVAILABLE",
                "Live hotel pricing is temporarily unavailable.",
                503,
            ) from None

        except httpx.ReadTimeout:
            logger.warning(
                "stayapi_timeout phase=read endpoint=%s",
                endpoint,
            )

            raise AppError(
                "ACCOMMODATION_PROVIDER_UNAVAILABLE",
                "Live hotel pricing is temporarily unavailable.",
                503,
            ) from None

        except (
            httpx.RequestError,
            TimeoutError,
        ) as error:
            logger.warning(
                "stayapi_transport_error endpoint=%s type=%s",
                endpoint,
                type(error).__name__,
            )

            raise AppError(
                "ACCOMMODATION_PROVIDER_UNAVAILABLE",
                "Live hotel pricing is temporarily unavailable.",
                503,
            ) from None

        if response.status_code in {
            401,
            403,
        }:
            raise AppError(
                "ACCOMMODATION_PROVIDER_AUTH_ERROR",
                "Live hotel search isn't configured.",
                503,
            )

        if response.status_code == 429:
            raise AppError(
                "ACCOMMODATION_PROVIDER_QUOTA_EXCEEDED",
                "Live hotel pricing is currently unavailable. Please try again later.",
                429,
            )

        if response.status_code in {
            400,
            422,
        }:
            logger.warning(
                "stayapi_invalid_request endpoint=%s status=%s body=%s",
                endpoint,
                response.status_code,
                response.text[:500].replace(
                    "\n",
                    " ",
                ),
            )

            raise AppError(
                "ACCOMMODATION_PROVIDER_INVALID_REQUEST",
                "The hotel provider couldn't process this search.",
                502,
            )

        if response.status_code == 404:
            return {}

        if not response.is_success:
            logger.warning(
                "stayapi_failure endpoint=%s status=%s body=%s",
                endpoint,
                response.status_code,
                response.text[:500].replace(
                    "\n",
                    " ",
                ),
            )

            raise AppError(
                "ACCOMMODATION_PROVIDER_UNAVAILABLE",
                "Live hotel pricing is temporarily unavailable.",
                503,
            )

        if len(response.content) > 2_097_152:
            raise AppError(
                "ACCOMMODATION_PROVIDER_INVALID_RESPONSE",
                "Live hotel pricing is temporarily unavailable.",
                502,
            )

        try:
            data = response.json(parse_float=Decimal)

        except ValueError:
            raise AppError(
                "ACCOMMODATION_PROVIDER_INVALID_RESPONSE",
                "Live hotel pricing is temporarily unavailable.",
                502,
            ) from None

        if not isinstance(
            data,
            dict,
        ):
            raise AppError(
                "ACCOMMODATION_PROVIDER_INVALID_RESPONSE",
                "Live hotel pricing is temporarily unavailable.",
                502,
            )

        return data

    async def search(
        self,
        request: AccommodationSearchRequest,
    ) -> list[AccommodationCandidate]:

        async def lookup() -> (
            tuple[
                str,
                str,
            ]
            | None
        ):

            result = await self.request(
                "/v1/booking/destinations/lookup",
                {
                    "query": request.destination_name,
                    "language": "en-us",
                },
            )

            if not result:
                return None

            return resolve_destination(
                result,
                request,
            )

        location = await self.destinations.load(
            (
                request.destination_key,
                request.destination_name.casefold(),
                request.destination_country,
                request.destination_admin1,
            ),
            lookup,
        )

        if location is None:
            return []

        data = await self.request(
            "/v1/booking/search",
            {
                "dest_id": location[0],
                "dest_type": location[1],
                "checkin": request.check_in.isoformat(),
                "checkout": request.check_out.isoformat(),
                "adults": request.travelers,
                "rooms": request.rooms,
                "children": 0,
                "currency": request.currency,
                "language": "en-us",
                "rows_per_page": 50,
                "offset": 0,
            },
        )

        # Current StayAPI Booking search response:
        #
        # {
        #   "success": true,
        #   "data": {
        #       "hotels": [...]
        #   }
        # }

        payload = data.get("data")

        hotels = (
            payload.get("hotels")
            if isinstance(
                payload,
                dict,
            )
            else None
        )

        if data.get("success") is not True or not isinstance(
            hotels,
            list,
        ):
            raise AppError(
                "ACCOMMODATION_PROVIDER_INVALID_RESPONSE",
                "Hotel search is unavailable.",
                502,
            )

        result: dict[
            str,
            AccommodationCandidate,
        ] = {}

        for raw in hotels[:50]:
            candidate = normalize_hotel(
                raw,
                request,
            )

            if candidate is None:
                continue

            result.setdefault(
                candidate.provider_accommodation_id,
                candidate,
            )

        candidates = list(result.values())
        # Search can omit classification. Verify a bounded shortlist against
        # details instead of labeling apartments and holiday homes as hotels.
        unknown = sorted(
            [
                c
                for c in candidates
                if c.accommodation_type is None and (c.distance_km is None or c.distance_km <= 30)
            ],
            key=lambda c: (
                -(
                    c.guest_rating / c.guest_rating_scale
                    if c.guest_rating is not None and c.guest_rating_scale
                    else 0
                ),
                -(c.review_count or 0),
                c.provider_accommodation_id,
            ),
        )[:12]
        classified = await asyncio.gather(*(self.classify(c) for c in unknown))
        result.update({c.provider_accommodation_id: c for c in classified})
        return list(result.values())
