# CEA Power Intelligence

The Southeast European electricity market intelligence and analytics terminal by Centar za energetske analize (CEA).

It covers twelve core markets (RS, BA, ME, MK, AL, XK, HR, SI, BG, RO, GR, HU) and their connected neighbours, and is organised as one shell with workspaces:

| Workspace           | Route                     | Answers                                            |
| ------------------- | ------------------------- | -------------------------------------------------- |
| Command Center      | `/dashboard`              | What is happening across SEE right now?            |
| Price Analytics     | `/dashboard/prices`       | Which markets are dear or cheap, and when?         |
| Cross-Border        | `/dashboard/borders`      | Where is power moving and which borders are tight? |
| Fundamentals        | `/dashboard/fundamentals` | What is driving price?                             |
| Forwards & Forecast | `/dashboard/futures`      | How is the forward curve priced?                   |
| PPA Studio          | `/dashboard/ppa`          | What is a solar, wind or baseload PPA worth?       |
| BESS Lab            | `/dashboard/bess`         | What can a battery earn on these prices?           |
| Watchlist & Alerts  | `/dashboard/watch`        | What needs my attention?                           |

Earlier pages (RES capture, project economics, Serbia border detail, balance, outages, market report, news, methodology) remain under "More".

See [`docs/CEA_POWER_INTELLIGENCE.md`](docs/CEA_POWER_INTELLIGENCE.md) for architecture, the design system, the data-source matrix and the completion matrix.

## Setup

```bash
bun install
cp .env.example .env   # then fill in the server variables
bun run dev
```

- `ENTSOE_SECURITY_TOKEN` is required for any market data. Without it every panel says the source is not connected; nothing is estimated in its place.
- Supabase variables are optional and enable the server-side cache.
- `CEA_SYNTHETIC_DATA=1` serves generated data for UI development. Every screen then shows a "SYNTHETIC DATA" banner. Never set it in production.

## Verification

```bash
bun run check   # typecheck + lint + tests + build (same gate as CI)
```

## Repository layout

- `src/lib/see/` — regional registry, analytics, BESS and PPA engines, server functions, client hooks
- `src/components/shell/` — application shell: rail, price tape, period control, command palette, themes
- `src/components/cea/` — design-system primitives and chart components
- `src/components/see/` — map, map layers, inspectors
- `src/routes/` — one file per workspace
- `scripts/build-see-map.mjs` — regenerates the map geometry from Natural Earth
- `supabase/` — database migrations
- `tests/` — Node test runner suites
- `legacy/` — the original Python dashboard, reference only
