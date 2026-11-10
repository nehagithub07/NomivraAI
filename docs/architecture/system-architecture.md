# System architecture

## Repository boundaries

The existing layout is a domain-organized application with two deployable services.
Keep route contracts and migrations stable when adding features.

| Path | Responsibility |
| --- | --- |
| `src/app/` | Next.js pages, layouts and thin authenticated API routes |
| `src/components/ui/` | Shared accessible presentation primitives |
| `src/components/nomvira/` | Product UI grouped by feature |
| `src/lib/<domain>/` | Validation, typed contracts, BFF orchestration and domain rules |
| `src/lib/supabase/` | Browser/server clients and database types |
| `backend/app/api/` | Internal HTTP endpoints and authentication dependencies |
| `backend/app/schemas/` | Validated provider/service request and response contracts |
| `backend/app/services/` | Travel orchestration, deterministic calculations and caches |
| `backend/app/providers/` | External provider adapters and response parsing |
| `backend/app/core/` | Settings, errors, HTTP limits, logging and monitoring |
| `supabase/migrations/` | Ordered, reviewed schema/RLS/function changes |
| `supabase/diagnostics/` | Read-only operational SQL; never applied as migrations |
| `tests/`, `backend/tests/` | Frontend/BFF/SQL and Python regression tests |
| `.github/workflows/` | Secret-free automated CI checks; no deployment |
| `scripts/`, `backend/check_*.py` | Explicit setup, deployment validation and opt-in live probes |
| `docs/` | Architecture, setup, features, operations and verification evidence |
| `.qa/` | Ignored local diagnostics/artifacts; never production source |

Provider adapters must not write database records. UI components must not hold
provider secrets or implement independent budget/ranking rules. Prefer the existing
domain entry points over duplicate utilities. Development fixtures stay guarded
and outside production responses. CI tests use synthetic inputs and PGlite; live
provider probes are deliberately excluded from CI to protect user data and quota.

## Request flow

NomivraAI uses Next.js App Router/TypeScript as its authenticated browser backend,
Supabase Auth/PostgreSQL for user-owned trip data, and FastAPI for provider access
and deterministic travel services. Vercel hosts Next.js; Render hosts one FastAPI
worker/instance. Browser components call same-origin Next.js routes.

The BFF verifies Supabase identity, loads the owned trip and builds authoritative
context. FastAPI requires the private application key. Provider keys remain in
FastAPI. PostgreSQL RLS and existing signed application proofs protect persistence.

Existing domains include trip creation, Open-Meteo destination resolution,
OpenStreetMap attraction discovery, StayAPI hotel recommendations, Geoapify food
recommendations, immutable Gemini itineraries, Decimal budget summaries and
Open-Meteo weather/risk/adaptation. Step 12 orchestrates these domains through
explicit tools; it does not duplicate their data or policy engines.

```mermaid
sequenceDiagram
  participant U as Trip companion UI
  participant N as Authenticated Next.js BFF
  participant D as Supabase + RLS
  participant P as FastAPI companion
  participant G as Existing Gemini provider
  U->>N: Message + request UUID
  N->>D: Verify owned trip; reserve/persist message
  N->>P: Compact trusted context + 12 recent messages
  P->>G: Manual function declarations
  G-->>P: Named function request
  P-->>N: Validated scoped tool request
  N->>N: Existing service read or prepare action
  N->>P: Sanitized result
  P->>G: Function response
  G-->>P: Grounded structured response
  P-->>N: Text + factual cards
  N->>D: Signed assistant persistence
  N-->>U: Answer + optional confirmation card
  U->>N: Confirm action UUID (empty body)
  N->>D: Atomic ownership/expiry/snapshot claim
  N->>N: Revalidate; execute existing service once
  N->>D: Persist action result
  N-->>U: Confirmed outcome
```

FastAPI never receives a database client. Gemini cannot query SQL, invoke Python,
fetch arbitrary URLs or authorize a mutation. Pending operations are stored on the
server; browser-confirmed arguments cannot replace them. Itinerary edits create
new versions through the existing signed document validator and parent check.

Read the [AI companion feature](../features/ai-companion.md) for exact tools,
security boundaries, timeout/rate policies and failure semantics, and
[deployment](../deployment/deployment.md) for external setup.
