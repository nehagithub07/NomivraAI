from app.providers.food.base import FoodProvider
from app.schemas.food import FoodCandidate, FoodSearchRequest
from app.services.food_policy import diet_matches


class FixtureFoodProvider(FoodProvider):
    """Fictional, coordinate-relative development cases; never real restaurant claims."""

    async def search(self, request: FoodSearchRequest) -> list[FoodCandidate]:
        rows = [
            ("garden", "Demo Garden Kitchen", "restaurant", ["Indian"], ["vegetarian"], 1.2, True),
            ("corner", "Demo Corner Table", "restaurant", ["Japanese"], [], 0.3, False),
            (
                "green",
                "Demo Green Bowl",
                "restaurant",
                ["Mexican"],
                ["vegan", "gluten_free"],
                0.9,
                True,
            ),
            ("coffee", "Demo Morning Coffee", "cafe", [], ["vegan"], 0.5, False),
            ("pasta", "Demo Pasta House", "restaurant", ["Italian"], ["vegetarian"], 2.1, True),
            ("grill", "Demo Halal Grill", "restaurant", ["Indian"], ["halal"], 1.7, False),
            ("tacos", "Demo Quick Tacos", "fast_food", ["Mexican"], [], 1.1, False),
            ("bar", "Demo Evening Bar", "bar", [], [], 0.7, True),
            ("pub", "Demo Local Pub", "pub", ["American"], [], 1.5, False),
            ("court", "Demo Food Hall", "food_court", ["Japanese"], [], 2.2, False),
            ("far", "Demo Distant Diner", "restaurant", ["Italian"], [], 20, False),
            (
                "kosher",
                "Demo Kosher Kitchen",
                "restaurant",
                ["Mediterranean"],
                ["kosher"],
                2.3,
                False,
            ),
        ]
        result = []
        for place_id, name, category, cuisines, diets, distance, complete in rows:
            lat = request.latitude + distance / 111.195
            if lat > 90:
                lat = request.latitude - distance / 111.195
            candidate = FoodCandidate(
                provider="fixture",
                provider_place_id=f"demo-{place_id}",
                name=name,
                category=category,
                cuisine_types=cuisines,
                latitude=lat,
                longitude=request.longitude,
                address="Fictional development address" if complete else None,
                dietary_tags=diets,
                website="https://example.com" if complete else None,
                opening_hours="Mo-Sa 09:00-21:00" if complete else None,
            )
            if category in request.categories and (
                not request.dietary_preferences
                or diet_matches(candidate, request.dietary_preferences)
            ):
                result.append(candidate)
        return result[: request.limit]
