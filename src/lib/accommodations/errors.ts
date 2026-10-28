export function hotelErrorMessage(code: unknown) {
  switch (code) {
    case "ACCOMMODATION_PROVIDER_QUOTA_EXCEEDED":
      return "Live hotel pricing is currently unavailable because the provider allowance has been reached. Please try again later.";
    case "ACCOMMODATION_RATE_LIMITED":
      return "Please wait a little before searching or refreshing hotels again.";
    case "ACCOMMODATION_PROVIDER_AUTH_ERROR":
    case "ACCOMMODATION_CONFIGURATION_ERROR":
      return "Live hotel search isn't configured yet. Your trip is saved.";
    case "ACCOMMODATION_DESTINATION_UNRESOLVED":
      return "We couldn't safely match hotels to this destination. Your trip details are unchanged.";
    case "unauthorized":
      return "Sign in again to search hotels. Your trip is saved.";
    case "selection_expired":
      return "These hotel results have expired or your trip changed. Search again before selecting a stay.";
    case "selection_conflict":
      return "Your selected stay changed in another tab. Reload this page before replacing it.";
    case "setup_required":
      return "Saving a stay needs a database setup update. Your trip and hotel results are still here.";
    case "persistence_unavailable":
      return "We couldn't save this stay. Your previous selection is unchanged — please try again.";
    case "selection_unconfirmed":
      return "We couldn't confirm the saved stay. Reload this page to check your selection before trying again.";
    case "invalid_stay":
      return "Hotel search needs checkout after check-in, with a stay of up to 90 nights.";
    case "unresolved_destination":
      return "Hotel search needs a trip with confirmed destination details.";
    default:
      return "Hotel search is temporarily unavailable. Your trip is saved — please try again later.";
  }
}
