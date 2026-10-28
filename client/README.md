# NomviraAI client — Steps 1–4

A light design system, responsive application shell, sample travel dashboard, and Supabase authentication foundation. Live authentication requires the external configuration described in [AUTH_SETUP.md](AUTH_SETUP.md). Travel data and the trip creation flow remain unimplemented/mock.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000 for the application shell. The development-only style preview remains at http://localhost:3000/design-system, outside the application shell. It returns 404 in production and carries no-index metadata.

## Validate

```sh
npm run lint
npm run typecheck
npm run build
npm run test:auth
```

## Foundation

- Next.js App Router, TypeScript, Tailwind CSS v4, Geist via `next/font`.
- Locally owned shadcn/ui components in `src/components/ui`, using Radix for accessible select and slot behavior.
- Semantic light-theme tokens and typography utilities in `src/app/globals.css`. Tailwind v4 maps them through `@theme inline`; no separate Tailwind configuration is needed.
- Nomvira primitives in `src/components/nomvira`: wordmark, section heading, icon button, surface card, accent badge, and page container.
- Use `Button` variants `default`, `secondary`, `ghost`, `destructive`, and `accent`. The `loading` prop disables native buttons and exposes `aria-busy`. Use native buttons for loading and disabled states; `asChild` is for enabled links.
- Inputs and selects are 48px tall; default buttons and circular icon buttons are 44px. Controls use 12–14px corners, cards 18px, panels 24px, and feature panels 28px.
- Use `SurfaceCard` variants `standard`, `interactive`, `muted`, and `accent`. Supply a real button or link inside interactive cards. Hover lift is capped at 2px.
- The 4px spacing rhythm supports 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, and 96px. Page padding is 16px mobile, 24px tablet, 32px desktop.
- Supporting text uses `muted-foreground`; the lighter `text-muted` token is reserved for decoration. Orange backgrounds use dark text. Accent foreground is deepened for readable small labels.
- Lucide stroke width is centralized at 1.65. Transitions use 180ms ease-out, and reduced-motion preferences are respected.

Design-system controls keep state only in memory and reset on refresh. Their form examples do not submit or save data. No server-folder files are used.

## Application shell

- `src/app/(app)/layout.tsx` owns the shared shell and now requires a verified Supabase user before rendering. Proxy provides an additional route/session check; neither boundary simulates a signed-in session.
- Home uses `/`, replacing the temporary development redirect. Placeholder modules use `/trips`, `/explore`, `/companion`, `/saved`, `/settings`, and `/help`. `/trips/new` is a placeholder destination for every New Trip action.
- `src/components/nomvira/layout` contains the server-rendered shell, sidebar, header, mobile navigation, and reusable `PageHeader`. Client boundaries are limited to pathname-aware navigation and context, the tablet drawer, and the profile dropdown.
- `navigation/navigation-config.ts` supplies desktop, tablet, and mobile navigation from one definition. Active matching respects path segment boundaries and keeps My Trips active on nested trip routes.
- At 1024px and above, a fixed 256px sidebar offsets the main area. From 768–1023px, a keyboard-accessible sheet provides navigation. Below 768px, a fixed 64px bottom navigation includes safe-area padding; main content reserves additional bottom space.
- The existing `PageContainer` is reused with a 1440px shell-specific maximum. Step 1's tokens, typography, spacing, radii, and existing primitives are unchanged.
- The profile dropdown links to Settings and Help and signs out through a Supabase Server Action. Its name and avatar/initials come from the verified user. Profile remains a disabled future feature. Search is a focusable, read-only visual placeholder; notifications are marked unavailable. There is no command palette, fake search, or unread count.
- `EmptyState` is a small server-rendered component shared by all placeholder pages. Real module implementations can replace each page's content without changing the shell.
- Radix Dialog and Dropdown Menu are the only added runtime dependencies, backing locally owned shadcn-style sheet and dropdown components with focus management, keyboard interaction, and Escape dismissal.

## Home Dashboard

