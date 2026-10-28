from decimal import Decimal

# Transparent product heuristics, not trained or scientifically calibrated values.
BUDGET_ALLOCATION = {
    "budget": Decimal(".28"),
    "balanced": Decimal(".35"),
    "premium": Decimal(".48"),
}
BUDGET_TOLERANCE = Decimal("1.20")
MIN_GUEST_QUALITY = 0.70
WEIGHTS = {
    "budget_fit": 0.30,
    "guest_quality": 0.25,
    "location": 0.20,
    "preference": 0.15,
    "property_quality": 0.10,
}
REVIEW_PRIOR = 0.70
REVIEW_CONFIDENCE_TARGET = 1000
MAX_DISTANCE_KM = 30
ADULTS_PER_ROOM = 2  # BFF uses this same documented occupancy assumption.
