# CEA Power Dashboard product roadmap

Date: 15 September 2026

## Product role

CEA Dash should not become a public clone of a trader terminal. Its strongest position is a transparent Serbia/Western Balkans electricity-market and energy-transition observatory: understandable to policy makers, investors, journalists, researchers and market professionals, while still analytically credible for experts.

## Priority 1: strengthen modules already in the product

### Overview -> CEA Market Pulse

Keep the current headline price/negative-price KPIs, but add a compact explanatory layer:

- Serbia DA baseload vs 7d / 30d / same month last year
- HU-RS and regional price convergence/divergence
- renewable capture-rate signal
- net import/export signal
- load vs generation balance
- active generation outages
- one short "What changed and why" evidence-backed summary

The summary must cite the underlying dashboard datasets and clearly label modelled interpretation separately from observed data.

### Prices & Spreads -> Price Convergence Monitor

Add:

- daily/monthly Serbia premium-discount vs HU, RO, BG, HR and regional basket
- price-correlation matrix by rolling 30/90/365 days
- convergence score and hours with >20 / >50 EUR/MWh divergence
- negative-price coincidence across markets
- downloadable interval-level source data and coverage metadata

### Cross-Border & Flows -> Interconnection Monitor

Add:

- physical-flow heatmap by border/hour
- import dependence / export intensity by month
- flow-price-spread alignment (economic direction vs actual physical direction)
- congestion proxy and capacity utilisation
- Serbia + WB6 network view, with country/border completeness badges

Do not present approximate technical NTC as measured capacity without a visible methodology label.

### System Fundamentals -> Supply-Demand Monitor

Split the current combined page into clearer sections:

- load and generation balance
- generation mix
- outage monitor
- hydro/hydrology
- weather demand drivers

Add week-on-week and seasonal-normal comparisons. Move load/generation and outages to dedicated canonical tables before adding more derived metrics.

### Renewable Capture -> Renewable Value Monitor

This should be a flagship CEA module. Add:

- solar and wind capture prices/rates by month and rolling 12m
- cannibalisation trend vs installed RES capacity
- negative-price generation exposure
- solar production-weighted hourly price shape
- "merchant revenue index" per installed MW using transparent assumptions
- country comparison where source quality is adequate

Never forward-fill missing generation into publishable capture metrics.

### Project Calculator -> Bankability Lab

Keep the project economics, but add explicit scenario comparison:

- merchant / PPA / mixed strategy
- solar-only vs solar+BESS
- base / downside / upside price and capture-rate cases
- degradation, curtailment and imbalance assumptions
- DSCR-style debt stress view when financing assumptions are entered
- exportable assumption sheet with version/date/source

## Priority 2: high-value new modules

### 1. Western Balkans Market Integration Monitor

A CEA-specific differentiator rather than a trading feature.

Track Serbia, BiH, Montenegro, North Macedonia, Albania and Kosovo* across:

- organised DA/ID market status
- market coupling status
- cross-border flow and available data coverage
- price transparency / benchmark availability
- supplier switching / competition indicators where available
- balancing-market maturity
- interconnector and storage/flexibility developments

Show a transparent country scorecard and timeline rather than one opaque composite score.

### 2. Energy Transition Scoreboard

A public policy dashboard for Serbia and later WB6:

- installed solar/wind/hydro capacity
- annual additions
- RES share of generation
- coal/lignite share
- emissions intensity if a reliable source is available
- negative-price frequency
- grid connection queue / approved capacity where official data exist
- storage/BESS pipeline
- NECP / policy targets vs observed trajectory

Every KPI should expose source, period, update date and whether it is observed, estimated or target data.

### 3. Grid & Flexibility Monitor

Track system flexibility rather than only prices:

- ramping requirements
- residual load
- hydro contribution
- interconnector contribution
- BESS/pumped-storage pipeline
- curtailment indicators where trustworthy data exist
- hours of high solar output + low/negative prices

This connects the market dashboard directly to CEA research on flexibility and aggregators.

### 4. Policy & Regulation Tracker

Structured monitoring of AERS, EMS, Ministry, Energy Community and EU developments:

- publication date
- institution
- topic
- affected market area
- short factual summary
- CEA relevance note
- source link

AI may classify/summarise documents, but the original source should always be linked and AI-generated text labelled.

### 5. Data Explorer / Open Data

Allow users to select dataset, market, date range and granularity, preview it and download CSV. Include coverage/freshness metadata in the export. This reduces repeated custom data requests to CEA and makes published analysis reproducible.

## Priority 3: intelligence layer

### Evidence-backed CEA Brief

A daily/weekly automatically prepared draft, not an autonomous publication:

- observed market moves
- key fundamentals
- cross-border developments
- renewable-value signal
- regulatory/news developments
- links/citations to all evidence

The AI layer should read persisted datasets and approved news sources only. It should never silently invent missing market values.

### Alerts

Optional subscription-ready signals for later:

- negative price event
- Serbia/Hungary spread threshold
- unusually high import dependence
- large outage
- record renewable capture-rate deterioration/improvement
- new regulatory publication

## Suggested information architecture

1. Overview / Market Pulse
2. Markets
   - Prices & Convergence
   - Futures & Outlook
   - Cross-Border & Flows
3. System
   - Supply-Demand
   - Grid & Flexibility
4. Renewables
   - Capture & Cannibalisation
   - Project / Bankability Lab
5. Western Balkans
   - Integration Monitor
   - Energy Transition Scoreboard
6. Intelligence
   - CEA Brief
   - Policy & Regulation
7. Data
   - Data Explorer
   - Methodology & Data Health

## Recommended implementation order

1. Finish canonicalisation of fundamentals and forecast inputs.
2. Surface Data Health using `data_ingestion_status`.
3. Upgrade Overview into Market Pulse using already-available datasets.
4. Upgrade Capture into Renewable Value Monitor.
5. Build Western Balkans Market Integration Monitor.
6. Add Data Explorer/Open Data.
7. Add evidence-backed CEA Brief and alerts only after source provenance is consistent across modules.
