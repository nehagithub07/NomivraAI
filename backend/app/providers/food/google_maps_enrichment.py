import asyncio
import logging
import math
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

import httpx

from app.core.config import Settings
from app.core.errors import AppError
from app.schemas.food import (
    FoodCandidate,
    FoodSearchRequest,
)
from app.services.food_policy import distance_km

logger = logging.getLogger("nomvira.food.google_maps")


MESSAGE = (
    "We couldn't load rated food recommendations right now. Your trip is safe — please try again."
)


FOOD_CATEGORY_WORDS = {
    "restaurant",
    "cafe",
    "coffee",
    "bakery",
    "bistro",
    "diner",
    "food",
    "pizza",
    "barbecue",
    "barbeque",
    "dessert",
    "ice cream",
    "fast food",
    "indian restaurant",
    "vegetarian restaurant",
    "vegan restaurant",
}


GENERIC_NAME_WORDS = {
    "restaurant",
    "restaurants",
    "cafe",
    "café",
    "hotel",
    "kitchen",
    "foods",
    "food",
    "the",
    "and",
    "branch",
    "outlet",
}


def clean_text(
    value: Any,
    maximum: int = 600,
) -> str | None:
    if not isinstance(
        value,
        str,
    ):
        return None

    result = " ".join(value.split())[:maximum]

    return result or None


def number(
    value: Any,
) -> float | None:
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


def integer(
    value: Any,
) -> int | None:
    numeric = number(value)

    if numeric is None or numeric < 0 or not numeric.is_integer() or numeric > 2_147_483_647:
        return None

    return int(numeric)


def normalized_name(
    value: str,
) -> str:
    folded = "".join(
        char
        for char in unicodedata.normalize(
            "NFKD",
            value.casefold(),
        )
        if not unicodedata.combining(char)
    )

    return " ".join(
        re.sub(
            r"[^a-z0-9]+",
            " ",
            folded,
        ).split()
    )


def meaningful_name(
    value: str,
) -> str:
    tokens = [token for token in normalized_name(value).split() if token not in GENERIC_NAME_WORDS]

    return " ".join(tokens)


def token_similarity(
    first: str,
    second: str,
) -> float:
    first_tokens = set(meaningful_name(first).split())

    second_tokens = set(meaningful_name(second).split())

    if not first_tokens or not second_tokens:
        return 0.0

    intersection = len(first_tokens & second_tokens)

    union = len(first_tokens | second_tokens)

    if union == 0:
        return 0.0

    return intersection / union


def name_similarity(
    first: str,
    second: str,
) -> float:
    first_normalized = normalized_name(first)

    second_normalized = normalized_name(second)

    if not first_normalized or not second_normalized:
        return 0.0

    if first_normalized == second_normalized:
        return 1.0

    first_meaningful = meaningful_name(first)

    second_meaningful = meaningful_name(second)

    if first_meaningful and first_meaningful == second_meaningful:
        return 0.98

    sequence_score = SequenceMatcher(
        None,
        first_normalized,
        second_normalized,
    ).ratio()

    meaningful_sequence_score = (
        SequenceMatcher(
            None,
            first_meaningful,
            second_meaningful,
        ).ratio()
        if (first_meaningful and second_meaningful)
        else 0.0
    )

    tokens = token_similarity(
        first,
        second,
    )

    containment = 0.0

    if (
        len(first_meaningful) >= 4
        and len(second_meaningful) >= 4
        and (first_meaningful in second_meaningful or second_meaningful in first_meaningful)
    ):
        containment = 0.92

    return max(
        sequence_score,
        meaningful_sequence_score,
        tokens,
        containment,
    )


def safe_website(
    value: Any,
) -> str | None:
    clean = clean_text(
        value,
        2000,
    )

    if not clean:
        return None

    try:
        url = httpx.URL(clean)

        if (
            url.scheme == "https"
            and url.host
            and not url.username
            and not url.password
            and url.port
            in (
                None,
                443,
            )
        ):
            return clean

    except (
        ValueError,
        httpx.InvalidURL,
    ):
        pass

    return None


