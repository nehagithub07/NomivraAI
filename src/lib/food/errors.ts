export function foodErrorMessage(code?: string) {
  if (code === "setup_required") return "Saving food spots needs a database setup update. Your existing trip is safe.";
  if (code === "selection_expired") return "Search food again before saving this place.";
  if (code === "selection_unconfirmed") return "Reload to check your saved food spots. Your last update may have succeeded.";
  if (code === "FOOD_PROVIDER_RATE_LIMITED" || code === "FOOD_RATE_LIMITED") return "Food search is busy right now. Please wait a minute before trying again.";
  if (code === "FOOD_CONFIGURATION_ERROR") return "Food search isn't configured yet. Your trip is safe.";
  if (code === "persistence_unavailable") return "We couldn't update your saved food spots. Please try again.";
  return "We couldn't load food recommendations right now. Your trip is safe — please try again.";
}
