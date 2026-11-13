# CEA Power Intelligence: platform notes

Status date: 13 November 2026.

## 1. What was verified, and how

This version was built in an environment that could not reach any market-data provider and had no ENTSO-E token. That shapes what "verified" means below:

- **Verified in the running application**: with generated development data (`CEA_SYNTHETIC_DATA=1`) and with no credentials (truthful "not connected" states), in a browser, on desktop, tablet and phone widths, in both themes.
- **Verified by unit tests**: every calculation in `src/lib/see/` (analytics, region model, alerts, BESS optimiser, PPA engine) and the ENTSO-E XML parser.
- **Not verified against live data**: every provider call. The existing ENTSO-E fetchers were already in production use; the four new ones (A09, A61, A65 forecast, A69) follow the same request and parse path but have never run against the live API. The first deployment with a token should start at Data & Methodology and the status badges.

## 2. Information architecture

One shell, eight primary workspaces, no page reloads between them.

- **Rail**: workspaces. **Price tape**: latest complete delivery day per market and change on the previous day; click to select a market everywhere. **Context bar**: delivery period (state in the URL), search, theme, language. **Status bar**: data provenance and market clock.
- **Selection lives in the URL**: `m` (market), `b` (border), `ref` (reference market), `preset`/`from`/`to` (period). Every view is a shareable link.
- **Command palette** (`Ctrl/⌘ K` or `/`): workspaces, markets, borders, periods, theme, language.

## 3. Design system

Tokens are in `src/styles.css`; primitives in `src/components/cea/`.

- **Themes**: "Night grid" (default) and "Paper" (the warm cream of cea.org.rs). Each is selected, not an inversion of the other. Toggle is persisted per device.
- **Brand**: CEA olive is the interaction colour and is never used to encode data.
- **Type**: Fira Sans (UI), Fira Sans Condensed (labels, table heads), Fira Mono (all numbers, tabular).
- **Data colour roles**: `--series-1..8` categorical in a fixed order (validated for colour-vision deficiency on both surfaces); `--price-low/mid/high` diverging for cheaper and dearer than a reference; `--seq-1..4` sequential for magnitude; `--status-*` for state, always with a label; `--flow` for direction on the map.
- **Rules**: one y-axis per chart; at most eight coloured series; a market keeps its colour while selected; a missing value is a dash or a hatched cell; every panel states its provenance.
- **Components**: `Panel`, `Stat`, `Delta`, `ProvenanceBadge`, `Segmented`, `DataState`, `DataTable`, `NumField`; charts `TimeChart`, `XYChart`, `CategoryBars`, `HeatGrid`, `ScatterPlot`, `Spark`, `RankBars`; map `SeeMap`.

## 4. Data

### Registry

`src/lib/see/registry.ts` is the single source for markets and borders: code, TSO, day-ahead operator, coupling status, price key, ENTSO-E zone, and for each border the link type (AC or HVDC) and allocation mode (implicit in market coupling, or explicit auctions). To add a market or border, add it there, add its EIC to `src/lib/markets.ts` (and `price-markets.ts` if it has a day-ahead price), add a map anchor in `scripts/build-see-map.mjs` and rerun the script.

Registry facts were written from domain knowledge and reviewed in November 2026. They are configuration: `validatePriceMarkets` and the status badges show at runtime whether each zone actually returns data.

### Source matrix

| Source                                                           | Used for                           | In the application                           | Access                                                                                  | Verified live in this change |
| ---------------------------------------------------------------- | ---------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| ENTSO-E A44                                                      | Day-ahead prices                   | Yes (existing)                               | Free token                                                                              | No                           |
| ENTSO-E A11                                                      | Physical cross-border flows        | Yes (existing, now for 34 borders)           | Free token                                                                              | No                           |
| ENTSO-E A25                                                      | Explicit capacity auctions         | Yes (existing, now for all explicit borders) | Free token                                                                              | No                           |
| ENTSO-E A65 / A75                                                | Actual load and generation by type | Yes (existing, now for 12 markets)           | Free token                                                                              | No                           |
| ENTSO-E A77 / A80                                                | Outages                            | Yes (existing, Serbia)                       | Free token                                                                              | No                           |
| ENTSO-E A09                                                      | Scheduled commercial exchanges     | Yes (new adapter)                            | Free token                                                                              | No                           |
| ENTSO-E A61                                                      | Day-ahead forecast NTC             | Yes (new adapter)                            | Free token                                                                              | No                           |
| ENTSO-E A65 process A01                                          | Day-ahead load forecast            | Yes (new adapter)                            | Free token                                                                              | No                           |
| ENTSO-E A69                                                      | Day-ahead wind and solar forecast  | Yes (new adapter)                            | Free token                                                                              | No                           |
| Open-Meteo, PVGIS, RHMZ                                          | Weather, PV yield, Danube levels   | Yes (existing)                               | Public                                                                                  | No                           |
| EEX                                                              | Futures                            | Public snapshot and manual import (existing) | Licensed feed needs credentials                                                         | No                           |
| JAO, SEE CAO                                                     | Capacity auctions                  | Only what ENTSO-E republishes                | Direct APIs need accounts                                                               | Not integrated               |
| SEEPEX, HUPX, CROPEX, BSP, IBEX, OPCOM, HEnEx, MEMO, ALPEX, MEPX | Exchange publications              | Not integrated directly                      | Site terms restrict scraping and redistribution; ENTSO-E carries their day-ahead prices | Not integrated               |
| Intraday prices and indices                                      | —                                  | Not integrated                               | No verified free feed for SEE                                                           | —                            |
| FCR, aFRR, mFRR prices                                           | —                                  | Not integrated                               | No verified free feed for SEE                                                           | —                            |
| OTC forward indications                                          | —                                  | Not integrated                               | Licensed                                                                                | —                            |

