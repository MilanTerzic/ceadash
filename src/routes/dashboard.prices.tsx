import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, SlidersHorizontal, X } from "lucide-react";

import { DataBadge } from "@/components/data-badge";
import {
  DateRangeControl,
  type ComparisonKey,
  type DateRangeKeys,
} from "@/components/dashboard/DateRangeControl";
import { Panel } from "@/components/panel";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDateRange } from "@/lib/date-range";
import { getAverageDAProfile } from "@/lib/data.functions";
import { downloadCSV, fmtNum, fmtPrice } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import {
  MARKET_PRESETS,
  PRICE_MARKETS,
  PRICE_MARKET_LIST,
  type PriceMarketCode,
} from "@/lib/price-markets";

export const Route = createFileRoute("/dashboard/prices")({
  head: () => ({ meta: [{ title: "Prices & Spreads - CEA Power Dashboard" }] }),
  component: PricesPage,
});

type MarketPresetId = "serbia" | "core" | "see" | "wb6" | "all";

const PRICE_PERIOD_PRESETS = [
  "today",
  "d1",
  "7d",
  "30d",
  "mtd",
  "prev_month",
  "ytd",
  "custom",
] as const;

const COMPACT_MARKET_PRESETS: Record<
  MarketPresetId,
  { label: string; markets: PriceMarketCode[] }
> = {
  serbia: { label: "Serbia", markets: MARKET_PRESETS.serbiaOnly },
  core: { label: "Core", markets: MARKET_PRESETS.core },
  see: { label: "SEE", markets: MARKET_PRESETS.regional },
  wb6: { label: "WB6", markets: ["RS", "ME", "MK", "AL"] },
  all: { label: "All", markets: MARKET_PRESETS.all },
};

