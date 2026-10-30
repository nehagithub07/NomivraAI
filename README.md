# NomivraAI client  

**Step 12: AI Travel Companion** is available per owned trip at
`/trips/[tripId]/companion`. It extends the existing Gemini provider with manual,
validated function calling, source cards, private chat history, and confirmation
cards for seven explicit trip changes. Apply migration
`20261030000900_ai_companion.sql` before use. See the [feature guide](docs/features/ai-companion.md),
[architecture](docs/architecture/system-architecture.md), and
[implementation/validation record](docs/history/step-12.md).

A light design system, responsive application shell, Home dashboard, Supabase authentication, and a Create Trip Wizard with user-owned PostgreSQL data. Destination discovery, hotel/food recommendations, AI itinerary planning, deterministic budgets, weather adaptation and trip chat use the existing Next.js BFF, FastAPI services and signed Supabase persistence. Public providers remain subject to their terms; Gemini requires a private API key. Follow [authentication setup](docs/setup/authentication.md), [database setup](docs/setup/database.md), [backend setup](backend/README.md), [AI itineraries](docs/features/ai-itinerary.md), and [budget tracking](docs/features/budget-engine.md).

## Run locally

For Vercel + Render deployment, follow the [deployment guide](docs/deployment/deployment.md). The Next.js
app and FastAPI API deploy as separate services; Supabase remains the auth/database.

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
npm run test:trips
npm run test:destinations
npm run test:accommodations
npm run test:food
npm run test:itineraries
npm run test:budget
npm run test:weather
npm run test:companion
npm run test:deployment
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
- Home uses `/`, My Trips uses `/trips`, creation uses `/trips/new`, and the dynamic overview uses `/trips/[tripId]`. Explore, Companion, Saved, Settings, and Help remain placeholders.
- `src/components/nomvira/layout` contains the server-rendered shell, sidebar, header, mobile navigation, and reusable `PageHeader`. The trip wizard adds a client form boundary while reusing this shell.
- `navigation/navigation-config.ts` supplies desktop, tablet, and mobile navigation from one definition. Active matching respects path segment boundaries and keeps My Trips active on nested trip routes.
- At 1024px and above, a fixed 256px sidebar offsets the main area. From 768–1023px, a keyboard-accessible sheet provides navigation. Below 768px, a fixed 64px bottom navigation includes safe-area padding; main content reserves additional bottom space.
- The existing `PageContainer` is reused with a 1440px shell-specific maximum. Step 1's tokens, typography, spacing, radii, and existing primitives are unchanged.
- The profile dropdown links to Settings and Help and signs out through a Supabase Server Action. Its name and avatar/initials come from the verified user. Profile remains a disabled future feature. Search is a focusable, read-only visual placeholder; notifications are marked unavailable. There is no command palette, fake search, or unread count.
- `EmptyState` is a small server-rendered component shared by all placeholder pages. Real module implementations can replace each page's content without changing the shell.
- Radix Dialog and Dropdown Menu back the shell controls. Step 5 adds React Hook Form and its Zod resolver; no state-management or date library was added.

## Home Dashboard

- `/` renders the mostly server-rendered dashboard from `src/components/nomvira/dashboard`. It reuses the existing shell, surfaces, section headings, buttons, inputs, badges, typography, and empty-state component. No theme tokens, shell behavior, or existing module placeholders were changed for Step 3.
- The upcoming card uses the nearest real planning/active trip with `start_date >= today` (UTC day for this server-rendered query), ordered by start date. No result uses the existing no-trip state; database failures show an error. No weather, activity counts, or budget spending is fabricated.
- `src/lib/mock/dashboard.ts` retains destination recommendations, recent-trip examples, and insight, clearly labeled as sample content. Recent sample cards do not link to fabricated trip IDs. The greeting uses verified user identity. `travel-format.ts` formats date-only values in UTC and preserves decimal budget amounts.
- Home's destination starter navigates to `/trips/new?destination=...`, prefilling search text. The user still selects and resolves a real destination. The overview fetches real UUID trips through the authenticated session and RLS; missing or inaccessible trips return not-found.
- Recommendations use a horizontal snap row on mobile, two columns at tablet widths, and four at 1280px and above. Existing shell padding protects content from the mobile bottom navigation.
- Five original local SVG illustrations live in `public/destinations`. No photos were downloaded or hotlinked. Next.js `Image` reserves their layout space. These small local recommendation assets load eagerly so the empty-dashboard view can show them immediately; reassess loading priority when replacing them with larger photos.
- The upcoming card displays the saved total budget and styles. Recommendations, insights, and recent examples retain their sample labels.
- `Skeleton` was absent from Step 1, so a small conventional shadcn/ui skeleton primitive was added without dependencies. `dashboard-skeletons.tsx` exports reusable upcoming-trip, destination-card, recent-trip, and full-dashboard skeletons. Reduced-motion preferences disable the pulse.
- In development, open `/?preview=empty` for a user with no trips or `/?preview=loading` for the skeleton preview. The empty preset clears upcoming and recent trips while retaining recommendations and an appropriate example insight. Production ignores these preview flags. There is no fake loading delay or API lifecycle.

