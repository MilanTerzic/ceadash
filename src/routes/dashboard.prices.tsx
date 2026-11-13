import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Save, Trash2 } from "lucide-react";

import { HeatGrid, TimeChart, XYChart, type ChartSeries } from "@/components/cea/charts";
import {
  DataState,
  DataTable,
  Delta,
  Panel,
  ProvenanceBadge,
  Segmented,
} from "@/components/cea/primitives";
import { MarketPicker, useColorSlots } from "@/components/see/MarketPicker";
import { useDateRange } from "@/lib/date-range";
import { downloadCSV } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import {
  aggregateBy,
  correlation,
  dailyStats,
  deliveryHours,
  durationCurve,
  hourProfile,
  indexTo100,
  marketTime,
  priceStats,
  spreadSeries,
  type Bucket,
  type Series,
  EMPTY_SERIES,
} from "@/lib/see/analytics";
import { divergingColor, sequentialColor } from "@/lib/see/colors";
import { fmt, fmtEpochHour, fmtPrice, fmtShare } from "@/lib/see/format";
import { daysBetween } from "@/lib/see/region";
import { PRICED_CODES, SEE_MARKETS, isSeeCode, type SeeCode } from "@/lib/see/registry";
import { useSelection } from "@/lib/see/selection";
import { worstState } from "@/lib/see/status";
import { usePersistent } from "@/lib/see/store";
import { useSeePrices } from "@/lib/see/use-see-data";

export const Route = createFileRoute("/dashboard/prices")({
  component: PriceAnalytics,
});

type Mode = "price" | "spread" | "index";
type Grain = "hour" | "day" | "peak";
interface Template {
  name: string;
  markets: SeeCode[];
  mode: Mode;
  grain: Grain;
}
const NO_TEMPLATES: Template[] = [];
const DEFAULT_MARKETS: SeeCode[] = ["RS", "HU", "RO", "BG", "HR"];
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

/** Daily series (base or peak) placed at each market-time day's first hour. */
function dailySeries(series: Series, field: "base" | "peak"): Series {
  const firstHour = new Map<string, number>();
  for (const t of series.t) {
    const { day } = marketTime(t);
    if (!firstHour.has(day)) firstHour.set(day, t);
  }
  const out: Series = { t: [], v: [] };
  for (const day of dailyStats(series)) {
    const value = day[field];
    if (!day.complete || value === null) continue;
    out.t.push(firstHour.get(day.day)!);
    out.v.push(value);
  }
  return out;
}

