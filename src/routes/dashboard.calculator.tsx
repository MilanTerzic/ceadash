import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  LineChart,
  Line,
  Legend,
  ScatterChart,
  Scatter,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartCard, KpiCard, DemoBadge } from "@/components/dashboard/atoms";
import { runCalc, type CalcInputs, type CalcResults, sensitivityMatrix } from "@/lib/finance";
import { getDemoYear } from "@/lib/demo-data";
import { fetchPvgis } from "@/lib/pvgis.functions";

export const Route = createFileRoute("/dashboard/calculator")({
  head: () => ({
    meta: [
      { title: "Solar Project Calculator — CEA Power Dashboard" },
      { name: "description", content: "Estimate merchant and PPA revenue, LCOE, IRR, NPV and capture price for solar projects in Serbia." },
      { property: "og:title", content: "Solar Project Calculator — CEA Power Dashboard" },
      { property: "og:description", content: "Estimate merchant and PPA revenue, LCOE, IRR, NPV and capture price for solar projects in Serbia." },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/calculator" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/calculator" }],
  }),
  component: CalculatorPage,
});

const LOCATIONS: Record<string, { lat: number; lon: number }> = {
  Belgrade: { lat: 44.787, lon: 20.457 },
  "Novi Sad": { lat: 45.255, lon: 19.845 },
  "Niš": { lat: 43.321, lon: 21.896 },
  Kragujevac: { lat: 44.014, lon: 20.911 },
  Subotica: { lat: 46.1, lon: 19.667 },
  Zrenjanin: { lat: 45.383, lon: 20.383 },
  Bor: { lat: 44.075, lon: 22.095 },
  Kraljevo: { lat: 43.725, lon: 20.689 },
};

