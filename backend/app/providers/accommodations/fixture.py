from decimal import Decimal

from app.providers.accommodations.base import AccommodationProvider
from app.providers.places.overpass import haversine_km
from app.schemas.accommodation import AccommodationCandidate, AccommodationSearchRequest

# Fictional properties. Prices are generated demo inputs, never real inventory.
# USD-equivalent fixture units are localized using demo-only constants, not FX rates.
DEMO_UNITS = {"USD": 1, "EUR": 1, "GBP": 1, "INR": 80, "JPY": 140, "CAD": 1, "AUD": 1}
FIXTURES = [
    ("garden", "Demo Garden House", "hotel", 3, 8.8, 10, 850, 85, 0.004, 0.002),
    ("courtyard", "Demo Courtyard Hotel", "hotel", 4, 9.0, 10, 2800, 115, 0.008, 0.004),
    ("grand", "Demo Grand Retreat", "hotel", 5, 9.5, 10, 6000, 220, 0.01, 0.01),
    ("budget", "Demo Simple Stay", "hotel", 3, 7.8, 10, 700, 55, 0.015, 0.002),
    ("premium", "Demo Summit Resort", "resort", 5, 4.8, 5, 4500, 280, 0.02, 0.01),
    ("hostel", "Demo Trail Hostel", "hostel", None, 8.4, 10, 950, 25, 0.006, 0.0),
    ("apartment", "Demo Town Apartment", "apartment", None, 4.6, 5, 120, 75, 0.003, 0.007),
    ("homestay", "Demo Family Homestay", "homestay", None, 9.1, 10, 180, 65, 0.012, 0.0),
    ("new", "Demo New Arrival", "hotel", 3, None, None, None, 90, 0.005, 0.0),
    ("few-reviews", "Demo Tiny Hideaway", "hotel", 4, 9.8, 10, 8, 145, 0.01, 0.004),
    ("far", "Demo Distant Lodge", "hotel", 4, 8.6, 10, 1200, 105, 0.25, 0.0),
    ("over-budget", "Demo Private Estate", "hotel", 5, 9.3, 10, 4000, 650, 0.01, 0.003),
    ("poor", "Demo Low Review Inn", "hotel", 3, 6.8, 10, 200, 20, 0.002, 0.0),
    ("no-price", "Demo Unpriced Guest House", "guest_house", None, 8.2, 10, 210, None, 0.01, 0.0),
]


class FixtureAccommodationProvider(AccommodationProvider):
    async def search(self, request: AccommodationSearchRequest) -> list[AccommodationCandidate]:
        candidates = []
        for ident, name, kind, stars, rating, scale, reviews, price, dlat, dlon in FIXTURES:
            lat = max(-90, min(90, request.latitude + dlat))
            lon = ((request.longitude + dlon + 180) % 360) - 180
            nightly = (
                Decimal(price * DEMO_UNITS[request.currency] * request.rooms).quantize(
                    Decimal(".01")
                )
                if price is not None
                else None
            )
            candidates.append(
                AccommodationCandidate(
                    provider="fixture",
                    provider_accommodation_id=ident,
                    name=name,
                    accommodation_type=kind,
                    star_rating=stars,
                    guest_rating=rating,
                    guest_rating_scale=scale,
                    review_count=reviews,
                    latitude=lat,
                    longitude=lon,
                    nightly_price=nightly,
                    total_price=nightly * request.nights if nightly is not None else None,
                    currency=request.currency,
                    available=None,
                    distance_km=round(
                        haversine_km(request.latitude, request.longitude, lat, lon), 3
                    ),
                    amenities=["Demo Wi-Fi", "Demo breakfast"] if ident != "new" else [],
                )
            )
        return candidates
