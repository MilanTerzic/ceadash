# CEA Power Dashboard

CEA Power Dashboard is a public Serbia and regional electricity-market analytics application.

It combines the original CEA dashboard features with market-intelligence modules ported and adapted from Power Pulse Serbia:

- Serbia and regional day-ahead prices
- futures snapshots and forward-curve analytics
- spreads, route economics, capacity, flows, utilization and balance
- outages, weather, Danube hydrology and forecast context
- CEA Market Report with CSV, print and JPEG export
- RES capture prices, flexibility/storage signals, CBAM and solar-project calculators
- bilingual English/Serbian UI through `useLang()` / `t()`

## Setup

1. Install dependencies.

   ```bash
   bun install
   ```

2. Copy `.env.example` to `.env` and configure the required server variables.

3. Apply Supabase migrations if database-backed caching, futures snapshots or report persistence are needed.

4. Run locally.

   ```bash
   bun run dev
   ```

## Verification

```bash
bun run check   # typecheck + lint + tests + build (same gate as CI)
```

Routes that are pure redirects (for example `/dashboard/cbc`) are covered by `tests/route-redirects.test.mjs`.

## Repository layout

- `src/` — TanStack Start application (routes, components, server functions)
- `supabase/` — database migrations
- `tests/` — Node test runner suites for calculations, security guards and routing
- `legacy/` — the original Python/Flask dashboard, kept for reference only and not part of the build

## Documentation

See `docs/POWER_PULSE_PARITY.md` for:

- repository audit summary
- feature-parity matrix
- source-to-target file mapping
- new routes
- Supabase migrations
- environment variables
- external-data limitations
- deployment and post-deployment checklist