function CalculatorPage() {
  const [name, setName] = useState("Solar Serbia 10 MW");
  const [location, setLocation] = useState<string>("Belgrade");
  const [customLat, setCustomLat] = useState<string>("");
  const [customLon, setCustomLon] = useState<string>("");
  const [inp, setInp] = useState<Omit<CalcInputs, "hourlyProfilePerMw" | "hourlyPrice">>({
    capacityMwp: 10,
    gridMwac: 8,
    capexEurKwp: 750,
    fixedOpexEurKwYr: 12,
    varOpexEurMwh: 1.5,
    degradationPct: 0.5,
    lifetimeYears: 25,
    discountRatePct: 8,
    debtSharePct: 70,
    interestRatePct: 6.5,
    loanTenorYears: 15,
    ppaPriceEurMwh: 65,
    ppaStructure: "hybrid",
    merchantSharePct: 30,
    curtailmentPct: 2,
    negativePriceRule: "curtail_negative",
    curtailThreshold: 5,
  });

  const pvgisFn = useServerFn(fetchPvgis);
  const [profile, setProfile] = useState<number[] | null>(null);
  const [profileSource, setProfileSource] = useState<string>("Demo profile");

  const pvgisMut = useMutation({
    mutationFn: async () => {
      const loc = customLat && customLon
        ? { lat: Number(customLat), lon: Number(customLon) }
        : LOCATIONS[location];
      const r = await pvgisFn({ data: { lat: loc.lat, lon: loc.lon, peakpower: 1 } });
      return r;
    },
    onSuccess: (r) => {
      setProfile(r.hourly);
      setProfileSource(`PVGIS — ${r.yearlyKwhPerKwp.toFixed(0)} kWh/kWp/yr`);
      toast.success("Loaded PVGIS hourly profile");
    },
    onError: (e: Error) => toast.error(e.message || "PVGIS request failed"),
  });

  const priceArr = useMemo(() => getDemoYear().map((p) => p.price), []);
  const demoSolar = useMemo(() => getDemoYear().map((p) => p.solar), []);
  const effectiveProfile = profile ?? demoSolar;

  const results: CalcResults | null = useMemo(() => {
    if (!effectiveProfile.length) return null;
    return runCalc({
      ...inp,
      hourlyProfilePerMw: effectiveProfile,
      hourlyPrice: priceArr,
    });
  }, [inp, effectiveProfile, priceArr]);

  // Sensitivity: CAPEX × PPA price → IRR
  const sens = useMemo(() => {
    if (!effectiveProfile.length) return [];
    const base: CalcInputs = { ...inp, hourlyProfilePerMw: effectiveProfile, hourlyPrice: priceArr };
    return sensitivityMatrix(
      base,
      { key: "capexEurKwp", values: [500, 650, 750, 850, 1000] },
      { key: "ppaPriceEurMwh", values: [40, 55, 65, 75, 90] },
      "irr",
    );
  }, [inp, effectiveProfile, priceArr]);

  const set = (k: keyof typeof inp, v: number | string) =>
    setInp((s) => ({ ...s, [k]: typeof s[k] === "number" ? Number(v) : (v as never) }));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-card space-y-4">
          <h3 className="font-display text-xl">Project inputs</h3>
          <div className="space-y-2">
            <Label>Project name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.keys(LOCATIONS).map((k) => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Custom lat" value={customLat} onChange={(e) => setCustomLat(e.target.value)} />
              <Input placeholder="Custom lon" value={customLon} onChange={(e) => setCustomLon(e.target.value)} />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => pvgisMut.mutate()}
              disabled={pvgisMut.isPending}
            >
              {pvgisMut.isPending ? "Loading PVGIS…" : "Load PVGIS hourly profile"}
            </Button>
            <div className="text-xs text-muted-foreground">{profileSource}</div>
          </div>

          {([
            ["capacityMwp", "Installed capacity (MWp)"],
            ["gridMwac", "Grid connection (MWac)"],
            ["capexEurKwp", "CAPEX (EUR/kWp)"],
            ["fixedOpexEurKwYr", "Fixed OPEX (EUR/kW/yr)"],
            ["varOpexEurMwh", "Variable OPEX (EUR/MWh)"],
            ["degradationPct", "Degradation (%/yr)"],
            ["lifetimeYears", "Lifetime (yrs)"],
            ["discountRatePct", "Discount rate (%)"],
            ["debtSharePct", "Debt share (%)"],
            ["interestRatePct", "Interest rate (%)"],
            ["loanTenorYears", "Loan tenor (yrs)"],
            ["ppaPriceEurMwh", "PPA price (EUR/MWh)"],
            ["merchantSharePct", "Merchant exposure (%)"],
            ["curtailmentPct", "Curtailment (%)"],
            ["curtailThreshold", "Curtail when price <"],
          ] as const).map(([k, lbl]) => (
            <div key={k} className="grid grid-cols-2 items-center gap-3">
              <Label className="text-xs">{lbl}</Label>
              <Input
                type="number"
                value={inp[k] as number}
                onChange={(e) => set(k, e.target.value)}
              />
            </div>
          ))}

          <div className="space-y-2">
            <Label className="text-xs">PPA structure</Label>
            <Select value={inp.ppaStructure} onValueChange={(v) => set("ppaStructure", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed PPA</SelectItem>
                <SelectItem value="pay_as_produced">Pay-as-produced PPA</SelectItem>
                <SelectItem value="baseload">Baseload PPA</SelectItem>
                <SelectItem value="merchant">Merchant only</SelectItem>
                <SelectItem value="hybrid">Hybrid PPA + merchant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Negative price rule</Label>
            <Select value={inp.negativePriceRule} onValueChange={(v) => set("negativePriceRule", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Always produce</SelectItem>
                <SelectItem value="curtail_negative">Curtail when price &lt; 0</SelectItem>
                <SelectItem value="curtail_threshold">Curtail below threshold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground border-t border-border/60 pt-3">
            This tool provides indicative calculations only and should not be interpreted as
            financial or investment advice.
          </p>
        </section>

        <div className="space-y-6">
          {results && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Annual generation" value={results.annualGenMwh.toFixed(0)} unit="MWh" />
                <KpiCard label="Capacity factor" value={`${(results.capacityFactor * 100).toFixed(1)}%`} />
                <KpiCard label="Capture price" value={results.capturePrice.toFixed(1)} unit="EUR/MWh" />
                <KpiCard label="Capture rate" value={`${(results.captureRate * 100).toFixed(1)}%`} />
                <KpiCard label="Blended realised price" value={results.blendedPrice.toFixed(1)} unit="EUR/MWh" />
                <KpiCard label="LCOE" value={results.lcoeEurMwh.toFixed(1)} unit="EUR/MWh" />
                <KpiCard label="Project IRR" value={results.irr != null ? `${(results.irr * 100).toFixed(1)}%` : "—"} />
                <KpiCard label="NPV" value={`${(results.npv / 1e6).toFixed(2)} M€`} />
                <KpiCard label="Payback" value={results.paybackYears != null ? `${results.paybackYears.toFixed(1)} y` : "—"} />
                <KpiCard label="DSCR (min)" value={results.dscrMin.toFixed(2)} />
                <KpiCard label="EBITDA (yr 1)" value={`${(results.ebitdaYear1 / 1e6).toFixed(2)} M€`} />
                <KpiCard label="Break-even PPA" value={results.breakEvenPpa.toFixed(1)} unit="EUR/MWh" />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <ChartCard title="Monthly generation">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={results.monthlyGen.map((m) => ({ month: m.month, mwh: +m.mwh.toFixed(0) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                      <RTooltip />
                      <Bar dataKey="mwh" fill="var(--color-chart-3)" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Monthly merchant revenue (EUR)">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={results.monthlyRevenue.map((m) => ({ month: m.month, eur: +m.eur.toFixed(0) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                      <RTooltip />
                      <Bar dataKey="eur" fill="var(--color-chart-1)" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <ChartCard title="Project cashflow" description="Annual project cashflow (after CAPEX in year 0).">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={results.cashflows.map((cf, i) => ({ year: i, cf: +(cf / 1e6).toFixed(3) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} unit=" M€" />
                    <RTooltip />
                    <Line type="monotone" dataKey="cf" stroke="var(--color-chart-2)" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Sensitivity — CAPEX × PPA price → IRR"
                description="Each point shows project IRR for the (CAPEX, PPA) combination."
              >
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis type="number" dataKey="x" name="CAPEX" unit=" €/kWp" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                    <YAxis type="number" dataKey="y" name="PPA" unit=" €/MWh" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                    <RTooltip
                      formatter={(v: number, n: string) => n === "IRR" ? `${(v * 100).toFixed(1)}%` : v}
                    />
                    <Legend />
                    <Scatter
                      name="IRR"
                      data={sens.map((c) => ({ x: c.x, y: c.y, IRR: c.value }))}
                      fill="var(--color-chart-1)"
                    >
                      {sens.map((c, i) => {
                        const t = Math.max(0, Math.min(1, ((c.value ?? 0) + 0.1) / 0.4));
                        return <circle key={i} r={10} fill={`oklch(${0.55 + t * 0.15} 0.13 ${130 - t * 80})`} />;
                      })}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartCard>
            </>
          )}
          {!results && <DemoBadge />}
        </div>
      </div>
    </div>
  );
}
