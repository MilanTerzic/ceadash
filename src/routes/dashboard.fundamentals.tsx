import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { ScatterPlot, TimeChart, type ChartSeries } from "@/components/cea/charts";
import { DataState, DataTable, Panel, ProvenanceBadge, Stat } from "@/components/cea/primitives";
import { resShare } from "@/components/see/layers";
import { useLang } from "@/lib/i18n";
import { correlation, mean, seriesMap, type Series, EMPTY_SERIES } from "@/lib/see/analytics";
import { GEN_GROUPS, genGroup } from "@/lib/see/colors";
import { fmt, fmtMW, fmtPrice, fmtShare, fmtSigned } from "@/lib/see/format";
import { CORE_CODES, SEE_MARKETS, type SeeCode } from "@/lib/see/registry";
import type { MarketFundamentals } from "@/lib/see/see.functions";
import { useSelection } from "@/lib/see/selection";
import { useSeeFundamentalsMany, useSeePrices } from "@/lib/see/use-see-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/fundamentals")({
  component: Fundamentals,
});

function sumSeries(list: Series[]): Series {
  const acc = new Map<number, number>();
  for (const series of list) {
    for (let i = 0; i < series.t.length; i++)
      acc.set(series.t[i], (acc.get(series.t[i]) ?? 0) + series.v[i]);
  }
  const t = [...acc.keys()].sort((a, b) => a - b);
  return { t, v: t.map((hour) => acc.get(hour)!) };
}

/** a - b on hours present in both. */
function diff(a: Series, b: Series): Series {
  const other = seriesMap(b);
  const out: Series = { t: [], v: [] };
  for (let i = 0; i < a.t.length; i++) {
    const value = other.get(a.t[i]);
    if (value === undefined) continue;
    out.t.push(a.t[i]);
    out.v.push(a.v[i] - value);
  }
  return out;
}

function groupGeneration(fundamentals: MarketFundamentals | undefined) {
  const byGroup = new Map<string, Series[]>();
  for (const [type, series] of Object.entries(fundamentals?.generation ?? {})) {
    const key = genGroup(type);
    byGroup.set(key, [...(byGroup.get(key) ?? []), series]);
  }
  return GEN_GROUPS.filter((group) => byGroup.has(group.key))
    .map((group) => ({ ...group, series: sumSeries(byGroup.get(group.key)!) }))
    .filter((group) => group.series.t.length > 0);
}

function summarise(fundamentals: MarketFundamentals | undefined) {
  if (!fundamentals) return null;
  const groups = groupGeneration(fundamentals);
  const total = sumSeries(groups.map((group) => group.series));
  const res = sumSeries(
    groups
      .filter((group) => group.key === "wind" || group.key === "solar")
      .map((group) => group.series),
  );
  const implied = diff(fundamentals.load, total);
  return {
    groups,
    total,
    res,
    load: mean(fundamentals.load.v),
    peakLoad: fundamentals.load.v.length ? Math.max(...fundamentals.load.v) : null,
    generation: mean(total.v),
    resShare: resShare(fundamentals.generation, null),
    impliedImport: mean(implied.v),
    residual: res.t.length ? diff(fundamentals.load, res) : fundamentals.load,
  };
}

