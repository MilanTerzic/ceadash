# Power Pulse Serbia Parity Migration

## Audit Summary

Power Pulse Serbia is a TanStack Start market-intelligence app with authenticated routes under `/_authenticated/*`, a shared date-range context, ENTSO-E provider adapters, Open-Meteo/Visual Crossing weather and hydrology adapters, EEX/public futures parsers, route-economics utilities, and calculation tests.

CEA Dash is also a TanStack Start app, but already contains CEA-specific public pages, bilingual labels through `useLang()` / `t()`, SEO metadata, Serbia RES capture analytics, regional analysis, weekly brief, news/policy, CBAM, solar project economics, and a CEA-branded report export workflow.

The migration preserves CEA public access and branding while porting useful Power Pulse market modules into a simplified `/dashboard/*` information architecture.

## Feature-Parity Matrix

| Power Pulse feature    | Power Pulse files                                                                            | CEA equivalent            | Missing / adapted                                                         | CEA files                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Overview               | `src/routes/_authenticated/dashboard.tsx`, `src/lib/trading-calculations.ts`                 | CEA overview              | `/dashboard/power-overview` now redirects to the canonical overview       | `src/routes/dashboard.index.tsx`, `src/routes/dashboard.power-overview.tsx` |
| Trader Report          | `src/routes/_authenticated/report.tsx`, `src/lib/report.functions.ts`                        | CEA Market Report         | CEA report kept because it already has CEA branding/JPEG/print/CSV        | `src/routes/dashboard.market-report.tsx`                                    |
| Prices                 | `src/routes/_authenticated/prices.tsx`, `src/lib/price-analysis.ts`                          | Prices & Spreads          | Regional and spreads routes redirect into the canonical prices page       | `src/routes/dashboard.prices.tsx`                                           |
| Futures                | `src/routes/_authenticated/futures.tsx`, `src/lib/futures*`, `src/lib/eex-futures.server.ts` | Futures & Forecast        | Forecast route redirects into the futures/outlook destination             | `src/routes/dashboard.futures.tsx`, `src/lib/futures*.ts`                   |
| Spreads                | `src/routes/_authenticated/spreads.tsx`, `src/lib/trading-calculations.ts`                   | Prices & Spreads          | Consolidated into `/dashboard/prices?view=spreads`                        | `src/routes/dashboard.prices.tsx`, `src/routes/dashboard.spreads.tsx`       |
| Route Map              | `src/routes/_authenticated/map.tsx`, `src/lib/markets.ts`                                    | Cross-Border & Flows      | Consolidated into `/dashboard/flows`                                      | `src/routes/dashboard.flows.tsx`, `src/routes/dashboard.map.tsx`            |
| Capacity               | `src/routes/_authenticated/capacity.tsx`, `src/lib/data.functions.ts`                        | Cross-Border & Flows      | Consolidated into `/dashboard/flows?view=capacity`                        | `src/routes/dashboard.flows.tsx`, `src/routes/dashboard.capacity.tsx`       |
| Flows                  | `src/routes/_authenticated/flows.tsx`                                                        | Cross-Border & Flows      | Canonical route                                                           | `src/routes/dashboard.flows.tsx`                                            |
| Utilization            | `src/routes/_authenticated/utilization.tsx`                                                  | Cross-Border & Flows      | Consolidated into `/dashboard/flows?view=utilization`                     | `src/routes/dashboard.flows.tsx`, `src/routes/dashboard.utilization.tsx`    |
| Balance                | `src/routes/_authenticated/balance.tsx`                                                      | Regional & Serbia Balance | Includes Serbia position and WB6 comparison                               | `src/routes/dashboard.balance.tsx`                                          |
| Outages                | `src/routes/_authenticated/outages.tsx`                                                      | System Fundamentals       | Canonical route for outage/fundamental context                            | `src/routes/dashboard.outages.tsx`                                          |
| Weather                | `src/routes/_authenticated/weather.tsx`, `src/lib/openmeteo.server.ts`                       | System Fundamentals       | Redirects to `/dashboard/outages?view=weather`                            | `src/routes/dashboard.weather.tsx`                                          |
| Danube                 | `src/routes/_authenticated/danube.tsx`, `src/lib/openmeteo.server.ts`                        | System Fundamentals       | Redirects to `/dashboard/outages?view=hydrology`                          | `src/routes/dashboard.danube.tsx`                                           |
| Forecast               | `src/routes/_authenticated/forecast.tsx`, `src/lib/forecast*.ts`                             | Futures & Forecast        | Redirects to `/dashboard/futures?view=forecast`                           | `src/routes/dashboard.forecast.tsx`                                         |
| Settings / data status | `src/routes/_authenticated/settings.tsx`                                                     | Methodology & Data Status | Private settings route redirects into methodology/data-status destination | `src/routes/dashboard.methodology.tsx`, `src/routes/dashboard.settings.tsx` |

## Canonical Routes

- `/dashboard`
- `/dashboard/prices`
- `/dashboard/futures`
- `/dashboard/flows`
- `/dashboard/balance`
- `/dashboard/outages`
- `/dashboard/market-report`
- `/dashboard/insights`
- `/dashboard/capture`
- `/dashboard/calculator`
- `/dashboard/methodology`

## Legacy Redirects

