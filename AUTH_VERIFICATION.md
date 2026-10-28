# Authentication verification

The implementation is ready for project configuration. Live-provider acceptance is **pending**, not asserted complete.

## Verified locally

- TypeScript, ESLint, and the Next.js production build.
- Nine Node tests covering safe app redirects, encoded/open-redirect attempts, protected path boundaries, login/signup/reset validation, masked hints, identity fallbacks, and privacy-safe recovery responses.
- All five public authentication pages at 320, 375, 390, 430, 768, 1024, 1280, and 1440px. No horizontal overflow or automated WCAG A/AA violations were found in the tested unconfigured state.
- Logged-out direct access to Home, Trips, nested trip routes, Explore, Companion, Saved, Settings, and Help redirects to login with a safe return path.
- Invalid/missing callback inputs produce safe error destinations; raw provider descriptions and token parameters do not remain in the final URL.
- Keyboard focus, absence of the authenticated sidebar on public pages, no console/hydration warnings in the tested state, and fail-closed behavior when configuration is absent.
- Production build classifies authenticated and auth routes as dynamic; existing design-system preview stays separate.

## Still requires a configured project

- Actual signup and email delivery, confirmation, correct/incorrect credential responses from Supabase, and duplicate-account behavior.
- Real session-cookie persistence, expired-token refresh, authenticated page redirects, and logout against the configured Auth service.
- Password recovery email, cross-device token confirmation, and the final user-password update.
- Google consent, PKCE exchange, session creation, and actual provider avatar behavior.

No live Supabase URL/key or Google credentials were present. An isolated provider fixture was prepared, but automatic approval review rejected starting the configured local test server as **"blocked by policy"** without a more specific reason. Those configured-provider round trips were not completed. The temporary fixture was stopped, and the final production build was rebuilt without its test configuration.

See [AUTH_SETUP.md](AUTH_SETUP.md) for environment variables, external provider setup, email templates, and the live acceptance checklist. No authentication bypass or mock login was added to the application.
