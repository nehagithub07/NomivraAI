import math

from app.schemas.food import FoodCandidate

DEFAULT_FOOD_RADIUS_METERS = 5000
MAX_FOOD_RADIUS_METERS = 15000
WEIGHTS = {
    "dietary_match": 0.30,
    "cuisine_match": 0.25,
    "distance": 0.25,
    "category_preference": 0.10,
    "data_quality": 0.10,
}
CATEGORIES = {
    name: f"catering.{name}"
    for name in ("restaurant", "cafe", "bar", "pub", "fast_food", "food_court")
}
CATEGORIES["dessert"] = "catering.ice_cream"
CUISINES = {
    name.lower(): name
    for name in (
        "Indian",
        "Italian",
        "Japanese",
        "Chinese",
        "Mexican",
        "Thai",
        "Korean",
        "French",
        "Mediterranean",
        "American",
        "Vietnamese",
        "Spanish",
        "Greek",
        "Seafood",
        "Sushi",
        "Pizza",
        "Ramen",
        "Burger",
    )
}
CUISINES["vegetarian"] = "Vegetarian-friendly"
DIET_CONDITIONS = {name: name for name in ("vegetarian", "vegan", "halal", "kosher", "gluten_free")}


def cuisine_label(raw: str) -> str:
    return CUISINES.get(raw.lower(), raw.replace("_", " ").title())


def normalize_cuisines(categories: list[str]) -> list[str]:
    # Preserve future valid cuisine subcategories without exposing raw category paths.
    return sorted(
        {
            cuisine_label(value.rsplit(".", 1)[-1])
            for value in categories
            if value.startswith("catering.restaurant.")
        }
    )


def distance_km(lat: float, lon: float, other_lat: float, other_lon: float) -> float:
    a, b = math.radians(lat), math.radians(other_lat)
    value = (
        math.sin((b - a) / 2) ** 2
        + math.cos(a) * math.cos(b) * math.sin(math.radians(other_lon - lon) / 2) ** 2
    )
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(value)))


def diet_matches(candidate: FoodCandidate, preferences: list[str]) -> bool:
    tags = {tag.removesuffix(".only") for tag in candidate.dietary_tags}
    if "vegan" in tags:
        tags.add("vegetarian")
    return all(diet in tags for diet in preferences)