- `/` renders the mostly server-rendered dashboard from `src/components/nomvira/dashboard`. It reuses the existing shell, surfaces, section headings, buttons, inputs, badges, typography, and empty-state component. No theme tokens, shell behavior, or existing module placeholders were changed for Step 3.
- `src/lib/mock/dashboard.ts` centralizes the typed mock user, upcoming trip, destination recommendations, recent trips, and example insight. `UpcomingTrip`, `RecommendedDestination`, `RecentTrip`, and `DashboardData` describe the presentation data. Pass replacement data into `HomeDashboard` without changing the cards.
- The fixture contains an April 2027 upcoming trip and completed 2026 trips. The greeting uses "Welcome back" to keep rendering stable across server and browser time zones. Step 4 replaces the fixture's greeting identity with the verified user's first name; trip data is unchanged. `travel-format.ts` formats date-only values in UTC and sample budgets in the fixture's currency.
- The destination starter uses Next.js `Form` with a string action. It navigates to `/trips/new?destination=...` with encoded text; it does not call an API or provide autocomplete. The Create Trip page stays a placeholder.
- Continue planning and recent-trip links lead to `/trips/[tripId]` placeholders, statically generated only for the fixture IDs. Unknown IDs return 404. No trip workspace is implemented. Recommendation and insight links navigate to the existing `/explore` placeholder with a destination query.
- Recommendations use a horizontal snap row on mobile, two columns at tablet widths, and four at 1280px and above. The upcoming trip uses a 60/40 information/visual split at 1280px and stacks below it. Existing shell padding protects content from the mobile bottom navigation.
- Five original local SVG illustrations live in `public/destinations`. No photos were downloaded or hotlinked. Next.js `Image` reserves their layout space. These small local recommendation assets load eagerly so the empty-dashboard view can show them immediately; reassess loading priority when replacing them with larger photos.
- The budget progress bar exposes its numeric value and a readable currency summary. All dashboard values are labeled as sample data, and the insight is explicitly an example rather than a claim of learned personalization.
- `Skeleton` was absent from Step 1, so a small conventional shadcn/ui skeleton primitive was added without dependencies. `dashboard-skeletons.tsx` exports reusable upcoming-trip, destination-card, recent-trip, and full-dashboard skeletons. Reduced-motion preferences disable the pulse.
- In development, open `/?preview=empty` for a user with no trips or `/?preview=loading` for the skeleton preview. The empty preset clears upcoming and recent trips while retaining recommendations and an appropriate example insight. Production ignores these preview flags. There is no fake loading delay or API lifecycle.

Other modules and `/trips/new` remain placeholders. Authentication does not add a trip wizard or database schema.

## Authentication

- Follow [AUTH_SETUP.md](AUTH_SETUP.md) for `.env.local`, Supabase Email/Google providers, Site URL/redirect configuration, SMTP, and the required verification/recovery email templates.
- Public routes are `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/verify-email`. `/auth/confirm` verifies token hashes; `/auth/callback` exchanges PKCE codes.
- Next.js 16 uses `src/proxy.ts` to refresh cookie sessions and redirect logged-out app requests. The `(app)` layout independently verifies users. App/auth layouts render dynamically and auth responses use private/no-store headers.
- `src/lib/supabase` owns browser/server/proxy clients. `src/lib/auth` owns validated Server Actions, session checks, safe redirect paths, and sanitized identity. There is no service-role client or custom JWT/localStorage authentication.
- Shared auth components reuse the original tokens, surfaces, controls, and typography. They provide password visibility, inline errors, disabled/pending states, and Zod validation. Signup only requests names, email, and password.
- Authenticated names replace the dashboard fixture identity; trip information remains sample data. Header identity uses a Google avatar when available, then initials or a generic icon.
- Run `npm run test:auth` for nine tests covering redirects, validation, masking, privacy-safe recovery responses, and identity fallbacks. Browser tooling remains isolated in ignored `.qa`. Live email/OAuth/session round trips must be verified after configuring the external project; helper/UI checks alone do not establish that the providers work.

No trip persistence, profile database, onboarding, or additional authentication providers were added.
