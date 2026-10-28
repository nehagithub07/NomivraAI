export const currencyCodes = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"] as const;
export const currencies = {
  USD: { label: "US dollar", symbol: "$" },
  EUR: { label: "Euro", symbol: "€" },
  GBP: { label: "British pound", symbol: "£" },
  INR: { label: "Indian rupee", symbol: "₹" },
  CAD: { label: "Canadian dollar", symbol: "CA$" },
  AUD: { label: "Australian dollar", symbol: "A$" },
  JPY: { label: "Japanese yen", symbol: "¥" },
} satisfies Record<(typeof currencyCodes)[number], { label: string; symbol: string }>;

export const budgetStyles = ["budget", "balanced", "premium"] as const;
export const travelPaces = ["relaxed", "balanced", "packed"] as const;
export const tripInterests = [
  "food", "history", "culture", "nature", "adventure", "art", "shopping",
  "nightlife", "beaches", "relaxation", "photography", "local_experiences",
] as const;
export const accommodationTypes = ["hotel", "hostel", "homestay", "apartment", "resort"] as const;
export const dietaryPreferences = ["vegetarian", "vegan", "halal", "kosher", "gluten_free"] as const;
export const tripStatuses = ["planning", "active", "completed", "cancelled"] as const;

export type Currency = (typeof currencyCodes)[number];
export type BudgetStyle = (typeof budgetStyles)[number];
export type TravelPace = (typeof travelPaces)[number];
export type TripInterest = (typeof tripInterests)[number];
export type AccommodationType = (typeof accommodationTypes)[number];
export type DietaryPreference = (typeof dietaryPreferences)[number];
export type TripStatus = (typeof tripStatuses)[number];

export function optionLabel(value: string) {
  if (value === "gluten_free") return "Gluten-free";
  if (value === "local_experiences") return "Local Experiences";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export const wizardSteps = [
  { label: "Destination", heading: "Where are you going?", description: "Tell us the destination you want NomviraAI to plan around.", fields: ["destination"] },
  { label: "Dates", heading: "When are you travelling?", description: "Choose the first and last day of your journey.", fields: ["startDate", "endDate"] },
  { label: "Travelers", heading: "Who's travelling?", description: "A solo adventure or a shared journey?", fields: ["travelers"] },
  { label: "Budget", heading: "What's your trip budget?", description: "Set a total budget for everyone travelling. You can choose your currency.", fields: ["budget", "currency", "budgetStyle"] },
  { label: "Interests", heading: "What do you love doing?", description: "Choose what you'd like NomviraAI to prioritize.", fields: ["interests"] },
  { label: "Preferences", heading: "How do you like to travel?", description: "A few preferences to help shape your journey.", fields: ["travelPace", "accommodationPreferences", "dietaryPreferences", "specialRequests"] },
  { label: "Review", heading: "Ready to create your trip?", description: "Check the details before saving your trip. Your itinerary comes in a later step.", fields: [] },
] as const;
