export class AuthVerificationUnavailableError extends Error {
  constructor() {
    super("We couldn't verify your sign-in right now. Please try again shortly.");
    this.name = "AuthVerificationUnavailableError";
  }
}
