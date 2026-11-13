import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Star, X } from "lucide-react";

import { Spark, TimeChart } from "@/components/cea/charts";
import {
  DataState,
  DataTable,
  Delta,
  IconButton,
  LegendDot,
  Panel,
  ProvenanceBadge,
  Segmented,
  Stat,
} from "@/components/cea/primitives";
import { useLang } from "@/lib/i18n";
import { dailyStats, mean, type Series } from "@/lib/see/analytics";
import { GEN_GROUPS, genGroup } from "@/lib/see/colors";
import { fmt, fmtMW, fmtPrice, fmtShare, fmtSigned } from "@/lib/see/format";
import { computeSignals, focusSeries, type Region } from "@/lib/see/region";
import { CORE_CODES, SEE_CODES, SEE_MARKETS, bordersOf, type SeeCode } from "@/lib/see/registry";
import type { CapacityAuction } from "@/lib/see/see.functions";
import { useSelection } from "@/lib/see/selection";
import { hasData } from "@/lib/see/status";
import { usePersistent } from "@/lib/see/store";
import { useSeeFundamentals } from "@/lib/see/use-see-data";
import { cn } from "@/lib/utils";

const NO_LIST: string[] = [];
const keepSearch = ((prev: Record<string, unknown>) => prev) as never;

