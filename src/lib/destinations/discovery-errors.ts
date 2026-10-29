export function discoveryErrorMessage(code: unknown): string {
  switch (code) {
    case "provider_unavailable":
    case "invalid_provider_response":
      return "The places service is temporarily unavailable. Your trip is saved — please try again in a few minutes.";
    case "provider_rate_limited":
    case "discovery_in_progress":
      return "Place discovery is busy. Please wait a little before trying again. Your trip is saved.";
    case "PLACES_RATE_LIMITED":
      return "Place discovery is busy. Please try again shortly. Your trip is saved.";
    case "PLACES_PROVIDER_RATE_LIMITED":
      return "The places provider is temporarily busy. Please try again shortly. Your trip is saved.";
    case "unauthorized":
      return "Sign in again to discover places. Your trip is saved.";
    case "persistence_unavailable":
      return "We found places but couldn't save them. Your trip is safe — please try again.";
    case "database_unavailable":
      return "We couldn't load your saved trip details. Please try again.";
    case "configuration_error":
      return "Place discovery needs a setup update. Your trip is saved.";
    case "unresolved_destination":
      return "Destination details aren't available for this trip yet. Your trip is saved.";
    case "not_found":
      return "This trip couldn't be found. Return to My Trips and open it again.";
    default:
      return "We couldn't load places right now. Your trip is safe — please try again.";
  }
}