function Fundamentals() {
  const { t, lang } = useLang();
  const { market, selectMarket } = useSelection();
  const code: SeeCode = market && SEE_MARKETS[market].tier === "core" ? market : "RS";
  const all = useSeeFundamentalsMany(CORE_CODES, true);
  const prices = useSeePrices();
  const fundamentals = all.data[code];
  const summary = useMemo(() => summarise(fundamentals), [fundamentals]);
  const price = prices.data[code]?.series ?? EMPTY_SERIES;
  const loading = all.isLoading && !fundamentals;

  const mixSeries: ChartSeries[] = useMemo(
    () =>
      summary
        ? [
            ...summary.groups.map((group) => ({
              key: group.key,
              label: lang === "sr" ? group.sr : group.en,
              color: group.color,
              data: group.series,
              kind: "area" as const,
              stack: "gen",
            })),
            ...(fundamentals && fundamentals.load.t.length
              ? [
                  {
                    key: "load",
                    label: t("Load", "Potrošnja"),
                    color: "var(--foreground)",
                    data: fundamentals.load,
                  },
                ]
              : []),
          ]
        : [],
    [summary, fundamentals, lang, t],
  );

  const loadError = useMemo(() => {
    if (!fundamentals) return null;
    const error = diff(fundamentals.loadForecast, fundamentals.load);
    return {
      bias: mean(error.v),
      mae: mean(error.v.map(Math.abs)),
      hours: error.v.length,
    };
  }, [fundamentals]);

  const resForecast = useMemo(() => {
    const out: ChartSeries[] = [];
    if (!fundamentals || !summary) return out;
    const forecastBy = new Map<string, Series[]>();
    for (const [type, series] of Object.entries(fundamentals.resForecast)) {
      const key = genGroup(type);
      forecastBy.set(key, [...(forecastBy.get(key) ?? []), series]);
    }
    for (const key of ["solar", "wind"] as const) {
      const meta = GEN_GROUPS.find((group) => group.key === key)!;
      const actual = summary.groups.find((group) => group.key === key)?.series;
      if (actual?.t.length) {
        out.push({
          key: `${key}-a`,
          label: `${lang === "sr" ? meta.sr : meta.en} · ${t("actual", "ostvareno")}`,
          color: meta.color,
          data: actual,
        });
      }
      const forecast = forecastBy.get(key);
      if (forecast) {
        out.push({
          key: `${key}-f`,
          label: `${lang === "sr" ? meta.sr : meta.en} · ${t("day-ahead forecast", "day-ahead prognoza")}`,
          color: meta.color,
          data: sumSeries(forecast),
          dashed: true,
          muted: true,
        });
      }
    }
    return out;
  }, [fundamentals, summary, lang, t]);

  const scatter = useMemo(() => {
    if (!summary) return { points: [], rho: null as number | null };
    const priceMap = seriesMap(price);
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < summary.residual.t.length; i++) {
      const p = priceMap.get(summary.residual.t[i]);
      if (p !== undefined) points.push({ x: summary.residual.v[i], y: p });
    }
    return { points, rho: correlation(summary.residual, price) };
  }, [summary, price]);

  const table = useMemo(
    () =>
      CORE_CODES.map((item) => {
        const s = summarise(all.data[item]);
        return {
          code: item,
          summary: s,
          status: all.data[item]?.status,
          base: mean(prices.data[item]?.series.v ?? []),
        };
      }),
    [all.data, prices.data],
  );

  return (
    <div className="grid gap-2 p-2">
      <Panel flush>
        <div className="flex flex-wrap items-center gap-1 px-3 py-2">
          <span className="eyebrow mr-1">{t("Market", "Tržište")}</span>
          {CORE_CODES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={item === code}
              title={lang === "sr" ? SEE_MARKETS[item].nameSr : SEE_MARKETS[item].name}
              onClick={() => selectMarket(item)}
              className={cn(
                "h-6 rounded-sm border px-2.5 font-condensed text-xs font-semibold tracking-wide transition-colors",
                item === code
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {SEE_MARKETS[item].short}
            </button>
          ))}
          <Link
            to="/dashboard/outages"
            search={((prev: Record<string, unknown>) => prev) as never}
            className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t(
              "Serbia outages, weather and Danube levels",
              "Ispadi, vreme i vodostaj Dunava za Srbiju",
            )}{" "}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </Panel>

      <Panel
        title={`${lang === "sr" ? SEE_MARKETS[code].nameSr : SEE_MARKETS[code].name} · ${t("generation and load", "proizvodnja i potrošnja")}`}
        subtitle={t(
          "Actual generation by technology (stacked) with actual load, MW",
          "Ostvarena proizvodnja po tehnologiji (složeno) sa ostvarenom potrošnjom, MW",
        )}
        status={
          fundamentals ? <ProvenanceBadge status={fundamentals.status.generation} /> : undefined
        }
      >
        {!summary || (summary.groups.length === 0 && !fundamentals?.load.t.length) ? (
          <DataState loading={loading} status={fundamentals?.status.generation} height={320} />
        ) : (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat
                label={t("Mean load", "Prosečna potrošnja")}
                value={fmtMW(summary.load)}
                unit="MW"
              />
              <Stat
                label={t("Peak load", "Maks. potrošnja")}
                value={fmtMW(summary.peakLoad)}
                unit="MW"
              />
              <Stat
                label={t("Mean generation", "Prosečna proizvodnja")}
                value={fmtMW(summary.generation)}
                unit="MW"
              />
              <Stat
                label={t("Load − generation", "Potrošnja − proizvodnja")}
                value={fmtSigned(summary.impliedImport, 0)}
                unit="MW"
                hint={t(
                  "implied net import; ignores pumping and losses",
                  "implicirani neto uvoz; bez pumpanja i gubitaka",
                )}
              />
              <Stat
                label={t("Wind + solar share", "Udeo vetra i sunca")}
                value={fmtShare(summary.resShare, 1)}
                hint={t("of reported generation", "prijavljene proizvodnje")}
              />
              <Stat
                label={t("Mean residual load", "Prosečno rezidualno opterećenje")}
                value={fmtMW(mean(summary.residual.v))}
                unit="MW"
                hint={t("load − wind − solar", "potrošnja − vetar − sunce")}
              />
            </div>
            <TimeChart series={mixSeries} unit="MW" digits={0} height={300} brush />
          </div>
        )}
      </Panel>

      <div className="grid gap-2 xl:grid-cols-2">
        <Panel
          title={t(
            "Load: actual versus day-ahead forecast",
            "Potrošnja: ostvareno i day-ahead prognoza",
          )}
          subtitle={
            loadError && loadError.hours > 0
              ? `${t("Forecast − actual", "Prognoza − ostvareno")}: ${t("bias", "pristrasnost")} ${fmtSigned(loadError.bias, 0)} MW · MAE ${fmtMW(loadError.mae)} MW · ${loadError.hours} h`
              : "MW"
          }
          status={
            fundamentals ? <ProvenanceBadge status={fundamentals.status.loadForecast} /> : undefined
          }
        >
          {!fundamentals ||
          (fundamentals.load.t.length === 0 && fundamentals.loadForecast.t.length === 0) ? (
            <DataState loading={loading} status={fundamentals?.status.load} height={220} />
          ) : (
            <TimeChart
              height={220}
              unit="MW"
              digits={0}
              series={[
                {
                  key: "load",
                  label: t("Actual", "Ostvareno"),
                  color: "var(--series-1)",
                  data: fundamentals.load,
                },
                {
                  key: "forecast",
                  label: t("Day-ahead forecast", "Day-ahead prognoza"),
                  color: "var(--series-2)",
                  data: fundamentals.loadForecast,
                  dashed: true,
                },
              ]}
            />
          )}
        </Panel>
        <Panel
          title={t(
            "Wind and solar: actual versus day-ahead forecast",
            "Vetar i sunce: ostvareno i day-ahead prognoza",
          )}
          subtitle="MW"
          status={
            fundamentals ? <ProvenanceBadge status={fundamentals.status.resForecast} /> : undefined
          }
        >
          {resForecast.length === 0 ? (
            <DataState loading={loading} status={fundamentals?.status.resForecast} height={220}>
              {fundamentals && fundamentals.status.resForecast.state !== "unavailable"
                ? t(
                    "No wind or solar generation or forecast is published for this market.",
                    "Za ovo tržište nije objavljena proizvodnja ni prognoza vetra i sunca.",
                  )
                : undefined}
            </DataState>
          ) : (
            <TimeChart height={220} unit="MW" digits={0} series={resForecast} />
          )}
        </Panel>
      </div>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel
          title={t("Price versus residual load", "Cena i rezidualno opterećenje")}
          subtitle={
            scatter.rho === null
              ? t("Each dot is one hour", "Svaka tačka je jedan sat")
              : `${t("Each dot is one hour", "Svaka tačka je jedan sat")} · ${t("correlation", "korelacija")} ${fmt(scatter.rho, 2)} · ${scatter.points.length} h`
          }
        >
          {scatter.points.length < 12 ? (
            <DataState
              loading={loading || prices.isLoading}
              status={fundamentals?.status.load}
              height={240}
            >
              {fundamentals && price.t.length === 0 && SEE_MARKETS[code].price === null
                ? t("This market has no day-ahead price.", "Ovo tržište nema day-ahead cenu.")
                : undefined}
            </DataState>
          ) : (
            <>
              <ScatterPlot
                points={scatter.points}
                xLabel={t("Residual load", "Rezidualno opterećenje")}
                yLabel={t("Day-ahead price", "Day-ahead cena")}
                xUnit="MW"
                yUnit="€/MWh"
              />
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {t(
                  "Residual load is what dispatchable plant and imports must cover. A tight, rising cloud means domestic fundamentals set the price; a loose one means imports, coupling or hydro do.",
                  "Rezidualno opterećenje je ono što moraju pokriti upravljive elektrane i uvoz. Zbijen, rastući oblak znači da domaći fundamenti određuju cenu; raspršen znači da to čine uvoz, spajanje tržišta ili hidro.",
                )}
              </p>
            </>
          )}
        </Panel>

        <Panel
          title={t("Regional comparison", "Regionalno poređenje")}
          subtitle={t(
            "Period means. Click a row to open the market.",
            "Proseci perioda. Kliknite red da otvorite tržište.",
          )}
          flush
        >
          <DataTable>
            <thead>
              <tr>
                <th>{t("Market", "Tržište")}</th>
                <th className="!text-right">{t("Load MW", "Potrošnja MW")}</th>
                <th className="!text-right">{t("Generation MW", "Proizvodnja MW")}</th>
                <th
                  className="!text-right"
                  title={t(
                    "Load − generation; positive is an implied net import",
                    "Potrošnja − proizvodnja; pozitivno je implicirani neto uvoz",
                  )}
                >
                  {t("Load − gen", "Potr. − proizv.")}
                </th>
                <th className="!text-right">{t("Wind+solar", "Vetar+sunce")}</th>
                <th className="!text-right">Base €/MWh</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr
                  key={row.code}
                  onClick={() => selectMarket(row.code)}
                  className={cn(
                    "cursor-pointer",
                    row.code === code && "bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]",
                  )}
                >
                  <td>
                    <span className="font-condensed text-xs font-semibold tracking-wide">
                      {SEE_MARKETS[row.code].short}
                    </span>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {SEE_MARKETS[row.code].tso}
                    </span>
                  </td>
                  <td className="num text-right">{fmtMW(row.summary?.load ?? null)}</td>
                  <td className="num text-right">{fmtMW(row.summary?.generation ?? null)}</td>
                  <td className="num text-right">
                    {fmtSigned(row.summary?.impliedImport ?? null, 0)}
                  </td>
                  <td className="num text-right">{fmtShare(row.summary?.resShare ?? null, 1)}</td>
                  <td className="num text-right">{fmtPrice(row.base)}</td>
                  <td className="text-right">
                    {row.status && <ProvenanceBadge status={row.status.generation} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </div>
  );
}
