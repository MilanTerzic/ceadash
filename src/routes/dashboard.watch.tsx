import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BellRing, Download, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Spark } from "@/components/cea/charts";
import {
  DataState,
  DataTable,
  Delta,
  NumField,
  Panel,
  ProvenanceBadge,
  Segmented,
} from "@/components/cea/primitives";
import { useLang } from "@/lib/i18n";
import { describeAlert, evaluateAlert, sanitizeRules, type AlertRule } from "@/lib/see/alerts";
import { dailyStats } from "@/lib/see/analytics";
import { fmt, fmtDay, fmtMW, fmtPrice, fmtShare, fmtSigned } from "@/lib/see/format";
import type { Focus } from "@/lib/see/region";
import {
  PRICED_CODES,
  SEE_BORDERS,
  SEE_MARKETS,
  SPREAD_BORDERS,
  isSeeCode,
  type SeeCode,
} from "@/lib/see/registry";
import { useSelection } from "@/lib/see/selection";
import { exportStore, importStore, usePersistent } from "@/lib/see/store";
import { useRegion } from "@/lib/see/use-region";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/watch")({
  component: Watch,
});

const NO_LIST: string[] = [];
const NO_RULES: AlertRule[] = [];
type Kind = AlertRule["kind"];

const STATE_STYLE = {
  triggered: "border-warning/60 bg-warning/10 text-warning",
  clear: "border-border-strong text-ink-2",
  nodata: "border-border text-muted-foreground",
} as const;