export function WatchToggle({ kind, id }: { kind: "markets" | "borders"; id: string }) {
  const { t } = useLang();
  const [list, setList] = usePersistent<string[]>(`watch.${kind}`, NO_LIST);
  const on = list.includes(id);
  return (
    <IconButton
      label={
        on
          ? t("Remove from watchlist", "Ukloni iz praćenja")
          : t("Add to watchlist", "Dodaj u praćenje")
      }
      active={on}
      onClick={() =>
        setList((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      }
    >
      <Star className={cn("h-3.5 w-3.5", on && "fill-brand text-brand")} />
    </IconButton>
  );
}

function OpenLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      search={keepSearch}
      className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border px-2 text-xs text-ink-2 transition-colors hover:border-border-strong hover:text-foreground"
    >
      {children}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

/** Default inspector: the regional picture in one column. */
export function RegionBrief({ region, loading }: { region: Region; loading: boolean }) {
  const { t, lang } = useLang();
  const { selectMarket, selectBorder } = useSelection();
  const signals = useMemo(() => computeSignals(region), [region]);
  const rows = SEE_CODES.filter((code) => SEE_MARKETS[code].price !== null)
    .map((code) => region.markets[code])
    .sort((a, b) => (b.stats.base ?? -Infinity) - (a.stats.base ?? -Infinity));
  const anyPrice = rows.some((row) => row.stats.base !== null);
  const coreNeg = CORE_CODES.reduce(
    (sum, code) => sum + region.markets[code].stats.negativeHours,
    0,
  );
  const [tab, setTab] = useState<"signals" | "markets">("signals");
  const coreBases = rows
    .filter((row) => SEE_MARKETS[row.code].tier === "core" && row.stats.base !== null)
    .map((row) => row.stats.base!);
  const spreadRange =
    coreBases.length >= 2 ? Math.max(...coreBases) - Math.min(...coreBases) : null;

  return (
    <Panel
      title={t("Regional brief", "Regionalni pregled")}
      subtitle={
        region.focus.mode === "day"
          ? t("Selected delivery day", "Izabrani dan isporuke")
          : t("Selected period", "Izabrani period")
      }
      actions={
        <Segmented
          size="xs"
          value={tab}
          onChange={setTab}
          options={[
            { value: "signals", label: t("Signals", "Signali") },
            { value: "markets", label: t("Markets", "Tržišta") },
          ]}
        />
      }
      className="h-full"
      bodyClassName="overflow-y-auto"
      flush
    >
      {!anyPrice ? (
        <DataState loading={loading} status={rows[0]?.status ?? undefined} height={240} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 border-b border-border p-3">
            <Stat
              label={t("Regional base", "Regionalni base")}
              value={fmtPrice(region.regionalBase)}
              unit="€/MWh"
            />
            <Stat
              label={t("Range", "Raspon")}
              value={fmt(spreadRange, 1)}
              unit="€/MWh"
              hint={t("dearest − cheapest core", "najskuplje − najjeftinije")}
            />
            <Stat
              label={t("Negative hours", "Negativni sati")}
              value={fmt(coreNeg, 0)}
              hint={t("sum over core markets", "zbir za glavna tržišta")}
            />
          </div>

          {tab === "signals" && (
            <div className="p-3">
              <div className="eyebrow mb-1.5">{t("Computed signals", "Izračunati signali")}</div>
              {signals.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("No rule triggered for this selection.", "Nijedno pravilo nije aktivirano.")}
                </p>
              ) : (
                <ul className="grid gap-1">
                  {signals.map((signal) => (
                    <li key={signal.id}>
                      <button
                        type="button"
                        onClick={() =>
                          signal.border
                            ? selectBorder(signal.border)
                            : signal.market
                              ? selectMarket(signal.market)
                              : null
                        }
                        className="flex w-full items-start gap-2 rounded-sm px-1.5 py-1 text-left text-xs leading-snug text-ink-2 transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                            signal.level === "watch" ? "bg-warning" : "bg-border-strong",
                          )}
                        />
                        {lang === "sr" ? signal.sr : signal.en}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
                {t(
                  "Rule-based statements computed from the loaded observations. Not forecasts or advice.",
                  "Izjave zasnovane na pravilima, izračunate iz učitanih podataka. Nisu prognoze ni saveti.",
                )}
              </p>
            </div>
          )}

          {tab === "markets" && (
            <DataTable>
              <thead>
                <tr>
                  <th>{t("Market", "Tržište")}</th>
                  <th className="!text-right">Base</th>
                  <th
                    className="!text-right"
                    title={t("Base minus regional mean", "Base minus regionalni prosek")}
                  >
                    {t("vs region", "vs region")}
                  </th>
                  <th className="!text-right">Peak</th>
                  <th className="!text-right" title={t("Hours below zero", "Sati ispod nule")}>
                    &lt;0 h
                  </th>
                  <th>{t("Daily", "Dnevno")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const market = SEE_MARKETS[row.code];
                  const days = dailyStats(row.series).map((day) => day.base);
                  return (
                    <tr
                      key={row.code}
                      className="cursor-pointer"
                      onClick={() => selectMarket(row.code)}
                    >
                      <td>
                        <span className="font-condensed text-xs font-semibold tracking-wide">
                          {market.short}
                        </span>
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {market.exchange}
                        </span>
                      </td>
                      <td className="num text-right">{fmtPrice(row.stats.base)}</td>
                      <td className="text-right">
                        {row.stats.base !== null && region.regionalBase !== null ? (
                          <Delta value={row.stats.base - region.regionalBase} className="text-xs" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="num text-right">{fmtPrice(row.stats.peak)}</td>
                      <td className="num text-right">
                        {row.stats.hours ? row.stats.negativeHours : "—"}
                      </td>
                      <td>
                        {days.length > 1 ? (
                          <Spark values={days} />
                        ) : (
                          <Spark values={row.series.v} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </>
      )}
    </Panel>
  );
}

function sumSeries(list: Series[]): Series {
  const acc = new Map<number, number>();
  for (const series of list) {
    for (let i = 0; i < series.t.length; i++)
      acc.set(series.t[i], (acc.get(series.t[i]) ?? 0) + series.v[i]);
  }
  const t = [...acc.keys()].sort((a, b) => a - b);
  return { t, v: t.map((hour) => acc.get(hour)!) };
}

/** Generation by group, load and day-ahead forecasts for one market. */
export function FundamentalsBlock({
  code,
  region,
  height = 150,
}: {
  code: SeeCode;
  region: Region;
  height?: number;
}) {
  const { t, lang } = useLang();
  const query = useSeeFundamentals(code);
  const fundamentals = query.data?.fundamentals;
  const groups = useMemo(() => {
    if (!fundamentals) return [];
    const byGroup = new Map<string, Series[]>();
    for (const [type, series] of Object.entries(fundamentals.generation)) {
      const key = genGroup(type);
      byGroup.set(key, [...(byGroup.get(key) ?? []), focusSeries(series, region.focus)]);
    }
    return GEN_GROUPS.filter((group) => byGroup.has(group.key))
      .map((group) => ({ ...group, series: sumSeries(byGroup.get(group.key)!) }))
      .filter((group) => group.series.t.length > 0);
  }, [fundamentals, region.focus]);

  if (query.isLoading) return <DataState loading height={height} compact />;
  if (query.isError || !fundamentals) return <DataState state="error" height={height} compact />;

  const load = focusSeries(fundamentals.load, region.focus);
  const loadFc = focusSeries(fundamentals.loadForecast, region.focus);
  const total = groups.reduce((sum, group) => sum + (mean(group.series.v) ?? 0), 0);

  return (
    <div className="grid gap-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="eyebrow">{t("Generation mix", "Miks proizvodnje")} · MW</span>
          <ProvenanceBadge status={fundamentals.status.generation} />
        </div>
        {groups.length === 0 ? (
          <DataState status={fundamentals.status.generation} height={70} compact />
        ) : (
          <>
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-[2px]">
              {groups.map((group) => (
                <div
                  key={group.key}
                  title={`${lang === "sr" ? group.sr : group.en}: ${fmtMW(mean(group.series.v))} MW`}
                  style={{
                    background: group.color,
                    width: `${((mean(group.series.v) ?? 0) / (total || 1)) * 100}%`,
                  }}
                />
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              {groups.map((group) => (
                <div key={group.key} className="flex items-center justify-between gap-2">
                  <LegendDot color={group.color} label={lang === "sr" ? group.sr : group.en} />
                  <span className="num text-[11.5px] text-foreground">
                    {fmtMW(mean(group.series.v))}{" "}
                    <span className="text-muted-foreground">
                      {fmtShare(total ? (mean(group.series.v) ?? 0) / total : null)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="eyebrow">
            {t("Load vs day-ahead forecast", "Potrošnja i day-ahead prognoza")} · MW
          </span>
          <ProvenanceBadge status={fundamentals.status.load} />
        </div>
        {load.t.length === 0 && loadFc.t.length === 0 ? (
          <DataState status={fundamentals.status.load} height={70} compact />
        ) : (
          <TimeChart
            height={height}
            unit="MW"
            digits={0}
            series={[
              {
                key: "load",
                label: t("Actual load", "Ostvarena potrošnja"),
                color: "var(--series-1)",
                data: load,
              },
              {
                key: "fc",
                label: t("Day-ahead forecast", "Day-ahead prognoza"),
                color: "var(--series-2)",
                data: loadFc,
                dashed: true,
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

export function MarketInspector({ code, region }: { code: SeeCode; region: Region }) {
  const { t, lang } = useLang();
  const { selectMarket, selectBorder, reference } = useSelection();
  const market = SEE_MARKETS[code];
  const view = region.markets[code];
  const refCode = reference === code ? null : reference;
  const refView = refCode ? region.markets[refCode] : null;
  const borders = bordersOf(code);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className="text-foreground">{lang === "sr" ? market.nameSr : market.name}</span>
          <span className="num text-muted-foreground">{market.short}</span>
        </span>
      }
      subtitle={[
        market.exchange ?? t("no day-ahead market", "bez day-ahead tržišta"),
        `TSO ${market.tso}`,
        market.coupling === "SDAC"
          ? "SDAC"
          : market.coupling === "regional"
            ? t("regionally coupled", "regionalno spojeno")
            : market.coupling === "isolated"
              ? t("not coupled", "nije spojeno")
              : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      status={view.status ? <ProvenanceBadge status={view.status} /> : undefined}
      actions={
        <>
          <WatchToggle kind="markets" id={code} />
          <IconButton label={t("Close", "Zatvori")} onClick={() => selectMarket(null)}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </>
      }
      className="h-full"
      bodyClassName="overflow-y-auto"
    >
      <div className="grid gap-3">
        {market.note && (
          <p className="text-[11.5px] leading-snug text-muted-foreground">{market.note}</p>
        )}
        {market.price === null ? null : view.stats.hours === 0 ? (
          <DataState status={view.status ?? undefined} height={120} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
              <Stat
                label="Base"
                value={fmtPrice(view.stats.base)}
                unit="€/MWh"
                delta={
                  region.regionalBase !== null && view.stats.base !== null ? (
                    <Delta value={view.stats.base - region.regionalBase} className="text-[11px]" />
                  ) : undefined
                }
                hint={t("Δ vs regional mean", "Δ vs regionalni prosek")}
              />
              <Stat
                label="Peak"
                value={fmtPrice(view.stats.peak)}
                hint={t("Mon–Fri 08–20", "pon–pet 08–20")}
              />
              <Stat label="Off-peak" value={fmtPrice(view.stats.offPeak)} />
              <Stat
                label={t("Min / max", "Min / maks")}
                value={`${fmt(view.stats.min, 0)} / ${fmt(view.stats.max, 0)}`}
              />
              <Stat
                label={t("Hourly std dev", "Satna std. dev.")}
                value={fmt(view.stats.volatility, 1)}
                hint={t("std. dev. of hourly prices", "std. dev. satnih cena")}
              />
              <Stat
                label={t("Negative h", "Negativni h")}
                value={fmt(view.stats.negativeHours, 0)}
              />
            </div>
            <TimeChart
              height={170}
              unit="€/MWh"
              zeroLine={(view.stats.min ?? 0) < 0}
              series={[
                { key: code, label: market.short, color: "var(--series-1)", data: view.series },
                ...(refView && refView.series.t.length
                  ? [
                      {
                        key: refCode!,
                        label: `${SEE_MARKETS[refCode!].short} (${t("reference", "referenca")})`,
                        color: "var(--series-2)",
                        data: refView.series,
                        muted: true,
                      },
                    ]
                  : []),
              ]}
            />
          </>
        )}

        <div>
          <div className="eyebrow mb-1">{t("Borders", "Granice")}</div>
          <DataTable>
            <thead>
              <tr>
                <th>{t("Neighbour", "Sused")}</th>
                <th
                  className="!text-right"
                  title={t(
                    "Mean physical net flow into this market",
                    "Prosečan fizički neto tok u ovo tržište",
                  )}
                >
                  {t("Net in, MW", "Neto ulaz, MW")}
                </th>
                <th
                  className="!text-right"
                  title={t("Neighbour price minus this market", "Cena suseda minus ovo tržište")}
                >
                  {t("Spread", "Spread")}
                </th>
              </tr>
            </thead>
            <tbody>
              {borders.map((border) => {
                const other = border.a === code ? border.b : border.a;
                const borderView = region.borders[border.id];
                const net = borderView.flow.meanNet;
                const inflow = net === null ? null : border.b === code ? net : -net;
                const s = borderView.spreadStats.mean;
                const spread = s === null ? null : border.a === code ? s : -s;
                return (
                  <tr
                    key={border.id}
                    className="cursor-pointer"
                    onClick={() => selectBorder(border.id)}
                  >
                    <td>
                      <span className="font-condensed text-xs font-semibold tracking-wide">
                        {SEE_MARKETS[other].short}
                      </span>
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        {border.allocation === "implicit"
                          ? t("coupled", "spojeno")
                          : t("explicit", "eksplicitno")}
                        {border.link === "HVDC" ? " · HVDC" : ""}
                      </span>
                    </td>
                    <td className="num text-right">{fmtSigned(inflow, 0)}</td>
                    <td className="text-right">
                      {spread === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Delta value={spread} className="text-xs" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {view.netImport !== null
              ? `${t("Net position", "Neto pozicija")}: ${fmtSigned(view.netImport, 0)} MW (${view.netImport >= 0 ? t("importing", "uvoz") : t("exporting", "izvoz")})`
              : `${t("Net position not shown", "Neto pozicija nije prikazana")}: ${view.bordersCovered}/${view.bordersTotal} ${t("borders reported", "granica izvestilo")}`}
          </p>
        </div>

        <FundamentalsBlock code={code} region={region} />

        <div className="flex flex-wrap gap-1.5">
          <OpenLink to="/dashboard/prices">{t("Price analytics", "Analitika cena")}</OpenLink>
          <OpenLink to="/dashboard/fundamentals">{t("Fundamentals", "Fundamenti")}</OpenLink>
        </div>
      </div>
    </Panel>
  );
}

export function BorderInspector({
  id,
  region,
  capacity,
  capacityDay,
}: {
  id: string;
  region: Region;
  capacity?: { ab: CapacityAuction; ba: CapacityAuction };
  capacityDay?: string;
}) {
  const { t } = useLang();
  const { selectBorder } = useSelection();
  const view = region.borders[id];
  const { border } = view;
  const a = SEE_MARKETS[border.a];
  const b = SEE_MARKETS[border.b];
  const net = view.flow.meanNet;
  const flowsTo = net === null ? null : net >= 0 ? b.short : a.short;
  const flowsFrom = net === null ? null : net >= 0 ? a.short : b.short;
  const s = view.spreadStats.mean;
  const status =
    view.statusAB && hasData(view.statusAB.state)
      ? view.statusAB
      : (view.statusBA ?? view.statusAB);

  return (
    <Panel
      title={
        <span className="text-foreground">
          {a.short} ⇄ {b.short}
        </span>
      }
      subtitle={[
        `${a.name} – ${b.name}`,
        border.link === "HVDC" ? "HVDC" : "AC",
        border.allocation === "implicit"
          ? t("implicit allocation (coupled)", "implicitna alokacija (spojeno)")
          : t("explicit capacity auctions", "eksplicitne aukcije kapaciteta"),
      ].join(" · ")}
      status={status ? <ProvenanceBadge status={status} /> : undefined}
      actions={
        <>
          <WatchToggle kind="borders" id={id} />
          <IconButton label={t("Close", "Zatvori")} onClick={() => selectBorder(null)}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </>
      }
      className="h-full"
      bodyClassName="overflow-y-auto"
    >
      <div className="grid gap-3">
        {border.note && <p className="text-[11.5px] text-muted-foreground">{border.note}</p>}
        <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
          <Stat
            label={t("Mean physical flow", "Prosečan fizički tok")}
            value={fmtMW(net === null ? null : Math.abs(net))}
            unit="MW"
            hint={flowsTo ? `${flowsFrom} → ${flowsTo}` : undefined}
          />
          <Stat
            label={`${t("Hours", "Sati")} ${a.short}→${b.short}`}
            value={fmtShare(view.flow.shareAtoB)}
            hint={`${view.flow.hours} h ${t("with both directions", "sa oba smera")}`}
          />
          <Stat
            label={t("Peak flow", "Maks. tok")}
            value={`${fmtMW(view.flow.maxAtoB)} / ${fmtMW(view.flow.maxBtoA)}`}
            hint={`${a.short}→${b.short} / ${b.short}→${a.short}`}
          />
          <Stat
            label={t("Mean spread", "Prosečan spread")}
            value={fmtSigned(s, 1)}
            unit="€/MWh"
            hint={`${b.short} − ${a.short}`}
          />
          <Stat
            label={t("Prices split", "Cene razdvojene")}
            value={fmtShare(view.spreadStats.splitShare)}
            hint={t("hours with |spread| > 0.5", "sati sa |spread| > 0,5")}
          />
          <Stat
            label={t("Flow vs spread", "Tok vs spread")}
            value={fmtShare(view.alignment.againstSpread)}
            hint={t("hours towards cheaper zone", "sati ka jeftinijoj zoni")}
          />
        </div>

        {view.net.t.length === 0 ? (
          <DataState status={status ?? undefined} height={110}>
            {status && hasData(status.state)
              ? t(
                  "Both directions must be reported for an hour before a net flow is shown.",
                  "Oba smera moraju biti prijavljena da bi se prikazao neto tok.",
                )
              : undefined}
          </DataState>
        ) : (
          <div>
            <div className="eyebrow mb-1">
              {t("Physical net flow", "Fizički neto tok")} {a.short}→{b.short} · MW
            </div>
            <TimeChart
              height={130}
              unit="MW"
              digits={0}
              zeroLine
              legend={false}
              series={[
                {
                  key: "net",
                  label: `${a.short}→${b.short}`,
                  color: "var(--series-3)",
                  data: view.net,
                  kind: "area",
                },
              ]}
            />
          </div>
        )}

        {view.spread.t.length > 0 && (
          <div>
            <div className="eyebrow mb-1">
              {t("Day-ahead spread", "Day-ahead spread")} {b.short} − {a.short} · €/MWh
            </div>
            <TimeChart
              height={130}
              unit="€/MWh"
              zeroLine
              legend={false}
              series={[
                {
                  key: "spread",
                  label: `${b.short} − ${a.short}`,
                  color: "var(--series-1)",
                  data: view.spread,
                },
              ]}
            />
          </div>
        )}

        <div className="rounded-sm border border-border p-2.5">
          <div className="eyebrow mb-1.5">{t("Capacity", "Kapacitet")}</div>
          {border.allocation === "implicit" ? (
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              {t(
                "Day-ahead capacity on this border is allocated implicitly inside market coupling, so there is no separate capacity price. A price split between the two zones means the border was binding.",
                "Day-ahead kapacitet na ovoj granici se dodeljuje implicitno kroz spajanje tržišta, pa ne postoji posebna cena kapaciteta. Razdvajanje cena znači da je granica bila ograničavajuća.",
              )}
            </p>
          ) : !capacity ? (
            <DataState loading height={50} compact />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>
                    {t("Daily auction", "Dnevna aukcija")}
                    {capacityDay ? ` · ${capacityDay}` : ""}
                  </th>
                  <th className="!text-right">€/MWh</th>
                  <th className="!text-right">{t("Offered MW", "Ponuđeno MW")}</th>
                  <th className="!text-right">{t("Allocated MW", "Dodeljeno MW")}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [`${a.short} → ${b.short}`, capacity.ab],
                    [`${b.short} → ${a.short}`, capacity.ba],
                  ] as const
                ).map(([label, row]) => (
                  <tr key={label}>
                    <td className="num">{label}</td>
                    <td className="num text-right">{fmt(row.price, 2)}</td>
                    <td className="num text-right">{fmtMW(row.offeredMW)}</td>
                    <td className="num text-right">{fmtMW(row.allocatedMW)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {view.meanUtilisation !== null && (
            <p className="mt-1.5 text-[11.5px] text-ink-2">
              {t("Mean utilisation of day-ahead NTC", "Prosečna iskorišćenost day-ahead NTC")}:{" "}
              <span className="num text-foreground">{fmtShare(view.meanUtilisation)}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <OpenLink to="/dashboard/borders">
            {t("Cross-border workspace", "Prekogranični radni prostor")}
          </OpenLink>
        </div>
      </div>
    </Panel>
  );
}
