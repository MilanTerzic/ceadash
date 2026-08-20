# CEA Power Dashboard technical audit

Date: 20 August 2026
Branch: `chore/stabilize-dashboard`
Status: in progress

## Executive summary

The application has a strong functional base and a useful public information architecture, but the current audit has already identified two high-priority data-integrity risks that should be fixed before adding more features:

1. mixed 60-minute / 15-minute day-ahead market data can be collapsed incorrectly in the regional price pipeline;
2. missing cross-border observations can be converted to numeric zero in flow analytics.

Both issues can create plausible-looking but analytically incorrect outputs, so they are treated as P0.

## P0 findings

### 1. Mixed market-time-unit handling

Relevant files:

- `src/lib/entsoe.server.ts`
- `src/lib/data.functions.ts`
- `src/lib/trading-calculations.ts`

The ENTSO-E fetcher preserves interval duration, but `mergeDaPricePoints()` rounds timestamps to the start of the hour. For a 15-minute series, multiple quarter-hours therefore overwrite each other.

`getAverageDAProfile()` also persists raw live points to `market_prices_hourly`, while cached reads restore every row as `durationMinutes: 60`.

This matters because the dashboard compares Serbia with SDAC markets. Serbia/SEEPEX may remain hourly while coupled EU markets can provide 15-minute A44 prices. The canonical data layer must support mixed resolution rather than assuming one resolution for every zone.

Tracking issue: #7

### 2. Missing cross-border flow values become zero

Relevant file:

- `src/lib/data.functions.ts`

`getFlowAnalytics()` creates the union of import/export timestamps and then substitutes `0` when one direction is absent. A missing ENTSO-E observation can therefore become a measured zero and create a false net position.

The same area also reports source information from the first day of a multi-day request rather than aggregating completeness/status over all requested days.

Tracking issue: #8

## P1 findings

### 3. UTC/local-day mismatch in cache freshness logic

Relevant file:

- `src/lib/entsoe.server.ts`

Several cache decisions compare delivery dates with `new Date().toISOString().slice(0, 10)`, i.e. the UTC calendar day, while the dashboard is explicitly defined in `Europe/Belgrade` time. Around local midnight this can classify the current Belgrade delivery day as historical or future incorrectly and apply the wrong TTL/backfill behaviour.

Recommended fix: introduce one canonical `belgradeTodayISO()` utility and use it for all delivery-day classification.

### 4. Data-layer monolith

`src/lib/data.functions.ts` is over 50 KB and mixes prices, cache persistence, flows, WB6 balance, weather, hydrology, capacity and forecast server functions.

Recommended target structure:

- `src/lib/data/prices.server.ts`
- `src/lib/data/flows.server.ts`
- `src/lib/data/capacity.server.ts`
- `src/lib/data/fundamentals.server.ts`
- `src/lib/data/balance.server.ts`
- `src/lib/data/status.ts`

The public route API can remain stable while implementation is split underneath it.

### 5. Documentation contradictions

`README.md` says the dashboard contains CBC resale analysis, while the parity document says CBC resale was intentionally removed and `/dashboard/cbc` currently redirects to `/dashboard/market-report`.

The parity document also contains stale statements about outage parsing that no longer match the current ENTSO-E implementation.

The public methodology page says demo data are used wherever live data are not connected. That should be checked carefully against the product rule that unavailable market data must not be silently fabricated.

Recommended fix: make one explicit public data policy:

- observed/live
- cached observed
- estimated/modelled
- demo/synthetic
- unavailable

Every card should expose one of these states consistently.

## Stabilisation changes already made on this branch

- stop tracking `.env` and ignore environment files while retaining `.env.example`;
- add `typecheck` and aggregate quality scripts;
- add GitHub Actions quality workflow for typecheck, lint, tests and build;
- keep the work isolated from `main` in draft PR #6.

## Next audit sequence

1. verify and repair 15-minute/60-minute market handling;
2. repair missing-flow semantics and range-level completeness;
3. standardise `Europe/Belgrade` date handling;
4. inspect price/spread calculations and CBC/capacity semantics;
5. inspect futures and forecast fallbacks for fabricated or stale values;
6. inspect capture/BESS/project-economics calculations;
7. inspect all canonical routes and redirects;
8. add route smoke/e2e coverage;
9. refactor data layer after calculation behaviour is locked by tests;
10. only then add new intelligence features.

## Product principle for the remaining work

A missing value must never become a plausible numeric value simply because the UI expects a number. Prefer `null`, `N/A`, `partial`, `delayed` or `unavailable` with visible source/coverage metadata.
