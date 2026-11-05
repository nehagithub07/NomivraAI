# Travel feature fixes — 5 November 2026

Discovery queries city sightseeing, museums, theme parks and zoos before ranking the results. It retains canonical OpenStreetMap IDs through Geoapify, with bounded Overpass failover. Large nearby pools no longer cut off distant landmarks before ranking. HYD resolves to Hyderabad. Saved discovery results use the same prominence ranking as fresh results.

Hotel searches match complete city/country names and reject ambiguous destination IDs. A bounded, cached details lookup verifies property classifications, so apartment listings do not satisfy a hotel preference. Only explicitly supplied total-stay prices enter budget calculations; an amount with an unknown price basis stays an advertised quote.

Food defaults to `FOOD_PROVIDER=google_maps`, using the existing private `STAYAPI_API_KEY`. Direct rated venues avoid the empty intersection of Google Maps and Geoapify listings. Only venues with a supplied rating from 4.0 to 5.0, a food category and coordinates inside the search radius qualify. Category, dietary and cuisine filters still apply; unverified dietary suitability remains unknown. City food highlights currently cover Hyderabad, Mumbai, Delhi, Jaipur and Chennai, with tourism-source links. Other destinations still receive live rated venues.

Itineraries preserve saved food source identities, retain enough candidates for longer trips, scale the output allowance with duration and require an attraction per day when enough candidates exist. Companion calls require declared functions and use the configured itinerary model if the primary model is overloaded or too slow, within the existing total deadline. The BFF allows that bounded call to finish. Confirmation remains required for trip changes.

Maps load MapLibre's CSS and module worker, render in the browser, resize with their container and update points/routes without recreating the map. Marker updates continue during tile loading. Routing requests per-leg segments, which openrouteservice omits when instructions are disabled. Old attraction coordinates can be repaired from saved places.

## Apply to an existing installation

1. Keep provider keys private in `backend/.env`; use `ACCOMMODATION_PROVIDER=stayapi`, `FOOD_PROVIDER=google_maps`, and `LLM_PROVIDER=gemini`.
2. Run `npm run db:prepare`. Run the generated private `.qa/setup-trip-database.sql` in the project's Supabase SQL Editor. It includes `20261030001000_place_refresh_and_map_backfill.sql` and `20261105001100_rated_food_provider.sql`, preserves existing trips and is safe to rerun. The generated file contains the application's internal key; it is ignored by Git.
3. Restart the backend and frontend, refresh discovery on existing trips, and search hotels/food again to replace older cached results.

The migrations were exercised against PostgreSQL through PGlite, including ownership, source identity, signed writes, upgrades and reruns. Local live checks covered Hyderabad discovery, rated food, classified hotels, a generated itinerary, a complete Companion tool/response turn and driving directions. A Chrome check covered real map tiles, markers, popups and point updates. Hosted user authentication and hosted database writes were not exercised in these checks.

Provider references: [Geoapify categories](https://apidocs.geoapify.com/docs/places/), [StayAPI search](https://stayapi.com/docs/endpoints/booking/search), [property classification](https://stayapi.com/docs/endpoints/booking/hotel-details), [Gemini models](https://ai.google.dev/gemini-api/docs/models).
