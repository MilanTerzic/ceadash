# Route, status and methodology audit

Date: 20 August 2026
Branch: `chore/stabilize-dashboard`

## Key findings

### P0 — delivery-day completeness is too permissive

`src/lib/baseload.ts` currently marks a day complete when at least 20 distinct local Belgrade hour labels are present. A normal 24-hour day can therefore be missing up to four observations and still feed baseload, peakload and volatility. The autumn 25-hour DST day is also not represented correctly by distinct local hour labels because the repeated local hour collapses to one label.

Tracking issue: #18.

### P1 — status banner can show complete coverage despite internal gaps

`DataStatusBanner` determines partial coverage mainly from selected/available range bounds. If the first and last dates are available but one or more internal dates are missing, the banner can still render the green complete state even while `missingDays` or incomplete-day diagnostics are non-zero.

Tracking issue: #19.

### P1 — methodology is no longer a single source of truth

The public methodology page contains statements that diverge from current implementation and audit findings, including demo-data policy, baseload completeness, capture alignment, LCOS and hybrid lifetime revenue.

Tracking issue: #20.

### P2 — legacy route redirects need an explicit route map

Several old route files are intentionally thin redirects (for example `/dashboard/cbc` redirects to `/dashboard/market-report`). This is acceptable for backwards compatibility, but the canonical route map should be documented and covered by smoke tests so old links never land on an unrelated page or drop meaningful query state.

Current redirect helper preserves only `from`, `to` and `preset`, with an optional `view`. Comparison/search state is not preserved.

## UX/product recommendations

1. Make the Overview page the trusted market snapshot, but only after P0 completeness logic is fixed.
2. Standardize one status vocabulary across all modules: `live`, `cached`, `partial`, `modelled`, `demo`, `unavailable`.
3. Put a compact methodology/source tooltip on every top-level KPI and export.
4. Separate user-facing status from engineering diagnostics. The current detailed ENTSO-E diagnostics are useful, but should remain collapsed by default and never be required to understand whether a KPI is safe to use.
5. Add a route smoke-test matrix covering canonical pages and all legacy redirects, including preserved date-range query parameters.
6. Make exports carry source, coverage, selected period and calculation timestamp in metadata or companion columns.

## Next implementation order

1. Fix #18 true delivery-day completeness.
2. Fix #7 mixed 15-minute/hourly price handling.
3. Fix #8 missing flows becoming zero.
4. Fix #9 privileged futures POST authorization.
5. Fix #12 auction allocation vs available capacity semantics.
6. Fix #14 hybrid lifetime revenue streams.
7. Then address P1 status/methodology/BESS/capture/CI items.