def valid_coordinates(
    latitude: Any,
    longitude: Any,
) -> (
    tuple[
        float,
        float,
    ]
    | None
):
    lat = number(latitude)

    lon = number(longitude)

    if lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None

    return (
        lat,
        lon,
    )


def looks_like_food_place(
    categories: Any,
) -> bool:
    if not isinstance(
        categories,
        list,
    ):
        return False

    if not categories:
        return False

    combined = " ".join(
        str(category).casefold()
        for category in categories
        if isinstance(
            category,
            str,
        )
    )

    return any(word in combined for word in FOOD_CATEGORY_WORDS)


class GoogleMapsFoodEnricher:
    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient,
    ):
        self.settings = settings

        self.client = client

    def _api_key(
        self,
    ) -> str:
        key = self.settings.stayapi_api_key.get_secret_value()

        if not key:
            raise AppError(
                "FOOD_CONFIGURATION_ERROR",
                MESSAGE,
                503,
            )

        return key

    async def _search(
        self,
        request: FoodSearchRequest,
    ) -> list[dict]:
        destination_name = clean_text(
            request.destination_name,
            300,
        )

        destination_name = destination_name or f"{request.latitude},{request.longitude}"

        url = f"{str(self.settings.stayapi_base_url).rstrip('/')}/v1/google_maps/search"

        # Google Maps ranking already favors prominent/relevant
        # venues. Keep the query broad so that it can overlap
        # reliably with Geoapify's restaurant candidates.
        category = request.categories[0].replace("_", " ")
        category = "restaurants" if category in {"restaurant", "other"} else category
        cuisines = " ".join(request.cuisine_preferences)
        query = f"famous local {cuisines} {category} in {destination_name}"

        params = {
            "query": query,
            "location": (f"{request.latitude:.6f},{request.longitude:.6f}"),
            "page": 1,
            "hl": "en",
        }

        logger.info(
            "google_food_search_requested",
        )

        try:
            async with asyncio.timeout(22):
                response = await self.client.get(
                    url,
                    headers={
                        "X-API-Key": self._api_key(),
                        "Accept": "application/json",
                    },
                    params=params,
                    timeout=httpx.Timeout(
                        connect=5.0,
                        read=18.0,
                        write=10.0,
                        pool=5.0,
                    ),
                    follow_redirects=False,
                )

        except httpx.ConnectTimeout:
            logger.warning("google_food_search_timeout phase=connect")

            raise AppError(
                "FOOD_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            ) from None

        except httpx.ReadTimeout:
            logger.warning("google_food_search_timeout phase=read")

            raise AppError(
                "FOOD_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            ) from None

        except (
            httpx.RequestError,
            TimeoutError,
        ) as error:
            logger.warning(
                "google_food_search_transport_error type=%s",
                type(error).__name__,
            )

            raise AppError(
                "FOOD_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            ) from None

        if response.status_code in (
            401,
            403,
        ):
            logger.warning(
                "google_food_search_auth_error status=%d",
                response.status_code,
            )

            raise AppError(
                "FOOD_PROVIDER_AUTH_ERROR",
                MESSAGE,
                503,
            )

        if response.status_code == 429:
            logger.warning("google_food_search_rate_limited")

            raise AppError(
                "FOOD_PROVIDER_RATE_LIMITED",
                ("Rated food recommendations are temporarily busy. Please try again shortly."),
                429,
            )

        # StayAPI documents 404 when Google Maps returns no
        # result for page 1.
        if response.status_code == 404:
            logger.info(
                "google_food_search_empty",
            )

            return []

        if response.status_code in (
            400,
            422,
        ):
            logger.warning(
                "google_food_search_invalid_request status=%d",
                response.status_code,
            )

            raise AppError(
                "FOOD_PROVIDER_INVALID_REQUEST",
                MESSAGE,
                502,
            )

        if response.status_code in (
            502,
            503,
            504,
        ):
            logger.warning(
                "google_food_search_upstream_failure status=%d",
                response.status_code,
            )

            raise AppError(
                "FOOD_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            )

        if response.status_code >= 400:
            logger.warning(
                "google_food_search_failure status=%d",
                response.status_code,
            )

            raise AppError(
                "FOOD_PROVIDER_UNAVAILABLE",
                MESSAGE,
                503,
            )

        try:
            body = response.json()

        except ValueError:
            raise AppError(
                "FOOD_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            ) from None

        if not isinstance(
            body,
            dict,
        ):
            raise AppError(
                "FOOD_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            )

        if body.get("success") is False:
            raise AppError(
                "FOOD_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            )

        results = body.get("results")

        if not isinstance(
            results,
            list,
        ):
            raise AppError(
                "FOOD_PROVIDER_INVALID_RESPONSE",
                MESSAGE,
                502,
            )

        # Search returns up to 20 ranked places per page.
        output: list[dict] = []

        seen: set[str] = set()

        for item in results[:20]:
            if not isinstance(
                item,
                dict,
            ):
                continue

            identifier = (
                clean_text(
                    item.get("data_id"),
                    300,
                )
                or clean_text(
                    item.get("place_id"),
                    300,
                )
                or (f"{item.get('name')}:{item.get('latitude')}:{item.get('longitude')}")
            )

            if identifier in seen:
                continue

            seen.add(identifier)

            output.append(item)

        logger.info(
            "google_food_search_completed results=%d",
            len(output),
        )

        return output

    def _rated_results(
        self,
        google_results: list[dict],
    ) -> list[dict]:
        rated: list[dict] = []

        for item in google_results:
            name = clean_text(
                item.get("name"),
                300,
            )

            rating = number(item.get("rating"))

            reviews = integer(item.get("reviews_count"))

            coordinates = valid_coordinates(
                item.get("latitude"),
                item.get("longitude"),
            )

            if (
                not name
                or coordinates is None
                or rating is None
                or rating < 4.0
                or rating > 5.0
                or not looks_like_food_place(item.get("categories"))
            ):
                continue

            latitude, longitude = coordinates

            position = integer(item.get("position"))

            rated.append(
                {
                    "data_id": clean_text(
                        item.get("place_id") or item.get("data_id"),
                        300,
                    ),
                    "name": name,
                    "normalized": normalized_name(name),
                    "latitude": latitude,
                    "longitude": longitude,
                    "rating": rating,
                    "reviews": reviews,
                    "position": position,
                    "hours": clean_text(
                        item.get("hours_today"),
                        600,
                    ),
                    "open_state": clean_text(
                        item.get("open_state"),
                        300,
                    ),
                    "website": safe_website(item.get("website")),
                    "address": clean_text(
                        item.get("address"),
                        600,
                    ),
                    "categories": [
                        category
                        for category in (item.get("categories") or [])
                        if isinstance(
                            category,
                            str,
                        )
                    ][:10],
                }
            )

        return rated

    async def search(self, request: FoodSearchRequest) -> list[FoodCandidate]:
        """Use rated venues directly, without requiring a second provider match."""
        results = self._rated_results(await self._search(request))
        candidates: list[FoodCandidate] = []
        for item in results:
            if not item["data_id"]:
                continue
            categories = " ".join(item["categories"]).casefold()
            category = "restaurant"
            for word, value in [
                ("cafe", "cafe"),
                ("coffee", "cafe"),
                ("pub", "pub"),
                ("bar", "bar"),
                ("fast food", "fast_food"),
                ("food court", "food_court"),
                ("dessert", "dessert"),
                ("ice cream", "dessert"),
            ]:
                if re.search(r"\b" + re.escape(word) + r"\b", categories):
                    category = value
                    break
            diets = [
                diet
                for diet in ("vegetarian", "vegan", "halal", "kosher")
                if re.search(r"\b" + diet + r"\b", categories)
            ]
            cuisines = sorted(
                {
                    label.removesuffix(" restaurant").title()
                    for label in item["categories"]
                    if label.casefold().endswith(" restaurant")
                    and label.casefold()
                    not in {
                        "vegetarian restaurant",
                        "vegan restaurant",
                        "fine dining restaurant",
                        "fast food restaurant",
                    }
                }
            )
            position = item["position"]
            candidates.append(
                FoodCandidate(
                    provider="google_maps",
                    provider_place_id=item["data_id"],
                    name=item["name"],
                    category=category,
                    cuisine_types=cuisines,
                    latitude=item["latitude"],
                    longitude=item["longitude"],
                    address=item["address"],
                    website=item["website"],
                    opening_hours=None,  # hours_today is not a weekly schedule.
                    dietary_tags=diets,
                    rating=item["rating"],
                    rating_scale=5.0,
                    review_count=item["reviews"],
                    rating_source="google_maps",
                    popularity_rank=position if position and 1 <= position <= 200 else None,
                )
            )
        return candidates

    def _best_match(
        self,
        candidate: FoodCandidate,
        rated: list[dict],
    ) -> dict | None:
        best: dict | None = None

        best_score = 0.0

        for item in rated:
            distance = distance_km(
                candidate.latitude,
                candidate.longitude,
                item["latitude"],
                item["longitude"],
            )

            # A Google and Geoapify record for the same
            # restaurant should normally be very close.
            #
            # Allow a little room for differing map pins,
            # malls, resorts and large properties.
            if distance > 1.25:
                continue

            similarity = name_similarity(
                candidate.name,
                item["name"],
            )

            # Strong name similarity is required unless
            # both providers place the records almost at
            # the exact same coordinates.
            if distance <= 0.10:
                minimum_similarity = 0.55

            elif distance <= 0.35:
                minimum_similarity = 0.62

            else:
                minimum_similarity = 0.70

            if similarity < minimum_similarity:
                continue

            distance_score = max(
                0.0,
                1.0 - (distance / 1.25),
            )

            match_score = 0.82 * similarity + 0.18 * distance_score

            # Small preference for places with stronger
            # review evidence when two matches are close.
            reviews = item["reviews"] or 0

            review_bonus = min(
                0.02,
                math.log1p(reviews) / 500,
            )

            match_score += review_bonus

            if match_score > best_score:
                best = item

                best_score = match_score

        return best

    async def enrich(
        self,
        candidates: list[FoodCandidate],
        request: FoodSearchRequest,
    ) -> list[FoodCandidate]:
        if not candidates:
            return []

        google_results = await self._search(request)

        if not google_results:
            logger.info(
                "google_food_enrichment_no_results candidates=%d",
                len(candidates),
            )

            return []

        rated = self._rated_results(google_results)

        if not rated:
            logger.info(
                "google_food_enrichment_no_eligible_ratings google_results=%d",
                len(google_results),
            )

            return []

        output: list[FoodCandidate] = []

        for candidate in candidates:
            best = self._best_match(
                candidate,
                rated,
            )

            if not best:
                continue

            candidate.rating = best["rating"]

            candidate.rating_scale = 5.0

            candidate.review_count = best["reviews"]

            candidate.rating_source = "google_maps"

            candidate.popularity_rank = best["position"]

            if not candidate.opening_hours and best["hours"]:
                candidate.opening_hours = best["hours"]

            if not candidate.website and best["website"]:
                candidate.website = best["website"]

            if not candidate.address and best["address"]:
                candidate.address = best["address"]

            output.append(candidate)

        logger.info(
            (
                "google_food_enrichment_completed "
                "geoapify_candidates=%d "
                "google_candidates=%d "
                "rated_candidates=%d "
                "matched_candidates=%d"
            ),
            len(candidates),
            len(google_results),
            len(rated),
            len(output),
        )

        return output