- `/dashboard/power-overview` redirects to `/dashboard`
- `/dashboard/regional` redirects to `/dashboard/prices`
- `/dashboard/spreads` redirects to `/dashboard/prices?view=spreads`
- `/dashboard/map` redirects to `/dashboard/flows?view=map`
- `/dashboard/capacity` redirects to `/dashboard/flows?view=capacity`
- `/dashboard/utilization` redirects to `/dashboard/flows?view=utilization`
- `/dashboard/wb6` redirects to `/dashboard/balance?view=wb6`
- `/dashboard/market` redirects to `/dashboard/balance?view=serbia`
- `/dashboard/forecast` redirects to `/dashboard/futures?view=forecast`
- `/dashboard/weather` redirects to `/dashboard/outages?view=weather`
- `/dashboard/danube` redirects to `/dashboard/outages?view=hydrology`
- `/dashboard/weekly` redirects to `/dashboard/market-report?view=weekly`
- `/dashboard/news` redirects to `/dashboard/insights?view=news`
- `/dashboard/flexibility` redirects to `/dashboard/capture`
- `/dashboard/cbam` redirects to `/dashboard/calculator?view=cbam`
- `/dashboard/settings` redirects to `/dashboard/methodology?view=data-status`
- `/dashboard/cbc` redirects to `/dashboard/market-report`
- `/dashboard/report` redirects to `/dashboard/market-report`

## Source-To-Target Mapping

- `src/lib/data.functions.ts` -> shared public server functions for prices, capacity, flows, balance, weather, hydrology and forecast.
- `src/lib/entsoe.server.ts` -> ENTSO-E provider adapter with Supabase cache.
- `src/lib/openmeteo.server.ts` -> weather and river-data adapter.
- `src/lib/trading-calculations.ts` -> route economics, completeness, DST intervals.
- `src/lib/futures*.ts` and `src/lib/eex*.ts` -> futures parsing, snapshots and server functions.
- `src/components/panel.tsx`, `src/components/kpi.tsx`, `src/components/data-badge.tsx`, `src/components/top-bar.tsx` -> reusable market-intelligence UI adapted into CEA shell.

## Database Changes

Added migrations:

- `supabase/migrations/20260715143000_add_futures_tables.sql`
- `supabase/migrations/20260715153000_add_public_futures_snapshots.sql`

These add futures contracts, EOD prices, public/manual futures snapshots, collection runs, indexes and uniqueness constraints. Existing Power Pulse authenticated manual capacity-position tables are not required after the navigation simplification and CBC resale removal.

## Environment Variables

See `.env.example`.

Required for live ENTSO-E. The server-side fetchers accept any one of these aliases:

- `ENTSOE_SECURITY_TOKEN`
- `ENTSOE_API_TOKEN`
- `ENTSOE_API_KEY`

Required for Supabase caching/database features:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Optional:

- `VISUAL_CROSSING_API_KEY`
- `FIRECRAWL_API_KEY`
- `LOVABLE_API_KEY`
- `EEX_DATASOURCE_API_URL`
- `EEX_DATASOURCE_ACCESS_TOKEN`
- `FUTURES_PUBLIC_SNAPSHOT_MODE`

## Adapted Rather Than Copied

- Power Pulse authentication shell and login are not used.
- CEA grouped navigation replaces Power Pulse sidebar.
- CEA Market Report replaces Power Pulse Trader Report as the main report route.
- Private settings are replaced by public Data Sources and Status.
- Server cache client returns unavailable/cache states when Supabase env is missing instead of crashing public pages.
- Power Pulse branding, SEE Trading wording and Serbia Desk wording were removed from copied route metadata and visible navigation.

## Known External-Data Limitations

- No futures values are fabricated. Pages show unavailable/configuration-required states unless public snapshots or configured provider data exist.
- ENTSO-E outage parser is still a declared unavailable state in the provider adapter.
- Explicit capacity units can vary by TSO; pages retain warnings and source badges.
- Weather and hydrology depend on Open-Meteo and optional Visual Crossing fallback.
- Removed CBC resale is intentionally excluded from public navigation and content. Legacy `/dashboard/cbc` bookmarks redirect to the CEA market report.

## Deployment Steps

1. Apply Supabase migrations.
2. Configure `.env.example` variables in the deployment environment.
3. Set one ENTSO-E token variable: `ENTSOE_SECURITY_TOKEN`, `ENTSOE_API_TOKEN` or `ENTSOE_API_KEY`.
4. Deploy the TanStack/Nitro build output.
5. Verify `/dashboard/methodology` shows methodology and data-status information without exposing secrets.
6. Refresh futures snapshots through the configured public/manual workflow before relying on futures pages.

## Post-Deployment Verification

- Open every canonical `/dashboard/*` route listed above on desktop and mobile.
- Switch language between English and Serbian.
- Confirm public access without Power Pulse login.
- Confirm `/dashboard/report` and all legacy routes redirect to their canonical destinations.
- Confirm CSV exports on prices, futures, flows, reports and other retained analytical pages.
- Confirm CEA report print/JPEG/CSV exports.
- Confirm unavailable states appear for missing ENTSO-E, Supabase, futures, weather or hydrology configuration.
- Confirm no client bundle contains API keys or service-role credentials.
- Run `node --test tests/trading-calculations.test.mjs tests/futures.test.mjs`.
- Run `vite build` and `eslint .`.