## Create Trip Wizard and persistence

The seven steps are **Destination → Dates → Travelers → Budget → Interests → Preferences → Review**. A single React Hook Form instance retains values on Back and Review Edit. Continue validates the current step; the shared Zod schema validates the full submission again on the server.

- Destination uses authenticated Open-Meteo search (3–100 query characters), canonical provider metadata and a signed proof. Selection is immediate; no billing session token or redundant Details call is used. Native date inputs reuse the existing Input because no Calendar/date library existed. Dates stay `YYYY-MM-DD`; duration includes both endpoints. Past starts use the browser's IANA time zone, checked on the server and RPC too.
- Travelers range from 1–20. Currency definitions are centralized. Budgets stay decimal text until PostgreSQL `numeric(12,2)`, with at most two decimals and a limit of 100,000,000. The trip wizard does not perform exchange-rate conversion; Step 10 derives deterministic category allocations from the saved trip budget.
- Interests require 1–8 selections. Balanced style/pace, 1 traveler, and Hotel are defaults. An empty dietary array means No preference. Optional special requests are limited to 500 characters.
- Accessible option inputs, step announcements, field errors, loading states, and duplicate-click protection are included. Database/network errors preserve values. An expired session offers sign-in in another tab. Drafts remain in memory; refresh/leaving clears them.
- The authenticated Server Action explicitly maps user input and sends signed provider data to `create_resolved_trip`, which validates identity/proof and reuses Step 5's atomic trip/interests creation. Canonical name, provider ID, display name, country/admin fields, coordinates, timezone and feature/population data are persisted. Both trip tables retain RLS, restricted grants, constraints, and indexes.
- My Trips and the UUID overview use real user-owned rows. The overview displays the saved requirements and links to Hotels, Food, Itinerary, and Budget. Trip edit/delete UI remains future work.

See [database setup](docs/setup/database.md) for migration deployment, existing legacy-table preservation, columns/policies/indexes, and manual type alignment. See [the Step 5 record](docs/history/step-05.md) for the file list and verification results.

