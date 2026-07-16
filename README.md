# CEA Power Dashboard

CEA Power Dashboard is a public Serbia and regional electricity-market analytics application.

It combines the original CEA dashboard features with market-intelligence modules ported and adapted from Power Pulse Serbia:

- Serbia and regional day-ahead prices
- futures snapshots and forward-curve analytics
- spreads, route economics, capacity, flows, utilization and balance
- outages, weather, Danube hydrology and forecast context
- CBC resale analysis
- CEA Market Report with CSV, print and JPEG export
- RES capture prices, flexibility/storage signals, CBAM and solar-project calculators
- bilingual English/Serbian UI through `useLang()` / `t()`

## Setup

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Copy `.env.example` to `.env` and configure the required server variables.

3. Apply Supabase migrations if database-backed caching, futures snapshots or report persistence are needed.

4. Run locally.

   ```bash
   pnpm dev
   ```

## Verification

```bash
pnpm run test:calculations
pnpm run lint
pnpm run build
```

In the Codex Windows runtime used for this migration, `npm` was not on PATH, so verification was run directly with bundled Node:

```powershell
node --test tests\trading-calculations.test.mjs tests\futures.test.mjs
node node_modules\eslint\bin\eslint.js .
node node_modules\vite\bin\vite.js build
```

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
