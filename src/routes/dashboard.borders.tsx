import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Download } from "lucide-react";

import { CategoryBars, TimeChart } from "@/components/cea/charts";
import { DataState, DataTable, Panel, ProvenanceBadge, Stat } from "@/components/cea/primitives";
import { WatchToggle } from "@/components/see/Inspector";
import { useDateRange } from "@/lib/date-range";
import { downloadCSV } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import {
  histogram,
  hourProfile,
  netFlow,
  routeEconomics,
  utilisation,
  mean,
} from "@/lib/see/analytics";
import { fmt, fmtMW, fmtShare, fmtSigned } from "@/lib/see/format";
import { SEE_BORDERS, SEE_MARKETS, type SeeCode } from "@/lib/see/registry";
import { useSelection } from "@/lib/see/selection";
import { hasData, worstState, type Provenance } from "@/lib/see/status";
import { useRegion } from "@/lib/see/use-region";
import { useBorderSeries, useSeeCapacity } from "@/lib/see/use-see-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/borders")({
  component: CrossBorder,
});

const PERIOD = { mode: "period" } as const;
const EXPLICIT_IDS = SEE_BORDERS.filter((border) => border.allocation === "explicit").map(
  (border) => border.id,
);

interface ScanRow {
  id: string;
  /** Route oriented from the cheaper to the dearer market over the period. */
  source: SeeCode;
  destination: SeeCode;
  allocation: "implicit" | "explicit";
  hvdc: boolean;
  hours: number;
  meanSpread: number | null;
  meanPositive: number | null;
  positiveShare: number | null;
  p10: number | null;
  p90: number | null;
  /** Mean physical flow along the route (negative: against it). */
  flowAlong: number | null;
  withSpread: number | null;
  splitShare: number | null;
  capacityPrice: number | null;
  net: number | null;
}

type SortKey = keyof Pick<
  ScanRow,
  | "meanSpread"
  | "meanPositive"
  | "positiveShare"
  | "flowAlong"
  | "withSpread"
  | "splitShare"
  | "capacityPrice"
  | "net"
>;