If creating a trip, saving a stay, saving a food spot, generating an itinerary, or storing budget entries needs a database setup update, run `npm run db:prepare`. Run the generated private `.qa/setup-trip-database.sql` in your Supabase SQL Editor to install missing Step 6/7/8/9/10 migrations and configure the matching database secret atomically. The command prepares the file without changing the hosted database; see [backend/README.md](backend/README.md#database-migration-and-deployment). Existing trips are retained. Recent destination searches are cached in memory to avoid repeated provider and authentication requests.

## Authentication

- Follow [authentication setup](docs/setup/authentication.md) for `.env.local`, Supabase Email/Google providers, Site URL/redirect configuration, SMTP, and the required verification/recovery email templates.
- Public routes are `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/verify-email`. `/auth/confirm` verifies token hashes; `/auth/callback` exchanges PKCE codes.
- Next.js 16 uses `src/proxy.ts` to refresh cookie sessions and redirect logged-out app GETs. The `(app)` layout and data operations independently verify users. A trip action POST can return an expired-session error without discarding the form. App/auth layouts remain dynamic with private/no-store responses.
- `src/lib/supabase` owns browser/server/proxy clients. `src/lib/auth` owns validated Server Actions, session checks, safe redirect paths, and sanitized identity. There is no service-role client or custom JWT/localStorage authentication.
- Shared auth components reuse the original tokens, surfaces, controls, and typography. They provide password visibility, inline errors, disabled/pending states, and Zod validation. Signup only requests names, email, and password.
- Authenticated names replace the dashboard fixture identity. Header identity uses a Google avatar when available, then initials or a generic icon. Upcoming-trip information uses saved user data.
- Run `npm run test:auth` for nine tests covering redirects, validation, masking, privacy-safe recovery responses, and identity fallbacks. Browser tooling remains isolated in ignored `.qa`. Live email/OAuth/session round trips must be verified after configuring the external project; helper/UI checks alone do not establish that the providers work.

Step 6 adds `GeocodingProvider`/`PlacesProvider` interfaces with Open-Meteo/Overpass adapters, authenticated BFF routes, accessible search, and deliberate attraction discovery. Trip Overview reuses persisted cards without provider calls on render. [backend/README.md](backend/README.md) documents the internal key, forward migration, provider terms/attribution, limits and both development servers. [STEP6_REPORT.md](STEP6_REPORT.md) records implementation and verification. No profile database, onboarding, or additional authentication providers were added.

## Hotel recommendations

Open a saved trip and choose **Hotels**. **Find stays** performs a deliberate search; filters and all five sorts operate on the loaded candidates. Cards keep star classification separate from guest scores and prioritize known total-stay quotes. Replacement asks for confirmation. The selected stay is visible on Hotels and Overview and remains saved when temporary quotes expire.

Local development is configured for clearly labeled demo accommodations without any StayAPI requests. For live inventory, configure `STAYAPI_API_KEY` and `ACCOMMODATION_PROVIDER=stayapi` in **backend/.env**, then restart FastAPI. The key never belongs in the root environment or browser. Production disables fixture search. Read [Accommodation Engine setup](backend/README.md#accommodation-engine) and [STEP7_REPORT.md](STEP7_REPORT.md) for quota behavior, ranking assumptions, storage policy and verification limits. Apply migration `20261028000400_accommodation_selections.sql` before saving a stay; `db:prepare` includes it automatically.

## Food recommendations

Open a saved trip and choose **Food**. **Find food spots** searches around its trusted destination coordinates. Category, cuisine, diet and distance filters refine loaded places; **Search food again** updates the provider pool and deterministic recommendations. Recommended, Distance and Name sorting make no provider calls. Cards use category illustrations and genuine supplied metadata, without fabricated ratings or guessed opening status.

Configure `GEOAPIFY_API_KEY` and `FOOD_PROVIDER=geoapify` only in **backend/.env**, then restart FastAPI. Development also supports explicit `FOOD_PROVIDER=fixture` or **Browse demo food spots** after an error; fixtures are disabled in production. Multiple places can be saved without scheduling them, and removal asks for confirmation. Apply `20261029000500_food_selections.sql` before saving; `db:prepare` includes it. See [Food Engine setup](backend/README.md#food-engine) and [STEP8_REPORT.md](STEP8_REPORT.md) for limits, ranking, source attribution, tests and the remaining external activation steps. Run `npm run test:food` for Food domain, BFF and PostgreSQL/RLS checks.

## AI itinerary planning

Open a saved trip and choose **Itinerary**. Step 9 uses Gemini as a planner over
trusted trip preferences, discovered attractions and optional saved food/selected
hotel references. The server validates IDs, dates and pace limits, fills display
facts from real candidates, then saves an immutable numbered itinerary version
through signed, trip-owned RPCs. Previous versions remain available.

Set `LLM_PROVIDER=gemini`, `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.8-flash` only
in FastAPI's private environment. Apply `20261029000600_itinerary_versions.sql`
(included by `npm run db:prepare`). Planning supports 1–14 inclusive days, requires
discovered attractions, and never guesses venues, prices or travel times. See
[AI itinerary documentation](docs/features/ai-itinerary.md) for setup, validation, bounded repair behavior,
development fixtures and manual verification.

## Smart budget engine

Open a saved trip and choose **Budget**. Step 10 uses the trip's saved total budget,
currency, dates, traveler count and budget style to build a deterministic category
allocation across accommodation, food, activities, transport and miscellaneous
spending. Money calculations use application logic rather than the LLM, and monetary
values are handled with decimal-safe arithmetic.

- Budget styles map to centralized allocation percentages that always total 100%.
- Known selected-hotel prices can contribute to accommodation spend when a genuine
  provider amount exists. Food and attraction costs remain unknown unless a trusted
  provider or the user supplies an amount; NomivraAI does not fabricate prices.
- Users can add planned or actual expenses, categorized as accommodation, food,
  activities, transport or miscellaneous. Planned and actual spending remain distinct.
- The summary exposes total budget, category allocations, known/planned/actual costs,
  remaining budget, per-person budget, flexible daily budget and deterministic budget
  health such as **Healthy**, **Watch**, or **Over budget**.
- Automatic provider-backed costs and manual entries are kept separate so the same
  expense is not silently counted twice.
- Budget data is trip-owned and protected by the same authenticated BFF, Supabase RLS,
  validation and persistence boundaries used elsewhere in the application.
- The itinerary engine may consume validated budget context, but Gemini is never used
  for arithmetic, currency conversion or fabricated expense estimates.

Apply `supabase/migrations/20261029000700_trip_budget_entries.sql` before using
Budget, or apply the private output of `npm run db:prepare`. Manual accommodation
entries replace the entire automatic hotel quote; mark existing plans actual
when paid to avoid duplicate costs. No new environment variables are needed.
See [budget setup and behavior](docs/features/budget-engine.md) and the
[Step 10 report](docs/history/step-10.md). Run `npm run test:budget` for focused checks.

## Weather intelligence

Open a trip's **Weather** tab and choose **Load forecast** for real daily and
morning/afternoon/evening forecasts. Trips outside the supported forecast window
show explicit gaps. Weather stays optional; tab navigation reads cached data.
On the itinerary, **Adapt itinerary** uses verified weather and deterministic
conflicts to propose the smallest validated change as a new version. Previous
versions and manual budget entries stay intact. Gemini never supplies weather facts.

Apply `20261030000800_weather_adaptation.sql` before adaptation. See
[weather setup, rules and manual verification](docs/features/weather-intelligence.md)
and the [Step 11 implementation record](docs/history/step-11.md).
Run `npm run test:weather` for focused checks.