function PriceAnalytics() {
  const { t, lang } = useLang();
  const { range } = useDateRange();
  const { market: selectedMarket, reference, setReference } = useSelection();
  const prices = useSeePrices();
  const [markets, setMarkets] = useState<SeeCode[]>(() =>
    selectedMarket &&
    SEE_MARKETS[selectedMarket].price !== null &&
    !DEFAULT_MARKETS.includes(selectedMarket)
      ? [...DEFAULT_MARKETS, selectedMarket]
      : DEFAULT_MARKETS,
  );
  const [mode, setMode] = useState<Mode>("price");
  const [grain, setGrain] = useState<Grain>("hour");
  const [bucket, setBucket] = useState<Bucket>("month");
  const [calendarMarket, setCalendarMarket] = useState<SeeCode | null>(null);
  const [templates, setTemplates] = usePersistent<Template[]>("views", NO_TEMPLATES);
  const colors = useColorSlots(markets);

  const heatMarket =
    calendarMarket && markets.includes(calendarMarket) ? calendarMarket : (markets[0] ?? null);
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  const expectedHours = useMemo(
    () => days.reduce((sum, day) => sum + deliveryHours(day), 0),
    [days],
  );
  const refSeries = prices.data[reference]?.series;

  const rows = useMemo(
    () =>
      markets.map((code) => {
        const series = prices.data[code]?.series ?? EMPTY_SERIES;
        return {
          code,
          series,
          stats: priceStats(series),
          status: prices.data[code]?.status,
          native: prices.data[code]?.nativeMinutes ?? null,
          corr: refSeries && code !== reference ? correlation(series, refSeries) : null,
          vsRef:
            refSeries && code !== reference
              ? (() => {
                  const s = spreadSeries(refSeries, series);
                  return s.v.length ? s.v.reduce((a, b) => a + b, 0) / s.v.length : null;
                })()
              : null,
        };
      }),
    [markets, prices.data, refSeries, reference],
  );

  const chartSeries: ChartSeries[] = useMemo(
    () =>
      rows
        .map((row): ChartSeries | null => {
          let data =
            grain === "hour"
              ? row.series
              : dailySeries(row.series, grain === "day" ? "base" : "peak");
          if (mode === "spread") {
            if (row.code === reference || !refSeries) return null;
            const refData =
              grain === "hour"
                ? refSeries
                : dailySeries(refSeries, grain === "day" ? "base" : "peak");
            data = spreadSeries(refData, data);
          } else if (mode === "index") {
            data = indexTo100(data);
          }
          return {
            key: row.code,
            label: SEE_MARKETS[row.code].short,
            color: colors[row.code],
            data,
          };
        })
        .filter((item): item is ChartSeries => item !== null && item.data.t.length > 0),
    [rows, grain, mode, reference, refSeries, colors],
  );

  const unit = mode === "index" ? "index" : "€/MWh";
  const loading = prices.isLoading;
  const anyData = rows.some((row) => row.stats.hours > 0);
  const state = worstState(rows.map((row) => row.status?.state).filter(Boolean) as never[]);

  const profiles = useMemo(
    () =>
      rows
        .filter((row) => row.stats.hours > 0)
        .map((row) => ({
          key: row.code,
          label: SEE_MARKETS[row.code].short,
          color: colors[row.code],
          points: hourProfile(row.series)
            .map((value, hour) => ({ x: hour, y: value }))
            .filter((point): point is { x: number; y: number } => point.y !== null),
        })),
    [rows, colors],
  );

  const durations = useMemo(
    () =>
      rows
        .filter((row) => row.stats.hours > 0)
        .map((row) => {
          const curve = durationCurve(row.series);
          // 201 evenly spaced points are plenty for a curve and keep long periods fast.
          const step = Math.max(1, Math.floor(curve.length / 200));
          const points = curve.filter(
            (_, index) => index % step === 0 || index === curve.length - 1,
          );
          return {
            key: row.code,
            label: SEE_MARKETS[row.code].short,
            color: colors[row.code],
            points: points.map((point) => ({ x: Math.round(point.pct * 10) / 10, y: point.value })),
          };
        }),
    [rows, colors],
  );

  const calendar = useMemo(() => {
    if (!heatMarket) return null;
    const series = prices.data[heatMarket]?.series;
    if (!series?.t.length) return null;
    const byDay = new Map<string, Array<number | null>>();
    for (let i = 0; i < series.t.length; i++) {
      const { day, hour } = marketTime(series.t[i]);
      const cells = byDay.get(day) ?? new Array<number | null>(24).fill(null);
      // On the 25-hour day the repeated hour keeps its first value.
      if (cells[hour] === null) cells[hour] = series.v[i];
      byDay.set(day, cells);
    }
    const all = series.v;
    const centre = all.reduce((sum, value) => sum + value, 0) / all.length;
    const span = Math.max(15, ...all.map((value) => Math.abs(value - centre))) * 0.8;
    const list = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 35);
    return { list, centre, span, truncated: byDay.size > 35 };
  }, [heatMarket, prices.data]);

  const buckets = useMemo(() => {
    const perMarket = rows.map((row) => ({
      code: row.code,
      stats: aggregateBy(row.series, bucket),
    }));
    const keys = [...new Set(perMarket.flatMap((item) => item.stats.map((stat) => stat.key)))]
      .sort()
      .reverse();
    return { perMarket, keys: keys.slice(0, 24) };
  }, [rows, bucket]);

  const exportCsv = () => {
    const hours = [...new Set(rows.flatMap((row) => row.series.t))].sort((a, b) => a - b);
    const maps = rows.map((row) => {
      const map = new Map<number, number>();
      row.series.t.forEach((hour, index) => map.set(hour, row.series.v[index]));
      return map;
    });
    downloadCSV(
      `cea-day-ahead-prices_${range.from}_${range.to}.csv`,
      hours.map((hour) => ({
        utc: new Date(hour * 3_600_000).toISOString(),
        market_time_cet: fmtEpochHour(hour),
        ...Object.fromEntries(
          rows.map((row, index) => [`${row.code}_eur_mwh`, maps[index].get(hour) ?? ""]),
        ),
      })),
    );
  };

  const saveTemplate = () => {
    const name = window.prompt(t("Name this comparison", "Naziv poređenja"));
    if (!name?.trim()) return;
    setTemplates((prev) => [
      ...prev.filter((item) => item.name !== name.trim()),
      { name: name.trim(), markets, mode, grain },
    ]);
  };

  return (
    <div className="grid gap-2 p-2">
      <Panel flush>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
          <MarketPicker
            options={PRICED_CODES}
            selected={markets}
            onChange={setMarkets}
            colors={colors}
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {t("Reference", "Referenca")}
              <select
                value={reference}
                onChange={(event) =>
                  isSeeCode(event.target.value) && setReference(event.target.value)
                }
                className="num h-6 rounded-sm border border-input bg-background px-1.5 text-xs text-foreground"
              >
                {PRICED_CODES.map((code) => (
                  <option key={code} value={code}>
                    {SEE_MARKETS[code].short}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={saveTemplate}
              title={t("Save this comparison on this device", "Sačuvaj poređenje na ovom uređaju")}
              className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 text-xs text-ink-2 hover:border-border-strong hover:text-foreground"
            >
              <Save className="h-3 w-3" />
              {t("Save view", "Sačuvaj prikaz")}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!anyData}
              className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 text-xs text-ink-2 hover:border-border-strong hover:text-foreground disabled:opacity-40"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
          </div>
        </div>
        {templates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-1.5">
            <span className="eyebrow">{t("Saved views", "Sačuvani prikazi")}</span>
            {templates.map((template) => (
              <span
                key={template.name}
                className="inline-flex items-center rounded-sm border border-border"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMarkets(template.markets.filter((code) => PRICED_CODES.includes(code)));
                    setMode(template.mode);
                    setGrain(template.grain);
                  }}
                  className="h-6 px-2 text-xs text-ink-2 hover:text-foreground"
                >
                  {template.name}
                </button>
                <button
                  type="button"
                  aria-label={`${t("Delete", "Obriši")} ${template.name}`}
                  onClick={() =>
                    setTemplates((prev) => prev.filter((item) => item.name !== template.name))
                  }
                  className="flex h-6 w-6 items-center justify-center border-l border-border text-muted-foreground hover:text-critical"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title={
          mode === "price"
            ? t("Day-ahead prices", "Day-ahead cene")
            : mode === "spread"
              ? `${t("Spread to", "Spread prema")} ${SEE_MARKETS[reference].short}`
              : t("Indexed to 100 at period start", "Indeksirano na 100 na početku perioda")
        }
        subtitle={
          mode === "spread"
            ? t(
                "Market price minus reference price, matched hours only",
                "Cena tržišta minus referentna cena, samo upareni sati",
              )
            : t(
                "Market time (CET/CEST). Drag the strip below the chart to zoom.",
                "Tržišno vreme (CET/CEST). Prevucite traku ispod grafikona za zum.",
              )
        }
        status={<ProvenanceBadge state={loading ? null : state} />}
        actions={
          <>
            <Segmented
              size="xs"
              value={grain}
              onChange={setGrain}
              ariaLabel={t("Granularity", "Granularnost")}
              options={[
                { value: "hour", label: t("Hourly", "Satno") },
                { value: "day", label: t("Daily base", "Dnevni base") },
                { value: "peak", label: t("Daily peak", "Dnevni peak") },
              ]}
            />
            <Segmented
              size="xs"
              value={mode}
              onChange={setMode}
              ariaLabel={t("Normalisation", "Normalizacija")}
              options={[
                { value: "price", label: "€/MWh" },
                { value: "spread", label: `Δ ${SEE_MARKETS[reference].short}` },
                { value: "index", label: "=100" },
              ]}
            />
          </>
        }
      >
        {chartSeries.length === 0 ? (
          <DataState loading={loading} status={rows[0]?.status} height={340}>
            {markets.length === 0
              ? t("Select at least one market above.", "Izaberite bar jedno tržište iznad.")
              : mode === "spread" && anyData
                ? t(
                    "Select a market other than the reference to see a spread.",
                    "Izaberite tržište različito od reference.",
                  )
                : undefined}
          </DataState>
        ) : (
          <TimeChart
            series={chartSeries}
            unit={unit}
            height={340}
            brush
            zeroLine={mode === "spread"}
          />
        )}
      </Panel>

      <Panel
        title={t("Statistics for the period", "Statistika perioda")}
        subtitle={`${days.length} ${t("delivery days", "dana isporuke")} · ${expectedHours} ${t("hours expected", "očekivanih sati")}`}
        flush
      >
        {!anyData ? (
          <DataState loading={loading} status={rows[0]?.status} height={120} />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>{t("Market", "Tržište")}</th>
                <th className="!text-right">Base</th>
                <th className="!text-right">Peak</th>
                <th className="!text-right">Off-peak</th>
                <th className="!text-right">Min</th>
                <th className="!text-right">Max</th>
                <th
                  className="!text-right"
                  title={t(
                    "Standard deviation of hourly prices",
                    "Standardna devijacija satnih cena",
                  )}
                >
                  {t("Std dev", "Std dev")}
                </th>
                <th
                  className="!text-right"
                  title={t("Mean daily max − min", "Prosečan dnevni maks − min")}
                >
                  {t("Daily range", "Dnevni raspon")}
                </th>
                <th className="!text-right">&lt;0 h</th>
                <th className="!text-right">Δ {SEE_MARKETS[reference].short}</th>
                <th
                  className="!text-right"
                  title={t(
                    "Hourly correlation with the reference",
                    "Satna korelacija sa referencom",
                  )}
                >
                  {t("Corr", "Kor")} {SEE_MARKETS[reference].short}
                </th>
                <th
                  className="!text-right"
                  title={t("Hours with a price ÷ hours expected", "Sati sa cenom ÷ očekivani sati")}
                >
                  {t("Coverage", "Pokrivenost")}
                </th>
                <th>MTU</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <td>
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-[2px]"
                      style={{ background: colors[row.code] }}
                    />
                    <span className="font-condensed text-xs font-semibold tracking-wide">
                      {SEE_MARKETS[row.code].short}
                    </span>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {lang === "sr" ? SEE_MARKETS[row.code].nameSr : SEE_MARKETS[row.code].name}
                    </span>
                  </td>
                  <td className="num text-right">{fmtPrice(row.stats.base)}</td>
                  <td className="num text-right">{fmtPrice(row.stats.peak)}</td>
                  <td className="num text-right">{fmtPrice(row.stats.offPeak)}</td>
                  <td className="num text-right">{fmt(row.stats.min, 1)}</td>
                  <td className="num text-right">{fmt(row.stats.max, 1)}</td>
                  <td className="num text-right">{fmt(row.stats.volatility, 1)}</td>
                  <td className="num text-right">{fmt(row.stats.dailySpread, 1)}</td>
                  <td className="num text-right">
                    {row.stats.hours ? row.stats.negativeHours : "—"}
                  </td>
                  <td className="text-right">
                    {row.vsRef === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Delta value={row.vsRef} className="text-xs" />
                    )}
                  </td>
                  <td className="num text-right">{fmt(row.corr, 2)}</td>
                  <td className="num text-right">
                    {fmtShare(expectedHours ? Math.min(1, row.stats.hours / expectedHours) : null)}
                  </td>
                  <td className="num text-muted-foreground">
                    {row.native ? `${row.native}′` : "—"}
                  </td>
                  <td className="text-right">
                    {row.status && <ProvenanceBadge status={row.status} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>

      <div className="grid gap-2 xl:grid-cols-2">
        <Panel
          title={t("Hourly profile", "Satni profil")}
          subtitle={t(
            "Mean price by hour of day, market time",
            "Prosečna cena po satu dana, tržišno vreme",
          )}
        >
          {profiles.length === 0 ? (
            <DataState loading={loading} status={rows[0]?.status} height={220} />
          ) : (
            <XYChart
              series={profiles}
              unit="€/MWh"
              height={220}
              xTicks={[0, 3, 6, 9, 12, 15, 18, 21, 23]}
              formatX={(x) => `${String(x).padStart(2, "0")}:00`}
            />
          )}
        </Panel>
        <Panel
          title={t("Price duration curve", "Kriva trajanja cena")}
          subtitle={t("Share of hours at or above each price", "Udeo sati na ili iznad svake cene")}
        >
          {durations.length === 0 ? (
            <DataState loading={loading} status={rows[0]?.status} height={220} />
          ) : (
            <XYChart
              series={durations}
              unit="€/MWh"
              height={220}
              zeroLine
              xTicks={[0, 20, 40, 60, 80, 100]}
              formatX={(x) => `${fmt(x, 0)}%`}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title={t("Hourly heat calendar", "Satni toplotni kalendar")}
          subtitle={t(
            "Each row is a delivery day, newest first",
            "Svaki red je dan isporuke, najnoviji prvi",
          )}
          actions={
            <Segmented
              size="xs"
              value={heatMarket ?? ""}
              onChange={(value) => isSeeCode(value) && setCalendarMarket(value)}
              options={markets.map((code) => ({ value: code, label: SEE_MARKETS[code].short }))}
            />
          }
        >
          {!calendar ? (
            <DataState
              loading={loading}
              status={heatMarket ? prices.data[heatMarket]?.status : undefined}
              height={200}
            />
          ) : (
            <>
              <HeatGrid
                columns={HOURS}
                rowHeader={t("Day", "Dan")}
                summaryHeader="Base"
                cellHeight={15}
                rows={calendar.list.map(([day, cells]) => {
                  const present = cells.filter((value): value is number => value !== null);
                  return {
                    id: day,
                    label: <span className="num font-normal">{day.slice(5)}</span>,
                    summary: present.length
                      ? fmtPrice(present.reduce((a, b) => a + b, 0) / present.length)
                      : "—",
                    cells: cells.map((value) => ({
                      value,
                      color: divergingColor(value, calendar.centre, calendar.span),
                    })),
                  };
                })}
                describe={(day, column, value) =>
                  `${SEE_MARKETS[heatMarket!].short} · ${day} · ${HOURS[column]}:00 · ${
                    value === null
                      ? t("no observation", "nema podatka")
                      : `${fmtPrice(value)} €/MWh`
                  } · ${t("period mean", "prosek perioda")} ${fmtPrice(calendar.centre)}`
                }
              />
              {calendar.truncated && (
                <p className="text-[10.5px] text-muted-foreground">
                  {t(
                    "Showing the latest 35 days of the period.",
                    "Prikazano poslednjih 35 dana perioda.",
                  )}
                </p>
              )}
            </>
          )}
        </Panel>

        <Panel
          title={t("Hourly price correlation", "Satna korelacija cena")}
          subtitle={t("Pearson, matched hours only", "Pearson, samo upareni sati")}
        >
          {rows.filter((row) => row.stats.hours > 2).length < 2 ? (
            <DataState loading={loading} height={200}>
              {t(
                "Select at least two markets with data.",
                "Izaberite bar dva tržišta sa podacima.",
              )}
            </DataState>
          ) : (
            <HeatGrid
              compact
              labelEvery={1}
              formatCell={(value) => fmt(value, 2)}
              cellHeight={24}
              columns={rows.map((row) => SEE_MARKETS[row.code].short)}
              summaryHeader=""
              rows={rows.map((row) => ({
                id: row.code,
                label: SEE_MARKETS[row.code].short,
                cells: rows.map((other) => {
                  const value = row.code === other.code ? 1 : correlation(row.series, other.series);
                  return {
                    value,
                    color: sequentialColor(value === null ? null : Math.max(0, (value - 0.5) * 2)),
                  };
                }),
              }))}
              describe={(rowId, column, value) =>
                `${SEE_MARKETS[rowId as SeeCode].short} × ${SEE_MARKETS[rows[column].code].short}: ρ = ${fmt(value, 3)} (${t(
                  "colour scale 0.5 to 1",
                  "skala boja 0,5 do 1",
                )})`
              }
            />
          )}
        </Panel>
      </div>

      <Panel
        title={t("Period averages", "Proseci po periodima")}
        subtitle={t(
          "Hour-weighted baseload, €/MWh; hours in brackets",
          "Baseload ponderisan satima, €/MWh; sati u zagradi",
        )}
        actions={
          <Segmented
            size="xs"
            value={bucket}
            onChange={setBucket}
            options={[
              { value: "day", label: t("Day", "Dan") },
              { value: "week", label: t("Week", "Nedelja") },
              { value: "month", label: t("Month", "Mesec") },
              { value: "quarter", label: t("Quarter", "Kvartal") },
              { value: "year", label: t("Year", "Godina") },
            ]}
          />
        }
        flush
      >
        {buckets.keys.length === 0 ? (
          <DataState loading={loading} status={rows[0]?.status} height={100} />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>{t("Period", "Period")}</th>
                {rows.map((row) => (
                  <th key={row.code} className="!text-right">
                    {SEE_MARKETS[row.code].short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.keys.map((key) => (
                <tr key={key}>
                  <td className="num">{key}</td>
                  {buckets.perMarket.map((item) => {
                    const stat = item.stats.find((entry) => entry.key === key);
                    return (
                      <td key={item.code} className="num text-right">
                        {stat ? (
                          <>
                            {fmtPrice(stat.base)}{" "}
                            <span className="text-[10.5px] text-muted-foreground">
                              ({stat.hours})
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
