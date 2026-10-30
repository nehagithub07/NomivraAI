import type { CompanionResponse } from "./validation";

const transientTools = new Set(["get_selected_hotel", "find_hotel_options", "find_food_options", "get_saved_food"]);
/** Keep Step 7/8's provider retention boundary in durable conversation history. */
export function persistableCompanionResponse(response: CompanionResponse) {
  const transient = response.cards.some(c => transientTools.has(c.tool_name)) || response.tool_audit.some(a => typeof a.tool_name === "string" && transientTools.has(a.tool_name));
  return {
    message: transient ? "I checked the available stay or food details. Current provider details are shown for this response only; open the trip tabs to review them again." : response.message,
    cards: response.cards.map(card => {
      if (card.tool_name === "get_selected_hotel") return { tool_name: card.tool_name, data: { selected: card.data.selected, name: null, details_available: false, total_price: null, currency: null, guest_rating: null, guest_rating_scale: null, quote_expires_at: null, booked: false } };
      if (card.tool_name === "find_hotel_options" || card.tool_name === "find_food_options") return { tool_name: card.tool_name, data: { options: [], notice: "Provider recommendations are transient. Open Hotels or Food to review current results." } };
      if (card.tool_name === "get_saved_food") {
        const options = Array.isArray(card.data.options) ? card.data.options.map((value: unknown) => {
          if (!value || typeof value !== "object") return {};
          const item = value as Record<string, unknown>;
          return { name: item.name, category: item.category };
        }) : [];
        return { tool_name: card.tool_name, data: { options, source: "Geoapify / OpenStreetMap", notice: "Only saved names/categories are retained. Check Food for current dietary metadata." } };
      }
      return card;
    }),
  };
}
