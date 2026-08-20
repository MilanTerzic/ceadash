# CEA Power Dashboard technical audit

Date: 20 August 2026
Branch: `chore/stabilize-dashboard`
Status: in progress

## Executive summary

The application has a strong functional base and a useful public information architecture, but the audit has identified several release-blocking data-integrity and security risks that should be fixed before adding more features:

1. mixed 60-minute / 15-minute day-ahead market data can be collapsed incorrectly in the regional price pipeline;
2. missing cross-border observations can be converted to numeric zero in flow analytics;
3. privileged futures POST actions can write through the Supabase service-role client without an explicit authorization guard;
4. a legacy plaintext application password is committed in public source;
5. capture analytics can forward-fill missing ENTSO-E generation observations and therefore make partial generation data appear complete.

The first four are treated as P0. Capture-series gap handling is P1 but should be fixed before relying on capture analytics for publication-grade conclusions.

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

### 3. Privileged futures write actions lack an explicit authorization guard

Relevant files:

- `src/lib/eex-futures.server.ts`
- `src/integrations/supabase/client.server.ts`

The server-side Supabase client uses `SUPABASE_SERVICE_ROLE_KEY` and explicitly bypasses RLS. The public dashboard exposes POST server functions that can write through this client:

- `collectFuturesSnapshots`
- `refreshPublicFuturesSnapshots`
- `importManualFuturesData`

No explicit authorization check is present in those handlers. UI visibility is not a security boundary for a public application.

Required fix: add server-side admin authorization, rate limiting and import-size limits before these functions are considered production-safe.

Tracking issue: #9

### 4. Hardcoded plaintext legacy password in public source

Relevant file:

- `src/lib/auth.ts`

The repository contains a plaintext application password and a client-only localStorage session flag. `hasAppSession()` also returns `true` during SSR. This must not be used to protect privileged operations.

If the module is no longer referenced, remove it. If privileged admin controls are required, replace it with server-validated authentication and authorization.

Tracking issue: #11

## P1 findings

### 5. UTC/local-day mismatch in cache freshness logic

Relevant file:

- `src/lib/entsoe.server.ts`

Several cache decisions compare delivery dates with `new Date().toISOString().slice(0, 10)`, i.e. the UTC calendar day, while the dashboard is explicitly defined in `Europe/Belgrade` time. Around local midnight this can classify the current Belgrade delivery day as historical or future incorrectly and apply the wrong TTL/backfill behaviour.

Recommended fix: introduce one canonical `belgradeTodayISO()` utility and use it for all delivery-day classification.

### 6. Capture generation parser can fabricate observations by forward-fill

Relevant file:

- `src/lib/capture.functions.ts`

`parseTimeSeriesHourly()` walks expected ENTSO-E positions and carries the previous value forward whenever a position is missing. This converts an absent observation into a plausible numeric generation value.

The parser also deduplicates identical timestamps with `Map.set`, so multiple TimeSeries values at the same timestamp are not explicitly aggregated or surfaced as separate series.

The final capture mapping also converts missing wind observations to `0`, which makes missing generation indistinguishable from observed zero generation.

Required fix: preserve gaps, calculate generation completeness separately, only compute capture metrics on matched price-generation intervals, and explicitly define aggregation rules for multiple A75 series.

Tracking issue: #10

### 7. Data-layer monolith

`src/lib/data.functions.ts` is over 50 KB and mixes prices, cache persistence, flows, WB6 balance, weather, hydrology, capacity and forecast server functions.

Recommended target structure:

- `src/lib/data/prices.server.ts`
- `src/lib/data/flows.server.ts`
- `src/lib/data/capacity.server.ts`
- `src/lib/data/fundamentals.server.ts`
- `src/lib/data/balance.server.ts`
- `src/lib/data/status.ts`

The public route API can remain stable while implementation is split underneath it.

### 8. Futures data source is safe about unavailable values, but refresh/import controls need separation from public viewing

Relevant files:

- `src/lib/eex-futures.server.ts`
- `src/routes/dashboard.futures.tsx`

The futures implementation correctly avoids fabricating licensed EEX DataSource values when the endpoint mapping or credentials are unavailable. It falls back to stored/public snapshots and can display `configuration-required`/unavailable states.

However, operational controls such as refresh and manual import should be treated as admin functionality and separated from the public read-only dashboard.

### 9. Documentation contradictions

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

## Positive findings

The audit also found several good implementation choices worth preserving:

- ENTSO-E requests have timeouts, bounded retries and stale-cache fallback;
- outage retrieval tracks source diagnostics and partial/error status rather than blindly returning empty arrays;
- price calculations already include DST tests for 23-hour and 25-hour Belgrade delivery days;
- futures values use nullable fields and explicit unavailable/configuration-required states instead of invented values;
- the canonical navigation is substantially cleaner than the legacy route set.

## Stabilisation changes already made on this branch

- stop tracking `.env` and ignore environment files while retaining `.env.example`;
- add `typecheck` and aggregate quality scripts;
- add GitHub Actions quality workflow for typecheck, lint, tests and build;
- add security audit notes;
- keep the work isolated from `main` in draft PR #6.

## Next audit sequence

1. remove/replace insecure legacy auth and protect privileged POST functions;
2. verify and repair 15-minute/60-minute market handling;
3. repair missing-flow semantics and range-level completeness;
4. repair capture-series missing-data semantics;
5. standardise `Europe/Belgrade` date handling;
6. inspect CBC/capacity semantics and route-economics calculations;
7. inspect BESS/project-economics calculations;
8. inspect all canonical routes and redirects;
9. add route smoke/e2e coverage;
10. refactor data layer after calculation behaviour is locked by tests;
11. only then add new intelligence features.

## Product principle for the remaining work

A missing value must never become a plausible numeric value simply because the UI expects a number. Prefer `null`, `N/A`, `partial`, `delayed` or `unavailable` with visible source/coverage metadata.