function PricesPage() {
  const fn = useServerFn(getAverageDAProfile);
  const { range, setRange } = useDateRange();
  const { t } = useLang();
  const [selectedMarkets, setSelectedMarkets] = useState<PriceMarketCode[]>(
    MARKET_PRESETS.serbiaOnly,
  );
  const [preset, setPreset] = useState<MarketPresetId>("serbia");
  const [marketSearch, setMarketSearch] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [comparison, setComparison] = useState<ComparisonKey>("previous_equivalent");
  const [comparisonRange, setComparisonRange] = useState<DateRangeKeys | undefined>();

  const q = useQuery({
    queryKey: ["da_profile", range.from, range.to, refreshNonce],
    queryFn: () => fn({ data: { from: range.from, to: range.to, force: refreshNonce > 0 } }),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const comparisonQuery = useQuery({
    queryKey: ["da_profile_comparison", comparisonRange?.from, comparisonRange?.to, refreshNonce],
    queryFn: () =>
      fn({
        data: {
          from: comparisonRange!.from,
          to: comparisonRange!.to,
          force: refreshNonce > 0,
        },
      }),
    enabled: Boolean(comparisonRange),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const selectedSet = useMemo(() => new Set(selectedMarkets), [selectedMarkets]);

  const chartData = useMemo(
    () =>
      Array.from({ length: 24 }, (_, hour) => {
        const row: Record<string, number | string | null> = {
          hour: `${String(hour).padStart(2, "0")}:00`,
        };
        for (const r of rows) row[r.zone] = r.profile[hour];
        return row;
      }),
    [rows],
  );

  const stats = useMemo(
    () =>
      rows.map((r) => {
        const s = r.stats;
        return {
          zone: r.zone as PriceMarketCode,
          avg: s.baseloadAverage,
          dailyAvg: s.dailyBaseloadAverage,
          profileAvg: s.profileAverage,
          peakAvg: s.peakAverage,
          offAvg: s.offPeakAverage,
          min: s.minimum,
          max: s.maximum,
          vol: s.volatility,
          negativeIntervals: s.negativePriceIntervals,
          receivedIntervals: s.receivedIntervals,
          expectedIntervals: s.expectedIntervals,
          completeDays: s.completeDays,
          daysWithData: s.daysWithData,
          incompleteDays: s.incompleteDays,
          source: r.source,
          reason: r.reason,
        };
      }),
    [rows],
  );

  const selectedStats = stats.filter((row) => selectedSet.has(row.zone));
  const comparisonStats = useMemo(
    () =>
      (comparisonQuery.data?.rows ?? []).map((r) => ({
        receivedIntervals: r.stats.receivedIntervals,
        expectedIntervals: r.stats.expectedIntervals,
        completeDays: r.stats.completeDays,
        daysWithData: r.stats.daysWithData,
      })),
    [comparisonQuery.data],
  );
  const serbiaStats = stats.find((row) => row.zone === "RS");
  const spreadRows = stats
    .filter((row) => row.zone !== "RS")
    .map((row) => ({
      zone: row.zone,
      market: PRICE_MARKETS[row.zone]?.displayLabel ?? row.zone,
      baseloadSpread: subtract(row.avg, serbiaStats?.avg),
      peakSpread: subtract(row.peakAvg, serbiaStats?.peakAvg),
      offPeakSpread: subtract(row.offAvg, serbiaStats?.offAvg),
      interpretation:
        subtract(row.avg, serbiaStats?.avg) == null
          ? "Unavailable"
          : (subtract(row.avg, serbiaStats?.avg) ?? 0) > 0
            ? "Serbia discount"
            : "Serbia premium",
      source: row.source,
    }));

  const rangeLabel = range.from === range.to ? range.from : `${range.from} -> ${range.to}`;
  const coverage = useMemo(() => {
    if (!stats.length) {
      return q.isFetching
        ? t("Loading Prices & Spreads coverage...", "Ucitavanje pokrivenosti cena i spreadova...")
        : t("No Prices & Spreads data loaded yet.", "Podaci za cene i spreadove jos nisu ucitani.");
    }

    const totals = stats.reduce(
      (acc, row) => ({
        received: acc.received + row.receivedIntervals,
        expected: acc.expected + row.expectedIntervals,
        complete: acc.complete + row.completeDays,
        requested: acc.requested + row.daysWithData,
      }),
      { received: 0, expected: 0, complete: 0, requested: 0 },
    );
    const base = t(
      `Prices & Spreads: ${totals.received}/${totals.expected} intervals, ${totals.complete}/${totals.requested} complete market-days.`,
      `Cene i spreadovi: ${totals.received}/${totals.expected} intervala, ${totals.complete}/${totals.requested} kompletnih trzisnih dana.`,
    );

    if (!comparisonRange) return base;
    if (comparisonQuery.isFetching && !comparisonStats.length) {
      return `${base} ${t("Comparison coverage loading.", "Pokrivenost poredjenja se ucitava.")}`;
    }
    if (!comparisonStats.length) return base;

    const comparisonTotals = comparisonStats.reduce(
      (acc, row) => ({
        received: acc.received + row.receivedIntervals,
        expected: acc.expected + row.expectedIntervals,
        complete: acc.complete + row.completeDays,
        requested: acc.requested + row.daysWithData,
      }),
      { received: 0, expected: 0, complete: 0, requested: 0 },
    );
    return `${base} ${t(
      `Comparison: ${comparisonTotals.received}/${comparisonTotals.expected} intervals, ${comparisonTotals.complete}/${comparisonTotals.requested} complete market-days.`,
      `Poredjenje: ${comparisonTotals.received}/${comparisonTotals.expected} intervala, ${comparisonTotals.complete}/${comparisonTotals.requested} kompletnih trzisnih dana.`,
    )}`;
  }, [comparisonQuery.isFetching, comparisonRange, comparisonStats, q.isFetching, stats, t]);

  const handleComparisonChange = useCallback((value: ComparisonKey, nextRange?: DateRangeKeys) => {
    setComparison(value);
    setComparisonRange(nextRange);
  }, []);

  return (
    <>
      <TopBar
        title={t("Prices & Spreads", "Cene i spreadovi")}
        subtitle={t(
          `Market summary, hourly profiles and regional spreads for ${rangeLabel} in Europe/Belgrade local time`,
          `Pregled tržišta, satni profili i regionalni spreadovi za ${rangeLabel} u vremenu Europe/Belgrade`,
        )}
        hideRange
      />
      <div className="space-y-5 p-6">
        <DateRangeControl
          range={range}
          presets={[...PRICE_PERIOD_PRESETS]}
          onRangeChange={(next) => setRange(next)}
          comparison={comparison}
          onComparisonChange={handleComparisonChange}
          coverage={coverage}
          lastRefresh={rows[0]?.fetched_at}
          onRefresh={() => setRefreshNonce((value) => value + 1)}
          isRefreshing={q.isFetching}
          maxFutureDays={1}
        />

        <Panel
          title={t("Market summary", "Pregled tržišta")}
          actions={<ExportMenu chartData={chartData} stats={stats} spreadRows={spreadRows} t={t} />}
        >
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <MarketControls
              selected={selectedMarkets}
              setSelected={setSelectedMarkets}
              preset={preset}
              setPreset={setPreset}
              marketSearch={marketSearch}
              setMarketSearch={setMarketSearch}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard
              label={t("Serbia baseload", "Bazna cena Srbije")}
              value={fmtPrice(serbiaStats?.avg)}
              sub={PRICE_MARKETS.RS.displayLabel}
            />
            <SummaryCard
              label={t("Serbia peakload", "Vršno opterećenje Srbije")}
              value={fmtPrice(serbiaStats?.peakAvg)}
              sub="08:00-20:00"
            />
            <SummaryCard
              label={t("Markets selected", "Izabrana tržišta")}
              value={`${selectedMarkets.length}`}
              sub={selectedMarkets.map((code) => PRICE_MARKETS[code]?.label ?? code).join(", ")}
            />
          </div>
        </Panel>

        <Panel title={t("Hourly price profiles", "Satni profili cena")}>
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" EUR" />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {rows
                  .filter((r) => selectedSet.has(r.zone as PriceMarketCode))
                  .map((r) => {
                    const market = PRICE_MARKETS[r.zone as PriceMarketCode];
                    return (
                      <Line
                        key={r.zone}
                        dataKey={r.zone}
                        name={market?.label ?? r.zone}
                        stroke={market?.chartColor ?? "#94a3b8"}
                        dot={false}
                        strokeWidth={r.zone === "RS" ? 2.5 : 1.2}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    );
                  })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title={t(
            "Baseload, peakload and off-peak statistics",
            "Baseload, peakload i off-peak statistika",
          )}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-left">{t("Market", "Tržište")}</th>
                  <th className="text-right">Baseload</th>
                  <th className="text-right">{t("Daily avg", "Dnevni prosek")}</th>
                  <th className="text-right">Peak</th>
                  <th className="text-right">Off-peak</th>
                  <th className="text-right">Min</th>
                  <th className="text-right">Max</th>
                  <th className="text-right">{t("Volatility", "Volatilnost")}</th>
                  <th className="text-right">{t("Negative", "Negativno")}</th>
                  <th className="text-right">{t("Intervals", "Intervali")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selectedStats.map((s) => (
                  <tr key={s.zone} className="border-t border-border/60">
                    <td className="py-1.5 font-medium" title={s.reason}>
                      {PRICE_MARKETS[s.zone]?.displayLabel ?? s.zone}
                    </td>
                    <td className="num text-right">{fmtPrice(s.avg)}</td>
                    <td className="num text-right">{fmtPrice(s.dailyAvg)}</td>
                    <td className="num text-right">{fmtPrice(s.peakAvg)}</td>
                    <td className="num text-right">{fmtPrice(s.offAvg)}</td>
                    <td className="num text-right">{fmtPrice(s.min)}</td>
                    <td className="num text-right">{fmtPrice(s.max)}</td>
                    <td className="num text-right">{fmtNum(s.vol)}</td>
                    <td className="num text-right">{s.negativeIntervals}</td>
                    <td className="num text-right">
                      {s.receivedIntervals}/{s.expectedIntervals}
                    </td>
                    <td className="text-right">
                      <DataBadge source={s.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title={t(
            "Serbia versus regional market spreads",
            "Srbija u odnosu na regionalne spreadove",
          )}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-left">{t("Market", "Tržište")}</th>
                  <th className="text-right">{t("Baseload spread", "Spread bazne cene")}</th>
                  <th className="text-right">{t("Peak spread", "Vršni spread")}</th>
                  <th className="text-right">{t("Off-peak spread", "Vanvršni spread")}</th>
                  <th className="text-left">{t("Signal", "Signal")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {spreadRows
                  .filter((row) => selectedSet.has(row.zone))
                  .map((row) => (
                    <tr key={row.zone} className="border-t border-border/60">
                      <td className="py-1.5 font-medium">{row.market}</td>
                      <td className="num text-right">{fmtPrice(row.baseloadSpread)}</td>
                      <td className="num text-right">{fmtPrice(row.peakSpread)}</td>
                      <td className="num text-right">{fmtPrice(row.offPeakSpread)}</td>
                      <td>{row.interpretation}</td>
                      <td className="text-right">
                        <DataBadge source={row.source} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={t("Regional comparison table", "Regionalna tabela poređenja")}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-left">{t("Market", "Tržište")}</th>
                  <th className="text-right">Baseload</th>
                  <th className="text-right">Min</th>
                  <th className="text-right">Max</th>
                  <th className="text-right">{t("Completeness", "Kompletnost")}</th>
                  <th className="text-right">{t("Complete days", "Kompletni dani")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.zone} className="border-t border-border/60">
                    <td className="py-1.5 font-medium">
                      {PRICE_MARKETS[s.zone]?.displayLabel ?? s.zone}
                    </td>
                    <td className="num text-right">{fmtPrice(s.avg)}</td>
                    <td className="num text-right">{fmtPrice(s.min)}</td>
                    <td className="num text-right">{fmtPrice(s.max)}</td>
                    <td className="num text-right">
                      {s.receivedIntervals}/{s.expectedIntervals}
                    </td>
                    <td className="num text-right">
                      {s.completeDays}/{s.daysWithData}
                    </td>
                    <td className="text-right">
                      <DataBadge source={s.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

function MarketControls({
  selected,
  setSelected,
  preset,
  setPreset,
  marketSearch,
  setMarketSearch,
}: {
  selected: PriceMarketCode[];
  setSelected: (markets: PriceMarketCode[]) => void;
  preset: MarketPresetId;
  setPreset: (preset: MarketPresetId) => void;
  marketSearch: string;
  setMarketSearch: (value: string) => void;
}) {
  const filteredMarkets = PRICE_MARKET_LIST.filter((market) => {
    const q = marketSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      market.code.toLowerCase().includes(q) ||
      market.label.toLowerCase().includes(q) ||
      market.displayLabel.toLowerCase().includes(q)
    );
  });

  const applyPreset = (id: MarketPresetId) => {
    setPreset(id);
    setSelected(COMPACT_MARKET_PRESETS[id].markets);
  };

  const toggleMarket = (code: PriceMarketCode) => {
    setSelected(
      selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code],
    );
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Select value={preset} onValueChange={(value) => applyPreset(value as MarketPresetId)}>
          <SelectTrigger className="h-10 w-[150px]">
            <SelectValue placeholder="Preset" />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.entries(COMPACT_MARKET_PRESETS) as Array<
                [MarketPresetId, (typeof COMPACT_MARKET_PRESETS)[MarketPresetId]]
              >
            ).map(([id, item]) => (
              <SelectItem key={id} value={id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-10 gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Markets ({selected.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 p-2">
            <DropdownMenuLabel>Search markets</DropdownMenuLabel>
            <Input
              value={marketSearch}
              onChange={(event) => setMarketSearch(event.target.value)}
              placeholder="Serbia, Hungary, RS..."
              className="mb-2 h-9"
            />
            <div className="max-h-72 overflow-y-auto">
              {filteredMarkets.map((market) => (
                <DropdownMenuCheckboxItem
                  key={market.code}
                  checked={selected.includes(market.code)}
                  onCheckedChange={() => toggleMarket(market.code)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: market.chartColor }}
                  />
                  {market.displayLabel}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setSelected(MARKET_PRESETS.serbiaOnly);
                setPreset("serbia");
              }}
            >
              Clear to Serbia
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          className="h-10"
          onClick={() => {
            setSelected(MARKET_PRESETS.serbiaOnly);
            setPreset("serbia");
          }}
        >
          Clear
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {selected.map((code) => {
          const market = PRICE_MARKETS[code];
          return (
            <button
              key={code}
              type="button"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border/70 bg-surface-2 px-2.5 text-xs text-foreground"
              onClick={() => toggleMarket(code)}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: market?.chartColor ?? "#94a3b8" }}
              />
              {market?.label ?? code}
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExportMenu({
  chartData,
  stats,
  spreadRows,
  t,
}: {
  chartData: Array<Record<string, number | string | null>>;
  stats: unknown[];
  spreadRows: unknown[];
  t: (en: string, sr: string) => string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          {t("Export", "Izvoz")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadCSV("da-hourly-avg.csv", chartData as never)}>
          {t("Hourly profiles CSV", "Satni profili CSV")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadCSV("price-stats.csv", stats as never)}>
          {t("Statistics CSV", "Statistika CSV")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadCSV("serbia-spreads.csv", spreadRows as never)}>
          {t("Spreads CSV", "Spreadovi CSV")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface-2 p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground" title={sub}>
        {sub}
      </div>
    </div>
  );
}

function subtract(a: number | null | undefined, b: number | null | undefined) {
  return a == null || b == null ? null : a - b;
}
