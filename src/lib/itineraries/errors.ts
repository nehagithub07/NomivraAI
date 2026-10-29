export function itineraryErrorMessage(code: unknown) {
  switch (code) {
    case "ITINERARY_MISSING_PLACES": return "Discover places before generating your itinerary. Your trip is saved.";
    case "ITINERARY_INVALID_TRIP": return "AI planning currently supports trips of 1–14 days with a confirmed destination.";
    case "ITINERARY_IN_PROGRESS": return "An itinerary is already being built. Wait a little, then check again.";
    case "ITINERARY_RATE_LIMITED":
    case "ITINERARY_PROVIDER_RATE_LIMITED": return "AI planning is busy. Wait a little before trying again. Your previous itinerary is safe.";
    case "ITINERARY_SETUP_REQUIRED": return "Itinerary planning needs a database setup update. Your trip is saved.";
    case "ITINERARY_CONTEXT_CHANGED": return "Your trip or saved places changed. Reload and generate a new plan.";
    case "ITINERARY_VALIDATION_FAILED":
    case "ITINERARY_PROVIDER_INVALID_RESPONSE": return "We couldn't create a reliable plan. Your previous itinerary is safe. Please try again later.";
    case "ITINERARY_PERSISTENCE_UNAVAILABLE": return "We couldn't confirm the saved itinerary. Check again before generating another version.";
    case "ITINERARY_ATTEMPT_FAILED": return "That generation did not finish. Try again to start a new attempt.";
    case "unauthorized": return "Sign in again to generate an itinerary. Your trip is saved.";
    case "auth_unavailable": return "We couldn't verify your sign-in. Try again shortly. Your trip is saved.";
    default: return "AI planning is temporarily unavailable. Your trip and previous itinerary are safe.";
  }
}
