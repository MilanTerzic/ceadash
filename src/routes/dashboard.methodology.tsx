import { createFileRoute } from "@tanstack/react-router";
import { ChartCard } from "@/components/dashboard/atoms";

export const Route = createFileRoute("/dashboard/methodology")({
  head: () => ({
    meta: [
      { title: "Methodology — CEA Power Dashboard" },
      { name: "description", content: "Data sources, formulas and assumptions used in the CEA Power Dashboard." },
      { property: "og:title", content: "Methodology — CEA Power Dashboard" },
      { property: "og:description", content: "Data sources, formulas and assumptions used in the CEA Power Dashboard." },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/methodology" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/methodology" }],
  }),
  component: MethPage,
});

function Formula({ name, expr, note }: { name: string; expr: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{name}</div>
      <code className="mt-2 block text-sm whitespace-pre-wrap font-mono">{expr}</code>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function MethPage() {
  return (
    <div className="space-y-6">
      <ChartCard title="Data sources">
        <ul className="list-disc pl-5 text-sm space-y-1.5 text-foreground/80">
          <li><strong>SEEPEX day-ahead market</strong> — hourly clearing prices, treated as the reference market price for Serbia.</li>
          <li><strong>ENTSO-E Transparency Platform</strong> — day-ahead prices (A44), actual generation per production type (A75 + psrType B16 solar / B19 wind), actual load, cross-border flows and installed capacity.</li>
          <li><strong>PVGIS (JRC, European Commission)</strong> — hourly PV output simulation based on coordinates, tilt and azimuth, used for solar generation profiles in the calculator.</li>
          <li><strong>AERS, EMS, Ministry of Mining and Energy, Energy Community</strong> — regulatory and policy context.</li>
          <li><strong>Demo data</strong> — synthetic SEEPEX-shaped series used wherever live data is not yet connected. Clearly labelled with a "Demo data" badge.</li>
        </ul>
      </ChartCard>

      <ChartCard title="Formulas">
        <div className="grid gap-3 md:grid-cols-2">
          <Formula name="Baseload price" expr="baseload = mean(hourly_price[period])" note="Simple average of all hourly prices in the selected period." />
          <Formula name="Peakload price" expr="peakload = mean(hourly_price[weekday & hour ∈ 08–20])" />
          <Formula name="Negative price hours" expr="neg_hours = count(hourly_price < 0)" />
          <Formula name="Solar capture price" expr="capture_solar = Σ(price_h × solar_h) / Σ(solar_h)" note="Generation-weighted average price actually realised by solar." />
          <Formula name="Wind capture price" expr="capture_wind = Σ(price_h × wind_h) / Σ(wind_h)" />
          <Formula name="Capture rate" expr="capture_rate = capture_tech / baseload" note="Below 100% indicates RES cannibalisation." />
          <Formula name="Merchant revenue" expr="merchant_rev = Σ(generation_h × price_h)" />
          <Formula name="LCOE" expr="LCOE = (CAPEX + Σ OPEX_y/(1+r)^y) / Σ Gen_y/(1+r)^y" />
          <Formula name="NPV" expr="NPV = Σ CF_y / (1 + r)^y" />
          <Formula name="IRR" expr="IRR = r such that NPV(r) = 0" note="Solved by bisection over [-99%, +1000%]." />
          <Formula name="Payback" expr="first year where cumulative cashflow ≥ 0" />
          <Formula name="DSCR" expr="DSCR_y = EBITDA_y / debt_service_y" />
        </div>
      </ChartCard>

      <ChartCard title="Assumptions & limitations">
        <ul className="list-disc pl-5 text-sm space-y-1.5 text-foreground/80">
          <li>The dashboard treats <strong>negative prices</strong> as a meaningful market signal, not an error. Negative prices on SEEPEX became technically possible in May 2026.</li>
          <li>Solar generation profiles use PVGIS hourly PV output for the selected coordinates and array configuration. Wind profiles use ENTSO-E actual generation where available, otherwise a clearly-marked estimate.</li>
          <li>Capture price and capture rate calculations assume hourly profiles fully co-align with hourly market prices (no intra-hour resolution effects).</li>
          <li>The Solar Project Calculator uses simplified financial mechanics: linear degradation, single tariff escalation, no inflation adjustment for OPEX. It is intended for indicative analysis, not bankable due diligence.</li>
          <li>This tool provides indicative analysis only and should not be interpreted as financial or investment advice.</li>
        </ul>
      </ChartCard>
    </div>
  );
}