### Normalisation

- All series are reduced to hourly, keyed by UTC hour. A 15- or 30-minute series becomes an hourly mean only for hours it covers completely; misaligned intervals are dropped.
- Delivery days, peak hours and hour-of-day use market time (CET/CEST) and handle 23- and 25-hour days.
- ENTSO-E curve type A03 lists a position only when the value changes; such series are expanded with the preceding value. Other curve types are never filled.
- Each server call handles at most six markets or borders; the client fans out in batches of five. This keeps a call inside serverless subrequest limits.

## 5. Completion matrix

| Area                                                                                 | State                                           | Notes                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Shell, navigation, period control, command palette, themes, EN/SR                    | Implemented and verified in the running app     |                                                                                   |
| Design system and chart primitives                                                   | Implemented and verified in the running app     |                                                                                   |
| Command Center map: prices, physical flows, spreads                                  | Implemented; verified with synthetic data       | Awaiting ENTSO-E token for live data                                              |
| Map layers: schedules, utilisation, capacity price, generation                       | Implemented; verified with synthetic data       | New adapters untested live; utilisation needs published NTC                       |
| Market and border inspectors, computed signals, hourly grid                          | Implemented and verified with synthetic data    | Signal rules are unit-tested                                                      |
| Price Analytics                                                                      | Implemented and verified with synthetic data    | Day-ahead only                                                                    |
| Cross-Border scanner and border detail                                               | Implemented and verified with synthetic data    | Capacity price is the last day of the period                                      |
| Fundamentals                                                                         | Implemented and verified with synthetic data    | Hydro reservoir levels and installed capacity not included                        |
| BESS Lab                                                                             | Implemented and verified; optimiser unit-tested | Day-ahead arbitrage only; ancillary income is a user input                        |
| PPA Studio                                                                           | Implemented and verified; engine unit-tested    | Fleet profile limited to 62 days; CSV for longer                                  |
| Watchlist, saved views, scenarios, JSON export/import                                | Implemented and verified                        | Stored on the device; there are no user accounts                                  |
| Alerts                                                                               | Partially implemented                           | Checked in the browser while the app is open; no background or push notifications |
| Forwards & Forecast                                                                  | Unchanged from the previous version             | Restyled by tokens only; no cross-market forward spreads or liquidity             |
| RES capture, project economics, Serbia border detail, balance, outages, report, news | Unchanged, restyled by tokens only              | Still Serbia-centric                                                              |
| Intraday, balancing and ancillary markets                                            | Not implemented                                 | No verified data source                                                           |
| Opportunity scanner with statistical significance                                    | Partially implemented                           | The scanner ranks by observed spread; no significance testing                     |
| Dockable or resizable panels                                                         | Not implemented                                 | Fixed responsive layouts                                                          |
| Server-side accounts and persistence                                                 | Not implemented                                 | Would be needed for cross-device workspaces and real alerts                       |
| End-to-end browser tests in CI                                                       | Not implemented                                 | Browser checks were run by hand for this change                                   |

## 6. Known limits to address next

1. Run with a real token and reconcile the registry (zones that return nothing, borders with no flow series, EICs for the Italian zones and Kosovo\*).
2. Move regional reads to the persisted ingestion design in the draft pull request on background ingestion, so page loads do not depend on ENTSO-E availability.
3. Rebuild Forwards, Capture and Project Economics on the new design system.
4. Accounts and server-side alert evaluation, if alerts must work with the application closed.
