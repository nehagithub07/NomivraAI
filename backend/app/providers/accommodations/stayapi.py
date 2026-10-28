import asyncio
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
from app.schemas.accommodation import AccommodationCandidate, AccommodationSearchRequest

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
    "motel": "other",
    "other": "other",
}


def money(value) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = Decimal(str(value))
        if not result.is_finite() or not 0 <= result <= 1_000_000_000:
            return None
        return result.quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
    except (ValueError, InvalidOperation):
        return None


def number(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if result == result and abs(result) != float("inf") else None
    except (ValueError, TypeError, OverflowError):
        return None


def text(value, maximum=300) -> str | None:
    if not isinstance(value, str):
        return None
    return " ".join(value.split())[:maximum] or None


def safe_source_url(value, domain: str) -> str | None:
    if not isinstance(value, str) or len(value) > 2000:
        return None
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        if (
            url.scheme == "https"
            and not url.username
            and not url.password
            and url.port in {None, 443}
            and (host == domain or host.endswith("." + domain))
        ):
            return value
    except ValueError:
        pass
    return None


def normalize_hotel(
    raw: dict, request: AccommodationSearchRequest
) -> AccommodationCandidate | None:
    if not isinstance(raw, dict):
        return None
    ident, name = raw.get("hotel_id"), text(raw.get("name"))
    if isinstance(ident, bool) or not re.fullmatch(r"[1-9][0-9]{0,19}", str(ident)) or not name:
        return None
    price = raw.get("price") if isinstance(raw.get("price"), dict) else {}
    rating = raw.get("rating") if isinstance(raw.get("rating"), dict) else {}
    score = number(rating.get("score"))
    # StayAPI's Booking source reports guest scores on a ten-point scale.
    scale = number(rating.get("scale")) if rating.get("scale") is not None else 10.0
    if score is None or scale is None or not 0 < scale <= 100 or not 0 <= score <= scale:
        score, scale = None, None
    reviews = number(rating.get("review_count"))
    reviews = (
        int(reviews)
        if reviews is not None and 0 <= reviews <= 2_147_483_647 and reviews.is_integer()
        else None
    )
    stars = number(raw.get("star_rating"))
    stars = stars if stars is not None and 0 < stars <= 5 else None
    lat, lon = number(raw.get("latitude")), number(raw.get("longitude"))
    if lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        lat, lon = None, None
    currency = price.get("currency")
    currency = currency.strip().upper() if isinstance(currency, str) else None
    currency = currency if currency and re.fullmatch(r"[A-Z]{3}", currency) else None
    sold_out = raw.get("is_sold_out")
    available = not sold_out if isinstance(sold_out, bool) else None
    amenities = raw.get("amenities") if isinstance(raw.get("amenities"), list) else []
    try:
        return AccommodationCandidate(
            provider="stayapi",
            provider_accommodation_id=str(ident),
            name=name,
            accommodation_type=TYPE_MAP.get(str(raw.get("accommodation_type", "")).lower()),
            latitude=lat,
            longitude=lon,
            address=text(raw.get("address"), 600),
            star_rating=stars,
            guest_rating=score,
            guest_rating_scale=scale,
            review_count=reviews,
            # Gross displayed stay quote, not a guarantee of all local charges.
            total_price=money(price.get("total_price_value")) if currency else None,
            nightly_price=None,  # An untyped display amount is NOT a nightly rate.
            advertised_price=money(price.get("amount")) if currency else None,
            taxes_and_fees=money(price.get("taxes_and_charges_value")) if currency else None,
            taxes_included=None,
            currency=currency,
            distance_km=round(haversine_km(request.latitude, request.longitude, lat, lon), 3)
            if lat is not None and lon is not None
            else None,
            amenities=[value for item in amenities[:40] if (value := text(item, 100))],
            # Photo redistribution rights are source-specific and not assumed.
            image_url=None,
            booking_url=safe_source_url(raw.get("url"), "booking.com"),
            available=available,
        )
    except ValidationError:
        return None


def folded(value: str) -> str:
    return " ".join(
        "".join(
            c
            for c in unicodedata.normalize("NFKD", value.casefold())
            if not unicodedata.combining(c)
        ).split()
    )


def resolve_destination(data: dict, request: AccommodationSearchRequest) -> tuple[str, str] | None:
    suggestions = data.get("suggestions", [])
    if not isinstance(suggestions, list):
        raise AppError("ACCOMMODATION_PROVIDER_INVALID_RESPONSE", "Hotel search is unavailable.")
    options = [
        *suggestions[:5],
        {
            "dest_id": data.get("dest_id"),
            "dest_type": data.get("dest_type"),
            "label": data.get("normalized_query"),
        },
    ]
    matches = {}
    city = folded(request.destination_name.split(",")[0])
    country = folded(request.destination_country or "")
    admin = folded(request.destination_admin1 or "")
    for option in options:
        if not isinstance(option, dict):
            continue
        ident, kind = str(option.get("dest_id")), option.get("dest_type")
        label = folded(str(option.get("label") or ""))
        if not re.fullmatch(r"-?[1-9][0-9]{0,19}", ident) or kind not in {
            "CITY",
            "REGION",
            "DISTRICT",
            "LANDMARK",
        }:
            continue
        parts = [part.strip() for part in label.split(",")]
        country_matches = not country or any(
            part == country or part.startswith(country + " ") for part in parts[1:]
        )
        if parts[0] != city or not country_matches:
            continue
        matches[(ident, kind)] = 1 if admin and admin in parts[1:] else 0
    if not matches:
        if not data.get("dest_id") and not suggestions:
            return None
        raise AppError(
            "ACCOMMODATION_DESTINATION_UNRESOLVED",
            "We couldn't match hotels to this destination safely.",
            422,
        )
    best = max(matches.values())
    options = [option for option, score in matches.items() if score == best]
    if len(options) != 1:
        raise AppError(
            "ACCOMMODATION_DESTINATION_UNRESOLVED",
            "We couldn't match hotels to this destination safely.",
            422,
        )
    return options[0]


class StayApiAccommodationProvider(AccommodationProvider):
    def __init__(self, client: httpx.AsyncClient, settings: Settings):
        self.client, self.settings = client, settings
        self.destinations = AccommodationCache[tuple[str, str] | None](900)

    async def request(self, endpoint: str, params: dict) -> dict:
        key = self.settings.stayapi_api_key.get_secret_value()
        if not key:
            raise AppError(
                "ACCOMMODATION_CONFIGURATION_ERROR", "Live hotel search isn't configured.", 503
            )
        try:
            async with asyncio.timeout(18):
                response = await self.client.get(
                    str(self.settings.stayapi_base_url).rstrip("/") + endpoint,
                    params=params,
                    headers={"X-API-Key": key},
                    timeout=httpx.Timeout(15, connect=3, pool=3),
                    follow_redirects=False,
                )
        except (httpx.RequestError, TimeoutError):
            raise AppError(
                "ACCOMMODATION_PROVIDER_UNAVAILABLE",
                "Live hotel pricing is temporarily unavailable.",
                503,
            ) from None
        if response.status_code in {401, 403}:
            raise AppError(
                "ACCOMMODATION_PROVIDER_AUTH_ERROR", "Live hotel search isn't configured.", 503
            )
        if response.status_code == 429:
            raise AppError(
                "ACCOMMODATION_PROVIDER_QUOTA_EXCEEDED",
                "Live hotel pricing is currently unavailable. Please try again later.",
                429,
            )
        if not response.is_success:
            raise AppError(
                "ACCOMMODATION_PROVIDER_UNAVAILABLE",
                "Live hotel pricing is temporarily unavailable.",
                503,
            )
        try:
            data = response.json(parse_float=Decimal)
            if not isinstance(data, dict) or len(response.content) > 2_097_152:
                raise ValueError
            return data
        except ValueError:
            raise AppError(
                "ACCOMMODATION_PROVIDER_INVALID_RESPONSE",
                "Live hotel pricing is temporarily unavailable.",
                502,
            ) from None

    async def search(self, request: AccommodationSearchRequest) -> list[AccommodationCandidate]:
        async def lookup():
            result = await self.request(
                "/v1/booking/destinations/lookup",
                {
                    "query": request.destination_name,
                    "language": "en-us",
                },
            )
            return resolve_destination(result, request)

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
        hotels = data.get("data", {}).get("hotels") if isinstance(data.get("data"), dict) else None
        if data.get("success") is not True or not isinstance(hotels, list):
            raise AppError(
                "ACCOMMODATION_PROVIDER_INVALID_RESPONSE", "Hotel search is unavailable."
            )
        result = {}
        for raw in hotels[:50]:
            if candidate := normalize_hotel(raw, request):
                result.setdefault(candidate.provider_accommodation_id, candidate)
        return list(result.values())
