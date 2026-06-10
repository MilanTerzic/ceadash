import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, DemoBadge } from "@/components/dashboard/atoms";
import { Badge } from "@/components/ui/badge";
import {
  fetchRegionalSnapshot,
  ZONES,
  RS_NEIGHBOURS,
  type ZoneCode,
  type RegionalSnapshot,
} from "@/lib/regional.functions";

export const Route = createFileRoute("/dashboard/regional")({
  head: () => ({
    meta: [
      { title: "Regional Prices & Flows — CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Day-ahead electricity prices and cross-border power flows for Serbia and surrounding markets, sourced from ENTSO-E.",
      },
    ],
  }),
  component: RegionalPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function priceColor(p: number | null) {
  if (p == null) return "var(--muted-foreground)";
  if (p < 0) return "oklch(0.55 0.16 240)"; // blue
  if (p < 40) return "oklch(0.55 0.13 150)"; // green
  if (p < 80) return "oklch(0.65 0.13 90)"; // amber
  if (p < 140) return "oklch(0.6 0.16 50)"; // orange
  return "oklch(0.55 0.18 28)"; // red
}

function project(lat: number, lng: number, w: number, h: number) {
  // Bounding box around the Western Balkans + neighbours
  const minLng = 7.5, maxLng = 27.5;
  const minLat = 38.0, maxLat = 49.0;
  const x = ((lng - minLng) / (maxLng - minLng)) * w;
  const y = (1 - (lat - minLat) / (maxLat - minLat)) * h;
  return { x, y };
}

// ─────────────────────────────────────────────────────────────────────────────
// Map

function RegionMap({ data }: { data: RegionalSnapshot }) {
  const W = 760, H = 460;
  const priceByZone = new Map(data.prices.map((p) => [p.zone, p.avg24h]));
  const rs = project(ZONES.RS.lat, ZONES.RS.lng, W, H);
  const maxFlow = Math.max(1, ...data.flows.map((f) => f.absMw));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto rounded-xl border border-border/60 bg-surface"
        role="img"
        aria-label="Regional day-ahead prices and Serbian cross-border flows"
      >
        {/* Flow lines from Serbia to neighbours */}
        {data.flows.map((f) => {
          const a = project(ZONES.RS.lat, ZONES.RS.lng, W, H);
          const b = project(ZONES[f.to].lat, ZONES[f.to].lng, W, H);
          const width = 1 + (f.absMw / maxFlow) * 8;
          const exports = f.netMw >= 0;
          // Direction: arrowhead at the importing end
          const x1 = exports ? a.x : b.x;
          const y1 = exports ? a.y : b.y;
          const x2 = exports ? b.x : a.x;
          const y2 = exports ? b.y : a.y;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const stroke = exports
            ? "oklch(0.55 0.13 150)" // green = Serbia exports
            : "oklch(0.6 0.16 50)"; // orange = Serbia imports
          return (
            <g key={`${f.from}-${f.to}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeWidth={width}
                strokeOpacity={0.55}
                strokeLinecap="round"
                markerEnd="url(#arrow)"
              />
              {f.absMw >= 50 && (
                <text
                  x={mx}
                  y={my - 4}
                  fontSize={10}
                  textAnchor="middle"
                  fill="var(--foreground)"
                  style={{ fontWeight: 600 }}
                >
                  {f.absMw} MW
                </text>
              )}
            </g>
          );
        })}

        {/* Country markers */}
        {(Object.keys(ZONES) as ZoneCode[]).map((z) => {
          const { lat, lng, name } = ZONES[z];
          const { x, y } = project(lat, lng, W, H);
          const price = priceByZone.get(z) ?? null;
          const fill = priceColor(price);
          const isRs = z === "RS";
          return (
            <g key={z}>
              <circle
                cx={x}
                cy={y}
                r={isRs ? 14 : 11}
                fill={fill}
                stroke={isRs ? "var(--foreground)" : "var(--background)"}
                strokeWidth={isRs ? 2.5 : 1.5}
              />
              <text
                x={x}
                y={y + 3}
                fontSize={9}
                textAnchor="middle"
                fill="white"
                style={{ fontWeight: 700 }}
              >
                {z}
              </text>
              <text
                x={x}
                y={y + 26}
                fontSize={10}
                textAnchor="middle"
                fill="var(--foreground)"
              >
                {name}
              </text>
              {price != null && (
                <text
                  x={x}
                  y={y + 38}
                  fontSize={10}
                  textAnchor="middle"
                  fill="var(--muted-foreground)"
                >
                  €{price.toFixed(0)}/MWh
                </text>
              )}
            </g>
          );
        })}

        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--foreground)" opacity="0.7" />
          </marker>
        </defs>

        {/* Legend */}
        <g transform={`translate(12, ${H - 70})`}>
          <rect width="180" height="60" rx="8" fill="var(--background)" stroke="var(--border)" />
          <text x="10" y="16" fontSize="10" fill="var(--foreground)" style={{ fontWeight: 600 }}>
            Price (€/MWh, 24h avg)
          </text>
          {[
            { c: "oklch(0.55 0.16 240)", l: "<0" },
            { c: "oklch(0.55 0.13 150)", l: "0–40" },
            { c: "oklch(0.65 0.13 90)", l: "40–80" },
            { c: "oklch(0.6 0.16 50)", l: "80–140" },
            { c: "oklch(0.55 0.18 28)", l: ">140" },
          ].map((s, i) => (
            <g key={s.l} transform={`translate(${10 + i * 34}, 26)`}>
              <rect width="28" height="10" rx="2" fill={s.c} />
              <text x="14" y="24" fontSize="9" textAnchor="middle" fill="var(--muted-foreground)">
                {s.l}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page

function RegionalPage() {
  const fetcher = useServerFn(fetchRegionalSnapshot);
  const { data, isLoading } = useQuery({
    queryKey: ["regional-snapshot"],
    queryFn: () => fetcher(),
    staleTime: 30 * 60 * 1000,
  });

  const hasData = Boolean(data?.ok && data.prices.length > 0);

  return (
    <div className="space-y-6">
      <ChartCard
        title="Regional Day-Ahead Prices"
        description="Wholesale day-ahead electricity prices across Serbia and surrounding markets. 24-hour average from ENTSO-E."
        right={
          hasData ? (
            <Badge variant="secondary" className="text-[10px]">
              ENTSO-E · updated {new Date(data!.generatedAt).toLocaleString()}
            </Badge>
          ) : (
            <DemoBadge />
          )
        }
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading regional snapshot…</p>
        ) : !hasData ? (
          <p className="text-sm text-muted-foreground">
            Regional data is currently unavailable from ENTSO-E. Please retry later.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border/60">
                  <th className="py-2 pr-4">Zone</th>
                  <th className="py-2 pr-4 text-right">24h avg (€/MWh)</th>
                  <th className="py-2 pr-4 text-right">Latest (€/MWh)</th>
                  <th className="py-2 pr-4">Latest hour (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {data!.prices.map((p) => (
                  <tr key={p.zone} className="border-b border-border/40">
                    <td className="py-2 pr-4 font-medium">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                        style={{ background: priceColor(p.avg24h) }}
                      />
                      {p.name}
                      {p.zone === "RS" && (
                        <Badge variant="outline" className="ml-2 text-[9px]">
                          Home
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.avg24h != null ? p.avg24h.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.latest != null ? p.latest.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {p.latestTs ? new Date(p.latestTs).toISOString().slice(0, 16).replace("T", " ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="Cross-Border Power Flows"
        description="24-hour average physical flows between Serbia and neighbouring TSOs. Green arrows: Serbia exports. Orange: Serbia imports."
        right={
          hasData ? (
            <Badge variant="secondary" className="text-[10px]">
              ENTSO-E physical flows
            </Badge>
          ) : null
        }
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading flow map…</p>
        ) : !hasData ? (
          <p className="text-sm text-muted-foreground">No flow data available.</p>
        ) : (
          <>
            <RegionMap data={data!} />
            <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              {data!.flows.map((f) => {
                const exports = f.netMw >= 0;
                return (
                  <div
                    key={`${f.from}-${f.to}`}
                    className="rounded-lg border border-border/60 px-3 py-2 text-sm bg-card"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        RS {exports ? "→" : "←"} {f.to}
                      </span>
                      <span
                        className="tabular-nums"
                        style={{
                          color: exports
                            ? "oklch(0.55 0.13 150)"
                            : "oklch(0.6 0.16 50)",
                        }}
                      >
                        {f.absMw} MW
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ZONES[f.to].name} · {exports ? "export" : "import"}
                    </div>
                  </div>
                );
              })}
              {data!.flows.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-full">
                  Flow data unavailable from ENTSO-E for the last 24h.
                </p>
              )}
            </div>
          </>
        )}
      </ChartCard>

      <p className="text-xs text-muted-foreground">
        Zones shown: {Object.values(ZONES).map((z) => z.name).join(", ")}. Flows
        cover Serbia&apos;s transmission borders ({RS_NEIGHBOURS.map((n) => ZONES[n].name).join(", ")}).
      </p>
    </div>
  );
}
