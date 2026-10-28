import type { AuthState } from "./validation";

// Account-specific failures deliberately share the same response as a successful request.
export function recoveryResult(
  error: { code?: string; status?: number } | null,
): AuthState {
  if (
    !error ||
    [
      "user_not_found",
      "email_not_confirmed",
      "email_exists",
      "user_already_exists",
    ].includes(error.code ?? "")
  ) {
    return {
      status: "success",
      message:
        "If an account exists for that email, you’ll receive a password reset link shortly.",
    };
  }
  if (
    error.status === 429 ||
    ["over_request_rate_limit", "over_email_send_rate_limit"].includes(
      error.code ?? "",
    )
  ) {
    return {
      status: "error",
      message: "Too many attempts. Please wait a few minutes and try again.",
    };
  }
  return {
    status: "error",
    message: "We couldn’t request a reset link right now. Please try again.",
  };
}
