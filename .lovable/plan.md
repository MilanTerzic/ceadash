# Dashboard Upgrade Plan

This is a large request. I'll deliver it in **4 phases** so you can review after each. Tell me which phase to start with (or say "all" to proceed sequentially).

---

## Phase 1 — Data trust & global date range

**Goal:** fix the 78.4 vs 74.33 mismatch and make every KPI auditable.

1. **Global date range selector** (top of dashboard, persisted in URL search params so it applies across all tabs):
   - Presets: 7d, 30d, MTD, Previous month, YTD, Custom (From / To).
   - All KPIs, charts, tables read from a shared `useDateRange()` hook.
2. **Baseload calculation audit** in `market.functions.ts`:
   - Confirm Serbia SEEPEX (EIC `10YCS-SERBIATSOV`) vs SEEPEX WB.
   - Group by **Europe/Belgrade** calendar day (CET/CEST), drop incomplete days, simple average of 24 hourly prices = daily baseload; period baseload = mean of daily baseloads (matches exchange convention; this is likely the source of the 78.4 vs 74.33 gap — currently we average hours, not days).
   - De-duplicate hours and warn on gaps.
3. **Methodology tooltip** on every price KPI:
   source · exact range · method · hours included · last update.
4. **Data status banner**: last successful ENTSO-E fetch, cache fallback indicator, missing-data warning, market area, timezone.

## Phase 2 — Weekly Market Intelligence tab

New tab `/dashboard/weekly` with two buttons.

1. **Generate Weekly Market Update** (Lovable AI, `google/gemini-3-flash-preview`, via `createServerFn`):
   - Inputs: last 7 days of prices, solar capture, wind capture, WoW + YoY deltas, negative/low-price hours, volatility, evening peak, midday cannibalisation.
   - Output: structured JSON rendered as styled cards (A. price moves, B. RES capture, C. market signals, D. news).
2. **News section**: pull from existing `news_items` table, filter to last 7 days + SEE/RES keywords, de-dupe via a new `weekly_report_used_news(url, used_at)` table so the same item never repeats.
3. **Create LinkedIn Post** button: second AI call, 1,200–1,800 chars, structured opening + 3–5 insights + takeaway + hashtags, **Copy to clipboard**.
4. **Export LinkedIn Visual**: client-side render of a 1200×1200 (and 1200×627) card using `html-to-image` → PNG download. CEA-branded, 3 KPIs + sparkline + takeaway + source.

## Phase 3 — RES producer tools

1. **Price risk panel**: baseload, solar capture, capture discount %, negative hours, low-price hours, σ.
2. **Revenue simulation** (extend `/dashboard/calculator`): MW, MWh/yr, tech, merchant %, PPA price, balancing €/MWh, curtailment %. Outputs: merchant revenue, PPA revenue, sensitivity table (±10/20/30% price), negative-price drag, payback if CAPEX given.
3. **PPA vs merchant comparison**: full merchant / fixed PPA / hybrid / PPA + floor / PPA + upside share — table + bar chart on the same inputs.
4. **Battery / flexibility signal**: avg daily peak-trough spread, top-10 spread days, evening-vs-midday delta, arbitrage-friendly day count, 1-cycle/day revenue proxy.
5. **Grid & regulation watch**: filtered slice of `news_items` (grid, auctions, balancing, curtailment).

## Phase 4 — Visual refresh

CEA-aligned light theme: white surfaces, dark slate text, energy blue + green accents, subtle gradients only on hero KPIs, rounded cards, consistent icon set (lucide), tightened spacing scale, tablet-responsive grid. Tokens updated in `src/styles.css`; no hardcoded colors in components.

---

## Technical notes (for reference)

- **Date range state**: Zod `validateSearch` on `/dashboard` route with `from`, `to`, `preset`; `Route.useSearch()` in children. Avoids prop drilling and makes ranges shareable via URL.
- **AI calls**: `src/lib/weekly.functions.ts` with `createServerFn` + Lovable AI Gateway (`LOVABLE_API_KEY` already set). Structured output via `Output.object(zodSchema)`. Handle 429/402 with UI error states.
- **News de-dup**: new migration `weekly_report_used_news (url PK, title, used_at, week_iso)` with GRANTs + RLS (`authenticated` read/insert via server fn only).
- **LinkedIn visual**: `html-to-image` package (Worker-safe; runs in browser), rendered from a hidden DOM node styled with current design tokens.
- **Baseload fix**: switch from `mean(hourlyPrices)` to `mean(dailyBaseloads where hoursInDay === 24)` in the period aggregation paths in `dashboard.index.tsx`, `dashboard.market.tsx`, and any KPI sharing the same helper — extract into `src/lib/baseload.ts`.

---

**Which phase should I start with?** I recommend Phase 1 first (it unblocks every other number on the dashboard), then 2, then 3, then 4.
