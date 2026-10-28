# NomviraAI authentication setup

Authentication is implemented in the **client Next.js app** using real `@supabase/supabase-js` and `@supabase/ssr`. No database tables or FastAPI changes are involved. External project configuration is required before live sign-in works.

## Environment

Copy `.env.example` to an ignored `client/.env.local` and fill in:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Use the current **publishable** key starting with `sb_publishable_`. This implementation rejects secret/service-role keys and legacy JWT-shaped keys. Never put a database password, service-role key, Google client secret, or user tokens into these variables.

`NEXT_PUBLIC_SITE_URL` is the canonical application origin, without a path or query. Development defaults to `http://localhost:3000`; explicitly configure the real HTTPS origin in production. Auth redirects never derive their origin from untrusted forwarded-host headers. If testing a different port, set this variable accordingly. Restart development after changing variables, and supply public variables **at build time** for a production deployment.

With missing configuration, auth forms show an unavailable message and protected routes redirect to sign-in. There is no mock login or authentication bypass.

## Supabase Dashboard

1. Create/select your Supabase project. Copy its Project URL and publishable key from the Connect dialog/API settings.
2. Under Authentication → URL Configuration, set the Site URL to your application origin. Use localhost for a development project, and your production HTTPS origin for production.
3. Add redirect destinations for your environment:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/auth/confirm`
   - Your production equivalents, e.g. `https://YOUR_DOMAIN/auth/callback` and `https://YOUR_DOMAIN/auth/confirm`.
   - For local development only, `http://localhost:3000/**` can accommodate callback query parameters and preview ports you explicitly configure. Use narrowly scoped allow-list entries in production and test the callbacks with their query parameters.
4. Enable the Email provider and **Confirm email**. Set the minimum password length to **8** to match the UI. If you add stronger project password rules later, update the shared Zod schema and displayed requirements to match.
5. Configure SMTP for actual delivery to your users. Supabase's built-in development mail service has delivery restrictions and rate limits. Check the Auth/email logs when a link does not arrive; do not copy token URLs into application logs.
6. Enable the Google provider using the credentials described below.

## Required email templates

The application has two server endpoints: `/auth/confirm` verifies email token hashes, and `/auth/callback` exchanges PKCE authorization codes. Use these templates to make confirmation and recovery work across devices without exposing tokens to client code.

For **Confirm signup**, replace the confirmation link target with:

```html
<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email"
  >Confirm your email</a
>
```

The signup action always supplies a validated URL of the form `SITE_ORIGIN/auth/confirm?next=SAFE_APP_PATH` as `emailRedirectTo`. The initial query is already present, hence the `&amp;` separator. Use this template with the supplied signup action. Supabase's Site URL fallback must not silently replace `.RedirectTo`; verify URL Configuration is correct.

A simpler fixed-origin template, if preserving the requested page after signup is unnecessary, is:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email"
  >Confirm your email</a
>
```

For **Reset password**, use:

```html
<a
  href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery"
  >Reset your password</a
>
```

Recovery verification creates a real Supabase session and redirects to `/reset-password`. The update action verifies the current user again before calling `updateUser`. A signed-in user can also update their own password there. Signed-out direct visits cannot submit a password change.

The reset-request action also supplies `/auth/callback?flow=recovery` for Supabase's standard PKCE recovery link. That callback requires the same browser's PKCE verifier cookie. The token-hash template above supports opening a recovery email in another browser. Missing, expired, reused, and invalid links produce a safe error state with no token in the final URL. Email security scanners can consume single-use links; test your SMTP/scanner setup.

## Google Cloud and Supabase Google provider

1. Create/select a Google Cloud project and configure its OAuth consent screen, application name, audience, and test users while the app is in testing.
2. Create an OAuth 2.0 **Web application** client.
3. Add your application origins where Google requests authorized JavaScript origins, e.g. `http://localhost:3000` and your production HTTPS origin.
4. The Google **authorized redirect URI is Supabase's callback**, not the Next.js route:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```

   Copy the exact callback URL shown in Supabase's Google provider settings, especially if using a custom Supabase domain.

