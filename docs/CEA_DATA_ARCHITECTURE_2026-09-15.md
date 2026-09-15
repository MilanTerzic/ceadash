# CEA Dash data architecture

Date: 15 September 2026

## Goal

CEA Dash is a public analytical product. Interactive page requests should be fast, reproducible and independent of temporary upstream-provider availability.

The target contract mirrors the current Power Pulse architecture:

1. background jobs contact upstream providers;
2. observations are validated and persisted;
3. public pages read persisted data only;
4. missing values remain missing rather than becoming zero/demo values;
5. failed refreshes retain the last good persisted observations;
6. freshness and pipeline health are visible separately from the observations themselves.

## Canonical stores

### Day-ahead prices

`market_price_intervals` is authoritative for day-ahead market history and preserves original MTU (`15`, `30` or `60` minutes). `market_prices_hourly` remains a compatibility store only for genuinely hourly series.

### Physical flows

`cross_border_flows_hourly` remains the canonical physical-flow store. The architecture migration adds `duration_minutes` and `fetched_at` so interval resolution and freshness are explicit. The legacy table name is retained for compatibility even when a provider publishes sub-hourly intervals.

### Explicit capacity

`capacity_observations` stores persisted daily explicit-allocation/capacity observations used by the public flow/capacity analytics.

### Pipeline health

`data_ingestion_status` contains public-safe health metadata only: dataset, status, last attempt/success, row count, source label and non-sensitive error metadata.

### Compatibility caches

`api_cache` remains a compatibility/derived cache for fundamentals that have not yet moved to dedicated canonical tables. It is not the target long-term store for interval history.

## Refresh ownership

`POST /api/warm-market-data` is protected by `AUTOMATION_TOKEN` and is the only new upstream-refresh surface introduced by this migration.

Pipelines:

- `prices`: ENTSO-E A44 -> `market_price_intervals` (+ legacy hourly store where safe)
- `flows`: ENTSO-E A11 -> `cross_border_flows_hourly`
- `capacity`: ENTSO-E A25 -> `capacity_observations`
- `fundamentals`: compatibility warm cache for load/generation, outages and weather

Modes:

- `tail`: current delivery day; prices also request D+1 independently
- `history`: repair the last seven completed delivery days

D+1 is isolated from the current delivery day. An unpublished future market must never invalidate already-persisted current-day data.

## Schedule

- DA prices and physical flows: every 15 minutes
- capacity and fundamentals: hourly
- history reconciliation: daily for the last seven completed delivery days

GitHub Actions is the scheduler. The same random `AUTOMATION_TOKEN` must be configured in the deployment environment and in GitHub Actions repository secrets.

## Public read paths migrated in this change

The following high-traffic public modules are persisted-read-only:

- Overview / Serbia market price KPIs
- Prices & Spreads / regional DA profiles
- Cross-Border & Flows / Serbia border analytics and displayed daily capacity

Their page requests do not contact ENTSO-E.

## Compatibility read paths still to migrate

The existing System Fundamentals module (load/generation, outages, weather) still reads through provider adapters, but scheduled warming keeps its exact current-day cache hot. A follow-up migration should persist load/generation and outage observations in dedicated canonical tables and remove the remaining live fallback.

Forecast code also still calls provider adapters for some training/fundamental inputs. Forecast training should ultimately read canonical history only and run as its own background pipeline.

## Failure semantics

- one failed market or border does not blank other markets/borders;
- an upstream failure does not delete persisted observations;
- missing data are returned as missing/partial/unavailable, never as plausible zeros;
- user page requests do not repair missing price/flow data by calling the provider;
- freshness is metadata and must not be inferred from whether a chart has values.

## Deployment checklist

1. Apply `20260915143000_add_market_ingestion_architecture.sql`.
2. Add `AUTOMATION_TOKEN` to the Lovable/server environment.
3. Add the same `AUTOMATION_TOKEN` as a GitHub Actions repository secret.
4. Deploy the application so `/api/warm-market-data` is available.
5. Run the four pipelines manually once in `history` mode to seed/repair the previous seven days.
6. Run `prices` and `flows` in `tail` mode to seed today/D+1.
7. Check `data_ingestion_status` for successful timestamps and non-zero rows where data are expected.
8. Verify Overview, Prices and Flows still render while upstream provider access is temporarily unavailable.