function Watch() {
  const { t, lang } = useLang();
  const { selectMarket, selectBorder } = useSelection();
  const [markets, setMarkets] = usePersistent<string[]>("watch.markets", NO_LIST);
  const [borders, setBorders] = usePersistent<string[]>("watch.borders", NO_LIST);
  const [storedRules, setRules] = usePersistent<AlertRule[]>("alerts", NO_RULES);
  const rules = useMemo(() => sanitizeRules(storedRules), [storedRules]);
  const fileRef = useRef<HTMLInputElement>(null);

  // First pass over the whole period finds the newest day that has prices.
  const period = useRegion({ mode: "period" });
  const latestDay = useMemo(() => {
    let latest: string | null = null;
    for (const code of PRICED_CODES) {
      const days = dailyStats(period.region.markets[code].series);
      const last = days[days.length - 1]?.day;
      if (last && (!latest || last > latest)) latest = last;
    }
    return latest;
  }, [period.region]);
  const focus: Focus = useMemo(
    () => (latestDay ? { mode: "day", day: latestDay } : { mode: "period" }),
    [latestDay],
  );
  const { region, prices, physical } = useRegion(focus);
  const loading = prices.isLoading || physical.isLoading;

  // Re-check every ten minutes while this page is open.
  useEffect(() => {
    const timer = setInterval(
      () => {
        prices.refetch();
        physical.refetch();
      },
      10 * 60 * 1000,
    );
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useMemo(
    () => rules.map((rule) => ({ rule, result: evaluateAlert(rule, region) })),
    [rules, region],
  );

  // Announce a rule once when it moves into the triggered state.
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    if (loading) return;
    for (const { rule, result } of results) {
      const key = `${rule.id}:${latestDay}`;
      const previous = seen.current.get(key);
      if (result.state === "triggered" && previous !== undefined && previous !== "triggered") {
        toast.warning(describeAlert(rule, lang));
      }
      seen.current.set(key, result.state);
    }
  }, [results, loading, latestDay, lang]);

  // New-rule form.
  const [kind, setKind] = useState<Kind>("price");
  const [market, setMarket] = useState<SeeCode>("RS");
  const [border, setBorder] = useState<string>("RS-HU");
  const [from, setFrom] = useState<SeeCode>("HU");
  const [basis, setBasis] = useState<"base" | "anyHour">("base");
  const [op, setOp] = useState<"above" | "below">("above");
  const [value, setValue] = useState(120);
  const borderOptions = kind === "spread" ? SPREAD_BORDERS : SEE_BORDERS;
  const activeBorder = borderOptions.find((item) => item.id === border) ?? borderOptions[0];
  const fromCode = activeBorder.a === from || activeBorder.b === from ? from : activeBorder.a;

  const addRule = () => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const rule: AlertRule =
      kind === "price"
        ? { id, kind, market, basis, op, value }
        : kind === "negative"
          ? { id, kind, market, hours: Math.max(1, Math.round(value)) }
          : kind === "spread"
            ? { id, kind, border: activeBorder.id, from: fromCode, value }
            : { id, kind, border: activeBorder.id, share: Math.min(1, Math.max(0, value / 100)) };
    setRules((prev) => [...sanitizeRules(prev), rule]);
  };
  const changeKind = (next: Kind) => {
    setKind(next);
    setValue(next === "price" ? 120 : next === "negative" ? 1 : next === "spread" ? 10 : 30);
  };

  const exportAll = () => {
    const url = URL.createObjectURL(new Blob([exportStore()], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cea-power-intelligence-workspace.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const importAll = async (file: File | undefined) => {
    if (!file) return;
    try {
      const restored = importStore(await file.text());
      toast.success(
        t(`Restored ${restored} saved sets.`, `Vraćeno ${restored} sačuvanih skupova.`),
      );
    } catch {
      toast.error(
        t("That file is not a CEA workspace export.", "Taj fajl nije CEA izvoz radnog prostora."),
      );
    }
  };

  const triggered = results.filter((item) => item.result.state === "triggered").length;
  const watchedMarkets = markets.filter(isSeeCode);
  const watchedBorders = borders.filter((id) => id in region.borders);
  const select = "h-7 rounded-sm border border-input bg-background px-2 text-xs text-foreground";

  return (
    <div className="grid gap-2 p-2 xl:grid-cols-2">
      <Panel
        className="xl:col-span-2"
        title={t("Alerts", "Upozorenja")}
        subtitle={
          latestDay
            ? `${t("Checked against delivery day", "Provereno za dan isporuke")} ${fmtDay(latestDay)} · ${triggered} ${t("triggered", "aktivirano")}`
            : t("Waiting for data", "Čekanje podataka")
        }
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void importAll(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 text-xs text-ink-2 hover:border-border-strong hover:text-foreground"
            >
              <Upload className="h-3 w-3" />
              {t("Import", "Uvezi")}
            </button>
            <button
              type="button"
              onClick={exportAll}
              className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 text-xs text-ink-2 hover:border-border-strong hover:text-foreground"
            >
              <Download className="h-3 w-3" />
              {t("Export", "Izvezi")}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end gap-2 rounded-sm border border-border p-2.5">
            <div className="grid gap-0.5">
              <span className="text-[11px] text-muted-foreground">{t("Rule", "Pravilo")}</span>
              <Segmented
                value={kind}
                onChange={changeKind}
                options={[
                  { value: "price", label: t("Price level", "Nivo cene") },
                  { value: "negative", label: t("Negative hours", "Negativni sati") },
                  { value: "spread", label: t("Border spread", "Spread granice") },
                  { value: "counterflow", label: t("Flow against spread", "Tok protiv spreada") },
                ]}
              />
            </div>
            {(kind === "price" || kind === "negative") && (
              <label className="grid gap-0.5">
                <span className="text-[11px] font-normal text-muted-foreground">
                  {t("Market", "Tržište")}
                </span>
                <select
                  className={select}
                  value={market}
                  onChange={(event) =>
                    isSeeCode(event.target.value) && setMarket(event.target.value)
                  }
                >
                  {PRICED_CODES.map((code) => (
                    <option key={code} value={code}>
                      {SEE_MARKETS[code].short}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === "price" && (
              <>
                <label className="grid gap-0.5">
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {t("Measure", "Mera")}
                  </span>
                  <select
                    className={select}
                    value={basis}
                    onChange={(event) => setBasis(event.target.value as "base" | "anyHour")}
                  >
                    <option value="base">{t("Day baseload", "Dnevni baseload")}</option>
                    <option value="anyHour">{t("Any hourly price", "Bilo koja satna cena")}</option>
                  </select>
                </label>
                <label className="grid gap-0.5">
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {t("Condition", "Uslov")}
                  </span>
                  <select
                    className={select}
                    value={op}
                    onChange={(event) => setOp(event.target.value as "above" | "below")}
                  >
                    <option value="above">{t("above", "iznad")}</option>
                    <option value="below">{t("below", "ispod")}</option>
                  </select>
                </label>
              </>
            )}
            {(kind === "spread" || kind === "counterflow") && (
              <label className="grid gap-0.5">
                <span className="text-[11px] font-normal text-muted-foreground">
                  {t("Border", "Granica")}
                </span>
                <select
                  className={select}
                  value={activeBorder.id}
                  onChange={(event) => setBorder(event.target.value)}
                >
                  {borderOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {SEE_MARKETS[item.a].short} ⇄ {SEE_MARKETS[item.b].short}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === "spread" && (
              <label className="grid gap-0.5">
                <span className="text-[11px] font-normal text-muted-foreground">
                  {t("Direction", "Smer")}
                </span>
                <select
                  className={select}
                  value={fromCode}
                  onChange={(event) => isSeeCode(event.target.value) && setFrom(event.target.value)}
                >
                  <option value={activeBorder.a}>
                    {SEE_MARKETS[activeBorder.a].short} → {SEE_MARKETS[activeBorder.b].short}
                  </option>
                  <option value={activeBorder.b}>
                    {SEE_MARKETS[activeBorder.b].short} → {SEE_MARKETS[activeBorder.a].short}
                  </option>
                </select>
              </label>
            )}
            <NumField
              className="w-28"
              label={
                kind === "negative"
                  ? t("At least (hours)", "Najmanje (sati)")
                  : kind === "counterflow"
                    ? t("At least", "Najmanje")
                    : t("Threshold", "Prag")
              }
              value={value}
              onChange={setValue}
              unit={kind === "negative" ? "h" : kind === "counterflow" ? "%" : "€/MWh"}
              step={kind === "negative" ? 1 : kind === "counterflow" ? 5 : 1}
            />
            <button
              type="button"
              onClick={addRule}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary px-3 text-xs font-semibold text-primary-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("Add alert", "Dodaj upozorenje")}
            </button>
          </div>

          {results.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t("No alerts yet. Build one above.", "Još nema upozorenja. Napravite jedno iznad.")}
            </p>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>{t("State", "Stanje")}</th>
                  <th>{t("Rule", "Pravilo")}</th>
                  <th className="!text-right">{t("Observed", "Izmereno")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map(({ rule, result }) => (
                  <tr key={rule.id}>
                    <td className="w-32">
                      <span
                        className={cn(
                          "inline-flex h-[18px] items-center gap-1 rounded-sm border px-1.5 font-condensed text-[10px] font-semibold tracking-wider",
                          STATE_STYLE[loading ? "nodata" : result.state],
                        )}
                      >
                        {!loading && result.state === "triggered" && (
                          <BellRing className="h-2.5 w-2.5" />
                        )}
                        {loading
                          ? t("CHECKING", "PROVERA")
                          : result.state === "triggered"
                            ? t("TRIGGERED", "AKTIVIRANO")
                            : result.state === "clear"
                              ? t("CLEAR", "MIRNO")
                              : t("NO DATA", "NEMA PODATAKA")}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-left text-foreground underline-offset-2 hover:underline"
                        onClick={() =>
                          "market" in rule ? selectMarket(rule.market) : selectBorder(rule.border)
                        }
                      >
                        {describeAlert(rule, lang)}
                      </button>
                    </td>
                    <td className="num text-right">
                      {result.observed === null
                        ? "—"
                        : rule.kind === "counterflow"
                          ? fmtShare(result.observed)
                          : rule.kind === "negative"
                            ? `${result.observed} h`
                            : `${fmt(result.observed, 1)} €/MWh`}
                    </td>
                    <td className="w-8 text-right">
                      <button
                        type="button"
                        aria-label={t("Delete alert", "Obriši upozorenje")}
                        onClick={() =>
                          setRules((prev) =>
                            sanitizeRules(prev).filter((item) => item.id !== rule.id),
                          )
                        }
                        className="text-muted-foreground hover:text-critical"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t(
              "Alerts are checked in this browser against the latest delivery day with data, when the page loads and every ten minutes while it stays open. A newly triggered rule shows a notice on screen. No email, push or background notifications are sent, and nothing is checked while the application is closed. Watchlists, alerts, saved views and scenarios are stored on this device only; use Export to move them.",
              "Upozorenja se proveravaju u ovom pregledaču za poslednji dan isporuke sa podacima, pri učitavanju stranice i svakih deset minuta dok je otvorena. Novo aktivirano pravilo prikazuje obaveštenje na ekranu. Ne šalju se e-mail, push ni pozadinska obaveštenja i ništa se ne proverava dok je aplikacija zatvorena. Liste praćenja, upozorenja, sačuvani prikazi i scenariji čuvaju se samo na ovom uređaju; koristite Izvoz da ih prenesete.",
            )}
          </p>
        </div>
      </Panel>

      <Panel
        title={t("Watched markets", "Praćena tržišta")}
        subtitle={
          latestDay ? `${t("Delivery day", "Dan isporuke")} ${fmtDay(latestDay)}` : undefined
        }
        flush
      >
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {PRICED_CODES.map((code) => {
            const on = markets.includes(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setMarkets((prev) =>
                    prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
                  )
                }
                className={cn(
                  "h-6 rounded-sm border px-2 font-condensed text-xs font-semibold tracking-wide",
                  on
                    ? "border-brand bg-brand/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {SEE_MARKETS[code].short}
              </button>
            );
          })}
        </div>
        {watchedMarkets.length === 0 ? (
          <DataState
            height={110}
            compact
            title={t("No markets watched yet", "Još nema praćenih tržišta")}
          >
            {t(
              "Pick markets above, or use the star in any market panel.",
              "Izaberite tržišta iznad ili koristite zvezdicu u panelu tržišta.",
            )}
          </DataState>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>{t("Market", "Tržište")}</th>
                <th className="!text-right">Base</th>
                <th className="!text-right">{t("vs region", "vs region")}</th>
                <th className="!text-right">Peak</th>
                <th className="!text-right">{t("Min / max", "Min / maks")}</th>
                <th className="!text-right">&lt;0 h</th>
                <th>{t("Period", "Period")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {watchedMarkets.map((code) => {
                const view = region.markets[code];
                return (
                  <tr key={code} className="cursor-pointer" onClick={() => selectMarket(code)}>
                    <td>
                      <span className="font-condensed text-xs font-semibold tracking-wide">
                        {SEE_MARKETS[code].short}
                      </span>
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        {lang === "sr" ? SEE_MARKETS[code].nameSr : SEE_MARKETS[code].name}
                      </span>
                    </td>
                    <td className="num text-right">{fmtPrice(view.stats.base)}</td>
                    <td className="text-right">
                      {view.stats.base !== null && region.regionalBase !== null ? (
                        <Delta value={view.stats.base - region.regionalBase} className="text-xs" />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num text-right">{fmtPrice(view.stats.peak)}</td>
                    <td className="num text-right text-ink-2">
                      {fmt(view.stats.min, 0)} / {fmt(view.stats.max, 0)}
                    </td>
                    <td className="num text-right">
                      {view.stats.hours ? view.stats.negativeHours : "—"}
                    </td>
                    <td>
                      <Spark
                        values={dailyStats(period.region.markets[code].series).map(
                          (day) => day.base,
                        )}
                      />
                    </td>
                    <td className="text-right">
                      {view.status && <ProvenanceBadge status={view.status} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>

      <Panel
        title={t("Watched borders", "Praćene granice")}
        subtitle={
          latestDay ? `${t("Delivery day", "Dan isporuke")} ${fmtDay(latestDay)}` : undefined
        }
        flush
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <select
            className={select}
            value=""
            onChange={(event) =>
              event.target.value &&
              setBorders((prev) =>
                prev.includes(event.target.value) ? prev : [...prev, event.target.value],
              )
            }
          >
            <option value="">{t("Add a border…", "Dodaj granicu…")}</option>
            {SEE_BORDERS.filter((item) => !borders.includes(item.id)).map((item) => (
              <option key={item.id} value={item.id}>
                {SEE_MARKETS[item.a].short} ⇄ {SEE_MARKETS[item.b].short}
              </option>
            ))}
          </select>
        </div>
        {watchedBorders.length === 0 ? (
          <DataState
            height={110}
            compact
            title={t("No borders watched yet", "Još nema praćenih granica")}
          >
            {t(
              "Add borders above, or use the star in the border scanner.",
              "Dodajte granice iznad ili koristite zvezdicu u skeneru granica.",
            )}
          </DataState>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>{t("Border", "Granica")}</th>
                <th className="!text-right">{t("Physical flow", "Fizički tok")}</th>
                <th className="!text-right">{t("Mean spread", "Pros. spread")}</th>
                <th className="!text-right">{t("Split", "Razdvojeno")}</th>
                <th className="!text-right">{t("Against spread", "Protiv spreada")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {watchedBorders.map((id) => {
                const view = region.borders[id];
                const a = SEE_MARKETS[view.border.a].short;
                const b = SEE_MARKETS[view.border.b].short;
                const net = view.flow.meanNet;
                return (
                  <tr key={id} className="cursor-pointer" onClick={() => selectBorder(id)}>
                    <td>
                      <span className="font-condensed text-xs font-semibold tracking-wide">
                        {a} ⇄ {b}
                      </span>
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        {view.border.allocation === "implicit"
                          ? t("coupled", "spojeno")
                          : t("explicit", "eksplicitno")}
                      </span>
                    </td>
                    <td className="num text-right">
                      {net === null
                        ? "—"
                        : `${net >= 0 ? `${a}→${b}` : `${b}→${a}`} ${fmtMW(Math.abs(net))} MW`}
                    </td>
                    <td className="num text-right" title={`${b} − ${a}`}>
                      {fmtSigned(view.spreadStats.mean, 1)}
                    </td>
                    <td className="num text-right">{fmtShare(view.spreadStats.splitShare)}</td>
                    <td className="num text-right">{fmtShare(view.alignment.againstSpread)}</td>
                    <td className="text-right" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        aria-label={t("Remove", "Ukloni")}
                        onClick={() => setBorders((prev) => prev.filter((item) => item !== id))}
                        className="text-muted-foreground hover:text-critical"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
