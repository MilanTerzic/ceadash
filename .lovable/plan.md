## Serbia RES Market Dashboard — Build Plan

A new, CEA-branded analytical dashboard built fresh in this project. Visual language matches cea.org.rs: warm cream background (#f7f4ea-ish), muted olive/sage primary, serif display headings (Cormorant/Playfair-style), clean sans body, generous spacing, soft cards.

### 1. Design System (src/styles.css)
- Palette tokens: `--background` cream, `--card` white, `--primary` muted olive/sage, `--accent` warm sand, charts in olive/sage/sky/amber/clay (no neon).
- Typography: serif display (Cormorant Garamond) for H1/H2/KPI numbers; Inter for body. Loaded via `<link>` in `__root.tsx`.
- Components: soft-shadow rounded-2xl cards, thin dividers, restrained motion. Tooltip + Info icon for every metric.

### 2. Routing (TanStack Start, file-based)
```
src/routes/
  __root.tsx                 — header with CEA-style nav + EN locale, intro strip
  index.tsx                  — landing redirect/intro → /dashboard
  dashboard.tsx              — layout: tabs nav + <Outlet/>
  dashboard.index.tsx        — Tab 1: Overview
  dashboard.market.tsx       — Tab 2: Market Prices
  dashboard.capture.tsx      — Tab 3: RES Capture Prices
  dashboard.calculator.tsx   — Tab 4: Solar Project Calculator
  dashboard.insights.tsx     — Tab 5: Serbia RES Insights
  dashboard.news.tsx         — Tab 6: News & Policy Monitor
  dashboard.methodology.tsx  — Tab 7: Data Sources / Methodology
```
Each leaf has its own `head()` meta (title/description/og).

### 3. Backend (Lovable Cloud)
Enable Supabase. Tables (all with GRANTs + RLS):
- `market_prices_hourly` (datetime, market, price_eur_mwh, volume_mwh, source) — public SELECT (anon+authenticated), service_role write.
- `res_generation_profiles` (datetime, technology, location, generation_mwh_per_mw, source) — public SELECT.
- `capture_price_metrics` (period, technology, baseload_price, capture_price, capture_rate, negative_price_generation_share) — public SELECT.
- `news_items` (date, source, title, original_url, summary_en, tags[]) — public SELECT, admin-only INSERT via service role.
- `calculator_scenarios` (user_id, scenario_name, location, capacity_mwp, ..., assumptions_json, results_json) — RLS: owner-only via `auth.uid()`. Sign-in optional; anonymous users get localStorage fallback.

### 4. Server functions (`src/lib/*.functions.ts`)
- `entsoe.functions.ts`: `fetchDayAheadPrices(zone='10YCS-SERBIA-T', from, to)`, `fetchActualGenerationByType`, `fetchActualLoad`. Uses `process.env.ENTSOE_SECURITY_TOKEN`. Parses ENTSO-E XML, normalizes to hourly rows, upserts into `market_prices_hourly`/`res_generation_profiles`.
- `pvgis.functions.ts`: `fetchPvHourlyProfile({lat, lon, peakpower, loss, angle, aspect, year})` → calls PVGIS `seriescalc` JSON endpoint, returns hourly MWh/MW.
- `capture.functions.ts`: computes monthly capture price/rate from joined price × profile.
- `calculator.functions.ts`: pure financial engine (LCOE, IRR via bisection, NPV, DSCR, payback, sensitivity matrix). Stateless, callable from client.
- `news.functions.ts`: admin insert/list; optional RSS fetcher for Balkan Green Energy News / SEEPEX / AERS feeds with `await import` for cheerio/xml2js if needed.
All admin writes load `supabaseAdmin` inside `.handler()` via dynamic import.

### 5. Tab content (each backed by react-query + recharts)
- **Overview**: 10 KPI cards (latest baseload/peakload, 7d/30d avg, # negative hrs MTD, share, solar/wind capture est, capture rates) + 5 charts.
- **Market Prices**: filters (range/year/month/baseload-peakload/neg-only/high-only), hourly line, daily baseload+peakload bars, monthly avg, volatility, price duration curve, hour×month heatmap, weekday vs weekend bar.
- **RES Capture**: monthly capture vs baseload bars+line, capture-rate trend, hourly avg solar/wind profile vs avg price profile, negative-price exposure, revenue loss.
- **Solar Calculator**: form (all inputs from spec, location dropdown of 8 Serbia cities + custom coords), Calculate runs server fn (PVGIS + finance), renders Annual gen/CF/LCOE/IRR/NPV/Payback/DSCR/Break-even PPA/Capture/Blended price KPIs, monthly gen+revenue bars, hourly gen-vs-price scatter, lifetime cash-flow waterfall, 2D sensitivity heatmaps (CAPEX×PPA, CAPEX×capture, discount×PPA, curtailment×capture). Save scenario to Supabase or localStorage. CSV+PDF export. Disclaimer footer.
- **Insights**: 12 insight cards with title / 2-sentence text / supporting metric (pulled from `capture_price_metrics` + computed) / signal pill (Positive/Neutral/Warning/Critical color-coded).
- **News & Policy**: list of items from `news_items`, filters (source/topic/region/category/date), "AI summary" badge, link out, admin "Add item" sheet (visible if signed-in admin role).
- **Methodology**: static prose + formula cards (KaTeX-rendered or styled `<code>` blocks).

### 6. Cross-cutting
- **Demo mode**: if a query returns zero rows, fall back to bundled `src/lib/demoData.ts` (one year of synthetic SEEPEX-shaped hourly prices with negative hours, plus PVGIS-like profiles) and render a "Demo data" badge in the card header.
- **Tooltips**: `<MetricLabel>` component wraps every KPI with shadcn Tooltip explaining the formula.
- **Exports**: chart PNG via `recharts` ref → `html-to-image`; CSV via simple `Blob`; calculator PDF via `jspdf`.
- **Responsive**: 12-col grid → 2-col on tablet → stacked on mobile. Tabs collapse to dropdown on small screens.

### 7. Secrets
- `ENTSOE_SECURITY_TOKEN` — added via secrets tool after Cloud is enabled (you indicated you have one).
- `LOVABLE_API_KEY` — auto-provisioned (used later if we add AI summarization for news).

### 8. Delivery order (one build pass)
1. Enable Cloud, create migration with 5 tables + GRANTs + RLS.
2. Design tokens + fonts + shared `DashboardShell`, `KpiCard`, `MetricLabel`, `ChartCard`, `DemoBadge`.
3. Route tree (root + dashboard layout + 7 leaves) with placeholder bodies.
4. Demo data module + recharts wrappers.
5. Implement Overview, Market Prices, RES Capture using demo data + react-query.
6. Solar Project Calculator (form + finance engine + sensitivities + save/export).
7. Insights + News (with admin add) + Methodology.
8. Server fns: PVGIS (wire into calculator immediately), ENTSO-E (wire into market/capture queries; fall back to demo if token missing/empty result).
9. Request `ENTSOE_SECURITY_TOKEN` secret.

### Notes / Out of scope for v1
- No automated RSS scraping of CEA/eKapija (ToS risk) — news supports manual admin entry + optional RSS for the two sources that publish open feeds (Balkan Green Energy News). AI summarization stub uses Lovable AI Gateway only if you confirm.
- Auth: Supabase email/password optional for saving scenarios + admin news entry; not required to browse.
- Existing power dashboard codebase: not present here, so this is a clean build — components are written to be portable back if needed.
