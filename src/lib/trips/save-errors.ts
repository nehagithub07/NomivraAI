import type { CreateTripResult } from "./validation.ts";

export function tripSaveFailure(error: unknown): CreateTripResult {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const missingSetup = typeof code === "string" && ["PGRST202", "PGRST204", "PGRST205", "42703", "42883"].includes(code);
  return {
    status: "error",
    message: missingSetup
      ? "Trip saving needs a setup update. Your information is still here — please try again after setup is complete."
      : "We couldn't create your trip. Your information is still here — please try again.",
  };
}