5. Enter Google's client ID and client secret **only in Supabase → Authentication → Providers → Google** and enable the provider. Do not place the secret in `.env.local`, frontend source, or any `NEXT_PUBLIC_` variable.
6. Supabase's application redirect allow-list must separately permit your **Next.js** `/auth/callback` URL. Google returns to Supabase; Supabase returns to Next.js; Next.js exchanges the code using the SSR PKCE verifier cookie.

## Architecture and security

- Canonical authenticated Home stays `/`; all Step 2/3 navigation is preserved.
- Next.js **16.4.3** uses `src/proxy.ts`, not `middleware.ts`. Its matcher covers application routes and public auth pages, excluding static assets and the independent design-system preview. Callback handlers manage their own cookies.
- Proxy verifies identity using `getUser`, refreshes sessions through the SSR SDK, forwards refreshed request cookies, and copies response cookies across redirects. A second request-cached `getUser` check in the `(app)` layout protects rendered content. Home also uses that shared check for its greeting. `getSession().user` is never trusted for authorization. The installed auth SDK's optional `sb_flow_id` is forwarded to `exchangeCodeForSession` so concurrent PKCE flows select their corresponding verifier.
- App and auth layouts are dynamic. Authenticated responses, callbacks, and cookie-refresh responses are private/no-store. Deploying proxies/CDNs must honor these headers and never cache authenticated HTML or Set-Cookie responses.
- `safeNextPath` permits only application paths, rejects external/protocol-relative/encoded redirects and auth loops, and strips credential query parameters and fragments. Redirect inputs are checked again in every action and callback.
- All credential operations use Server Actions with Next.js's same-origin protection. Logout uses `signOut({ scope: 'local' })` and invalidates the Router Cache. Failed logout remains an error, never a false success.
- The browser client uses the SSR package's cookie persistence. Each server request creates its own client. No hand-written JWT cookies, localStorage session system, or service-role client exists.
- Only names, initials, and a validated Google avatar URL reach the profile client component. Avatar failures fall back to initials or the generic user icon. All trips and recommendations remain mock data.
- Signup verification shows only a masked email hint in a short-lived HttpOnly cookie. Existing-account signup and password-recovery responses do not announce account existence.
- Next.js development Server Function argument logging is disabled. Incoming auth callback URL logging is suppressed because those URLs contain one-time tokens. Configure your hosting/access/error-monitoring tools to redact query strings on `/auth/callback` and `/auth/confirm` too. The application never logs credentials or raw auth objects.
- No profile table, onboarding, travel storage, magic-link-only login, phone auth, MFA, or other providers are implemented.

## Validation and live verification

```sh
npm run test:auth
npm run lint
npm run typecheck
npm run build
```

The helper tests use Node's built-in test runner (Node 22.6+ supports stripping the TypeScript sources); no test framework dependency was added. Browser tooling and an optional local provider fixture are isolated under ignored `.qa`. Configured-provider tests were not completed because automatic approval review rejected starting the configured test server as "blocked by policy." No live Supabase project or Google credentials were available. Public UI/helper tests are **not a substitute for live Supabase/Google verification**.

After adding your real configuration, verify:

- Signup, names in Auth metadata, masked verification page, confirmation link, duplicate signup, and expired/reused confirmation.
- Correct/incorrect password, unconfirmed email, and a safe `/login?next=/trips` return destination.
- Signed-in `/login` and `/signup` redirect; refresh and a new browser tab preserve the session.
- Reset request for known and unknown emails shows the same privacy-safe success text; recovery link, expired link, mismatched passwords, and successful password update behave correctly.
- Google consent, callback, PKCE exchange, actual user name/avatar, and consent cancellation work in your configured environment.
- Logout, then refresh/direct `/`, `/trips`, `/settings`, and `/trips/new` access return to login. A different signed-in browser session remains signed in after local-scope logout.

Official references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [password authentication](https://supabase.com/docs/guides/auth/passwords), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls), [Google OAuth](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