function CrossBorder() {
  const { t, lang } = useLang();
  const { range } = useDateRange();
  const { border: selected, selectBorder } = useSelection();
  const { region, prices, physical } = useRegion(PERIOD);
  const capacity = useSeeCapacity(EXPLICIT_IDS);
  const [otherCosts, setOtherCosts] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "meanPositive", dir: -1 });

  const rows = useMemo<ScanRow[]>(
    () =>
      SEE_BORDERS.map((border) => {
        const view = region.borders[border.id];
        const forward = (view.spreadStats.mean ?? 0) >= 0;
        const source = forward ? border.a : border.b;
        const destination = forward ? border.b : border.a;
        const auction = capacity.data[border.id];
        const capacityPrice = auction ? (forward ? auction.ab.price : auction.ba.price) : null;
        const econ = routeEconomics(
          region.markets[source].series,
          region.markets[destination].series,
          border.allocation === "explicit" ? capacityPrice : null,
          otherCosts,
        );
        const spreads = forward ? view.spread.v : view.spread.v.map((value) => -value);
        const sorted = [...spreads].sort((x, y) => x - y);
        const q = (p: number) =>
          sorted.length ? sorted[Math.round((sorted.length - 1) * p)] : null;
        const net = view.flow.meanNet;
        return {
          id: border.id,
          source,
          destination,
          allocation: border.allocation,
          hvdc: border.link === "HVDC",
          hours: econ.hours,
          meanSpread: econ.meanSpread,
          meanPositive: econ.meanPositiveSpread,
          positiveShare: econ.positiveShare,
          p10: q(0.1),
          p90: q(0.9),
          flowAlong: net === null ? null : forward ? net : -net,
          withSpread: view.alignment.withSpread,
          splitShare: view.spreadStats.splitShare,
          capacityPrice: border.allocation === "explicit" ? capacityPrice : null,
          net: econ.illustrativeNet,
        };
      }),
    [region, capacity.data, otherCosts],
  );

  const sorted = useMemo(() => {
    const value = (row: ScanRow) => row[sort.key];
    return [...rows].sort((x, y) => {
      const a = value(x);
      const b = value(y);
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (a - b) * sort.dir;
    });
  }, [rows, sort]);

  const activeId = selected ?? sorted.find((row) => row.hours > 0)?.id ?? "RS-HU";
  const active = region.borders[activeId];
  const a = SEE_MARKETS[active.border.a];
  const b = SEE_MARKETS[active.border.b];

  // Schedules and NTC are loaded only for the border being inspected.
  const scheduled = useBorderSeries("scheduled", [activeId]);
  const ntc = useBorderSeries("ntc", [activeId]);
  const sched = scheduled.data[activeId];
  const ntcData = ntc.data[activeId];
  const scheduledNet = useMemo(
    () => (sched ? netFlow(sched.ab, sched.ba) : { t: [], v: [] }),
    [sched],
  );
  const util = useMemo(
    () => (ntcData ? utilisation(active.net, ntcData.ab, ntcData.ba) : { t: [], v: [] }),
    [ntcData, active.net],
  );
  const bins = useMemo(() => histogram(active.spread.v, 24), [active.spread]);
  const profile = useMemo(() => hourProfile(active.spread), [active.spread]);
  const activeRow = rows.find((row) => row.id === activeId)!;
  const auction = capacity.data[activeId];

  const flowState = worstState(
    Object.values(region.borders)
      .flatMap((view) => [view.statusAB?.state, view.statusBA?.state])
      .filter(Boolean) as Provenance[],
  );
  const loading = prices.isLoading || physical.isLoading;
  const anyRow = rows.some((row) => row.hours > 0 || row.flowAlong !== null);

  const header = (key: SortKey, label: string, title: string) => (
    <th className="!text-right" title={title}>
      <button
        type="button"
        onClick={() =>
          setSort((prev) => ({ key, dir: prev.key === key ? (prev.dir === 1 ? -1 : 1) : -1 }))
        }
        className={cn(
          "inline-flex items-center gap-1 uppercase",
          sort.key === key && "text-foreground",
        )}
      >
        {label}
        {sort.key === key &&
          (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  const exportCsv = () =>
    downloadCSV(
      `cea-border-scan_${range.from}_${range.to}.csv`,
      sorted.map((row) => ({
        route: `${row.source}>${row.destination}`,
        allocation: row.allocation,
        matched_hours: row.hours,
        mean_spread_eur_mwh: row.meanSpread ?? "",
        mean_positive_spread_eur_mwh: row.meanPositive ?? "",
        share_hours_positive: row.positiveShare ?? "",
        p10_spread: row.p10 ?? "",
        p90_spread: row.p90 ?? "",
        mean_physical_flow_along_route_mw: row.flowAlong ?? "",
        share_hours_flow_with_spread: row.withSpread ?? "",
        share_hours_price_split: row.splitShare ?? "",
        daily_capacity_price_eur_mwh: row.capacityPrice ?? "",
        other_costs_eur_mwh: otherCosts,
        illustrative_net_eur_mwh: row.net ?? "",
      })),
    );

  return (
    <div className="grid gap-2 p-2">
      <Panel
        title={t("Border scanner", "Skener granica")}
        subtitle={t(
          "Each border oriented from the cheaper to the dearer market over the period. Click a row to inspect it.",
          "Svaka granica je orijentisana od jeftinijeg ka skupljem tržištu u periodu. Kliknite red za detalje.",
        )}
        status={<ProvenanceBadge state={loading ? null : flowState} />}
        actions={
          <>
            <label
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              title={t(
                "Your own estimate of fees, losses and other costs per MWh. Subtracted in the Illustrative net column.",
                "Vaša procena naknada, gubitaka i ostalih troškova po MWh. Oduzima se u koloni Ilustrativni neto.",
              )}
            >
              {t("Other costs", "Ostali troškovi")}
              <input
                type="number"
                min={0}
                step={0.1}
                value={otherCosts}
                onChange={(event) => setOtherCosts(Math.max(0, Number(event.target.value) || 0))}
                className="num h-6 w-16 rounded-sm border border-input bg-background px-1.5 text-right text-xs text-foreground"
              />
              €/MWh
            </label>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!anyRow}
              className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 text-xs text-ink-2 hover:border-border-strong hover:text-foreground disabled:opacity-40"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
          </>
        }
        flush
      >
        {!anyRow ? (
          <DataState
            loading={loading}
            state={flowState ?? "empty"}
            reason={
              Object.values(region.borders).find((view) => view.statusAB?.reason)?.statusAB?.reason
            }
            height={200}
          />
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <DataTable>
              <thead className="sticky top-0 z-[1] bg-surface">
                <tr>
                  <th>{t("Route", "Ruta")}</th>
                  <th>{t("Allocation", "Alokacija")}</th>
                  {header(
                    "meanSpread",
                    t("Mean spread", "Pros. spread"),
                    t("Mean of destination − source, €/MWh", "Prosek odredište − izvor, €/MWh"),
                  )}
                  {header(
                    "meanPositive",
                    t("Mean positive", "Pros. pozitivan"),
                    t(
                      "Mean of max(spread, 0): the value of capacity used only in profitable hours",
                      "Prosek max(spread, 0): vrednost kapaciteta korišćenog samo u profitabilnim satima",
                    ),
                  )}
                  {header(
                    "positiveShare",
                    t("Hours > 0", "Sati > 0"),
                    t("Share of hours with a positive spread", "Udeo sati sa pozitivnim spreadom"),
                  )}
                  <th
                    className="!text-right"
                    title={t(
                      "10th and 90th percentile of the hourly spread",
                      "10. i 90. percentil satnog spreada",
                    )}
                  >
                    P10 / P90
                  </th>
                  {header(
                    "flowAlong",
                    t("Phys. flow", "Fiz. tok"),
                    t(
                      "Mean physical flow along the route, MW; negative means against it",
                      "Prosečan fizički tok duž rute, MW; negativno znači suprotno",
                    ),
                  )}
                  {header(
                    "withSpread",
                    t("Flow w/ spread", "Tok uz spread"),
                    t(
                      "Share of hours the physical flow ran towards the dearer zone",
                      "Udeo sati kada je fizički tok išao ka skupljoj zoni",
                    ),
                  )}
                  {header(
                    "splitShare",
                    t("Split", "Razdvojeno"),
                    t(
                      "Share of hours with |spread| > 0.5 €/MWh",
                      "Udeo sati sa |spread| > 0,5 €/MWh",
                    ),
                  )}
                  {header(
                    "capacityPrice",
                    t("Cap. price", "Cena kap."),
                    t(
                      "Daily explicit auction price in the route direction, last day of the period",
                      "Cena dnevne eksplicitne aukcije u smeru rute, poslednji dan perioda",
                    ),
                  )}
                  {header(
                    "net",
                    t("Illustr. net", "Ilustr. neto"),
                    t(
                      "Mean positive spread − capacity price − other costs",
                      "Pros. pozitivan spread − cena kapaciteta − ostali troškovi",
                    ),
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => selectBorder(row.id)}
                    className={cn(
                      "cursor-pointer",
                      row.id === activeId && "bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]",
                    )}
                  >
                    <td className="whitespace-nowrap">
                      <span className="font-condensed text-xs font-semibold tracking-wide">
                        {SEE_MARKETS[row.source].short} → {SEE_MARKETS[row.destination].short}
                      </span>
                      {row.hvdc && (
                        <span className="ml-1.5 text-[10.5px] text-muted-foreground">HVDC</span>
                      )}
                    </td>
                    <td className="text-[11.5px] text-muted-foreground">
                      {row.allocation === "implicit"
                        ? t("coupled", "spojeno")
                        : t("explicit", "eksplicitno")}
                    </td>
                    <td className="num text-right">{fmt(row.meanSpread, 1)}</td>
                    <td className="num text-right">{fmt(row.meanPositive, 1)}</td>
                    <td className="num text-right">{fmtShare(row.positiveShare)}</td>
                    <td className="num text-right text-ink-2">
                      {row.p10 === null ? "—" : `${fmt(row.p10, 0)} / ${fmt(row.p90, 0)}`}
                    </td>
                    <td className="num text-right">{fmtSigned(row.flowAlong, 0)}</td>
                    <td className="num text-right">{fmtShare(row.withSpread)}</td>
                    <td className="num text-right">{fmtShare(row.splitShare)}</td>
                    <td className="num text-right">
                      {row.allocation === "implicit" ? (
                        <span
                          className="text-muted-foreground"
                          title={t(
                            "Allocated with the energy in market coupling",
                            "Dodeljuje se sa energijom kroz spajanje tržišta",
                          )}
                        >
                          n/a
                        </span>
                      ) : (
                        fmt(row.capacityPrice, 2)
                      )}
                    </td>
                    <td
                      className={cn(
                        "num text-right",
                        row.net !== null && row.net > 0 && "text-foreground",
                      )}
                    >
                      {fmtSigned(row.net, 1)}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <WatchToggle kind="borders" id={row.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
        <p className="border-t border-border px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {t(
            "Indicative spread = destination price − source price. Illustrative net = mean positive spread − daily capacity price − other costs. Not included: transmission losses, balancing exposure, nomination deadlines and curtailment, exchange and clearing fees you have not entered, long-term capacity already held, and the timing gap between capacity auctions and day-ahead gate closure. Historical spreads are not executable profit.",
            "Indikativni spread = cena odredišta − cena izvora. Ilustrativni neto = prosečan pozitivan spread − dnevna cena kapaciteta − ostali troškovi. Nije uključeno: gubici prenosa, balansna izloženost, rokovi nominacije i redukcije, berzanske i klirinške naknade koje niste uneli, već zakupljeni dugoročni kapacitet i vremenski razmak između aukcija kapaciteta i zatvaranja day-ahead tržišta. Istorijski spreadovi nisu ostvariv profit.",
          )}
        </p>
      </Panel>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title={
            <span className="text-foreground">
              {a.short} ⇄ {b.short} · {lang === "sr" ? a.nameSr : a.name} –{" "}
              {lang === "sr" ? b.nameSr : b.name}
            </span>
          }
          subtitle={[
            active.border.link,
            active.border.allocation === "implicit"
              ? t(
                  "implicit allocation in market coupling",
                  "implicitna alokacija kroz spajanje tržišta",
                )
              : t("explicit capacity auctions", "eksplicitne aukcije kapaciteta"),
            active.border.note,
          ]
            .filter(Boolean)
            .join(" · ")}
          status={active.statusAB ? <ProvenanceBadge status={active.statusAB} /> : undefined}
          actions={<WatchToggle kind="borders" id={activeId} />}
        >
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              <Stat
                label={t("Mean physical flow", "Prosečan fizički tok")}
                value={fmtMW(active.flow.meanNet === null ? null : Math.abs(active.flow.meanNet))}
                unit="MW"
                hint={
                  active.flow.meanNet === null
                    ? undefined
                    : active.flow.meanNet >= 0
                      ? `${a.short} → ${b.short}`
                      : `${b.short} → ${a.short}`
                }
              />
              <Stat
                label={t("Mean scheduled", "Prosečno planirano")}
                value={fmtMW(scheduledNet.v.length ? Math.abs(mean(scheduledNet.v)!) : null)}
                unit="MW"
                hint={
                  scheduledNet.v.length
                    ? mean(scheduledNet.v)! >= 0
                      ? `${a.short} → ${b.short}`
                      : `${b.short} → ${a.short}`
                    : t("commercial schedule", "komercijalni raspored")
                }
              />
              <Stat
                label={t("Mean utilisation", "Prosečna iskorišćenost")}
                value={fmtShare(util.v.length ? mean(util.v) : null)}
                hint={t("|physical| ÷ day-ahead NTC", "|fizički| ÷ day-ahead NTC")}
              />
              <Stat
                label={t("Mean spread", "Prosečan spread")}
                value={fmtSigned(active.spreadStats.mean, 1)}
                unit="€/MWh"
                hint={`${b.short} − ${a.short} · ${active.spreadStats.hours} h`}
              />
            </div>

            <div>
              <div className="eyebrow mb-1">
                {t("Net flow", "Neto tok")} {a.short}→{b.short} · MW ·{" "}
                {t(
                  "physical is measured, scheduled is commercial",
                  "fizički je izmeren, planirani je komercijalan",
                )}
              </div>
              {active.net.t.length === 0 && scheduledNet.t.length === 0 ? (
                <DataState
                  loading={physical.isLoading || scheduled.isLoading}
                  status={active.statusAB ?? undefined}
                  height={200}
                >
                  {active.statusAB && hasData(active.statusAB.state)
                    ? t(
                        "Both directions must be reported for an hour before a net flow is shown.",
                        "Oba smera moraju biti prijavljena da bi se prikazao neto tok.",
                      )
                    : undefined}
                </DataState>
              ) : (
                <TimeChart
                  height={210}
                  unit="MW"
                  digits={0}
                  zeroLine
                  brush
                  series={[
                    {
                      key: "physical",
                      label: t("Physical (measured)", "Fizički (izmeren)"),
                      color: "var(--series-3)",
                      data: active.net,
                    },
                    {
                      key: "scheduled",
                      label: t("Scheduled (commercial)", "Planiran (komercijalni)"),
                      color: "var(--series-7)",
                      data: scheduledNet,
                      dashed: true,
                    },
                    ...(ntcData && ntcData.ab.t.length
                      ? [
                          {
                            key: "ntcAB",
                            label: `NTC ${a.short}→${b.short}`,
                            color: "var(--muted-foreground)",
                            data: ntcData.ab,
                            kind: "step" as const,
                            muted: true,
                          },
                        ]
                      : []),
                    ...(ntcData && ntcData.ba.t.length
                      ? [
                          {
                            key: "ntcBA",
                            label: `NTC ${b.short}→${a.short} (−)`,
                            color: "var(--muted-foreground)",
                            data: { t: ntcData.ba.t, v: ntcData.ba.v.map((value) => -value) },
                            kind: "step" as const,
                            muted: true,
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              <div className="mt-1 flex flex-wrap gap-2">
                {sched && (
                  <span className="text-[10.5px] text-muted-foreground">
                    {t("Schedules", "Rasporedi")}: <ProvenanceBadge status={sched.statusAB} />
                  </span>
                )}
                {ntcData && (
                  <span className="text-[10.5px] text-muted-foreground">
                    NTC: <ProvenanceBadge status={ntcData.statusAB} />
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="eyebrow mb-1">
                {t("Day-ahead spread", "Day-ahead spread")} {b.short} − {a.short} · €/MWh
              </div>
              {active.spread.t.length === 0 ? (
                <DataState loading={prices.isLoading} height={150}>
                  {SEE_MARKETS[active.border.a].price === null ||
                  SEE_MARKETS[active.border.b].price === null
                    ? t(
                        "One side of this border has no day-ahead price, so no spread exists.",
                        "Jedna strana granice nema day-ahead cenu, pa spread ne postoji.",
                      )
                    : undefined}
                </DataState>
              ) : (
                <TimeChart
                  height={170}
                  unit="€/MWh"
                  zeroLine
                  legend={false}
                  series={[
                    {
                      key: "spread",
                      label: `${b.short} − ${a.short}`,
                      color: "var(--series-1)",
                      data: active.spread,
                    },
                  ]}
                />
              )}
            </div>
          </div>
        </Panel>

        <div className="grid content-start gap-2">
          <Panel
            title={t("Spread distribution", "Raspodela spreada")}
            subtitle={`${b.short} − ${a.short}, ${t("share of hours per €/MWh bin", "udeo sati po €/MWh intervalu")}`}
          >
            {bins.length === 0 ? (
              <DataState loading={prices.isLoading} height={170} compact />
            ) : (
              <CategoryBars
                height={170}
                unit="%"
                data={bins.map((bin) => ({ label: fmt(bin.from, 0), value: bin.share * 100 }))}
                describe={(label) => {
                  const bin = bins.find((item) => fmt(item.from, 0) === label);
                  return bin ? `${fmt(bin.from, 1)} … ${fmt(bin.to, 1)} €/MWh` : label;
                }}
              />
            )}
          </Panel>
          <Panel
            title={t("Spread by hour of day", "Spread po satu dana")}
            subtitle={`${t("Mean of", "Prosek")} ${b.short} − ${a.short}, €/MWh, ${t("market time", "tržišno vreme")}`}
          >
            {profile.every((value) => value === null) ? (
              <DataState loading={prices.isLoading} height={150} compact />
            ) : (
              <CategoryBars
                height={150}
                unit="€/MWh"
                signed
                data={profile.map((value, hour) => ({
                  label: String(hour).padStart(2, "0"),
                  value,
                }))}
                describe={(label) => `${label}:00–${String(Number(label) + 1).padStart(2, "0")}:00`}
              />
            )}
          </Panel>
          <Panel
            title={t("Route economics", "Ekonomika rute")}
            subtitle={`${SEE_MARKETS[activeRow.source].short} → ${SEE_MARKETS[activeRow.destination].short}`}
          >
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[12.5px]">
              <dt className="text-ink-2">
                {t("Mean positive spread", "Prosečan pozitivan spread")}
              </dt>
              <dd className="num text-right">{fmt(activeRow.meanPositive, 2)} €/MWh</dd>
              <dt className="text-ink-2">
                − {t("Daily capacity price", "Dnevna cena kapaciteta")}
                {active.border.allocation === "explicit" ? ` (${capacity.day})` : ""}
              </dt>
              <dd className="num text-right">
                {active.border.allocation === "implicit"
                  ? t("n/a (coupled)", "n/a (spojeno)")
                  : `${fmt(activeRow.capacityPrice, 2)} €/MWh`}
              </dd>
              <dt className="text-ink-2">
                − {t("Other costs (your input)", "Ostali troškovi (vaš unos)")}
              </dt>
              <dd className="num text-right">{fmt(otherCosts, 2)} €/MWh</dd>
              <dt className="border-t border-border pt-1 font-medium text-foreground">
                {t("Illustrative net spread", "Ilustrativni neto spread")}
              </dt>
              <dd className="num border-t border-border pt-1 text-right font-medium text-foreground">
                {activeRow.net === null ? "—" : `${fmtSigned(activeRow.net, 2)} €/MWh`}
              </dd>
            </dl>
            {active.border.allocation === "explicit" && auction && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("Auction", "Aukcija")} {a.short}→{b.short}: {fmt(auction.ab.price, 2)} €/MWh,{" "}
                {fmtMW(auction.ab.allocatedMW)}/{fmtMW(auction.ab.offeredMW)} MW · {b.short}→
                {a.short}: {fmt(auction.ba.price, 2)} €/MWh, {fmtMW(auction.ba.allocatedMW)}/
                {fmtMW(auction.ba.offeredMW)} MW <ProvenanceBadge status={auction.ab.status} />
              </p>
            )}
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              {active.border.allocation === "implicit"
                ? t(
                    "On a coupled border the spread is captured by the market coupling algorithm, not by a trader holding day-ahead capacity. It shows congestion, not a tradable margin.",
                    "Na spojenoj granici spread ostvaruje algoritam spajanja tržišta, a ne trgovac sa day-ahead kapacitetom. On pokazuje zagušenje, a ne trgovačku maržu.",
                  )
                : activeRow.net === null
                  ? t(
                      "A net figure needs a published daily auction price for this direction.",
                      "Neto vrednost zahteva objavljenu cenu dnevne aukcije za ovaj smer.",
                    )
                  : t(
                      "Capacity is the last day's auction price applied to the whole period's spreads: an illustration, not a backtest.",
                      "Kapacitet je cena aukcije poslednjeg dana primenjena na spreadove celog perioda: ilustracija, ne bektest.",
                    )}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
