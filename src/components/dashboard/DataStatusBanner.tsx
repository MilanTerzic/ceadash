import { useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { useLang } from "@/lib/i18n";

function formatHourStamp(d: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function DataStatusBanner({
  source,
  lastUpdate,
  hours,
  completeDays,
  incompleteDays,
  marketArea = "Serbia SEEPEX (EIC 10YCS-SERBIATSOV)",
  warning,
  selectedFrom,
  selectedTo,
  availableFrom,
  availableTo,
  missingDays,
  reasons,
  incompleteDayList,
  failedFetches,
  totalSelectedDays,
  attemptedDaysCount,
  fetchedDaysCount,
  failureCounts,
  capReached,
  maxFetchPerCall,
  debugSummary,
}: {
  source: "entsoe" | "cache" | "none";
  lastUpdate?: Date;
  hours: number;
  completeDays: number;
  incompleteDays: number;
  marketArea?: string;
  warning?: string;
  selectedFrom?: string;
  selectedTo?: string;
  availableFrom?: string;
  availableTo?: string;
  missingDays?: number;
  reasons?: string[];
  incompleteDayList?: string[];
  failedFetches?: {
    day: string;
    reason: string;
    status?: number;
    message?: string;
    attempts?: number;
  }[];
  totalSelectedDays?: number;
  attemptedDaysCount?: number;
  fetchedDaysCount?: number;
  failureCounts?: Record<string, number>;
  capReached?: boolean;
  maxFetchPerCall?: number;
  debugSummary?: string;
}) {
  const { t } = useLang();
  const [diagOpen, setDiagOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Detect partial coverage: selected range extends past what we actually loaded.
  const partial =
    !!selectedFrom &&
    !!selectedTo &&
    (!availableFrom || !availableTo || availableFrom > selectedFrom || availableTo < selectedTo);

  const isLive = source === "entsoe" && !partial;
  const isCache = source === "cache" && !partial;
  const isPartial = partial && source !== "none";
  const isNone = source === "none";

  const Icon = isNone ? AlertCircle : isLive ? CheckCircle2 : Clock;
  const tone = isNone
    ? "border-critical/40 bg-critical/5 text-critical"
    : isPartial
      ? "border-warning/40 bg-warning/10 text-foreground"
      : isLive
        ? "border-positive/40 bg-positive/5 text-foreground"
        : "border-warning/40 bg-warning/10 text-foreground";

  const statusLabel = isNone
    ? t("Data unavailable", "Podaci nedostupni")
    : isPartial
      ? t("Partial ENTSO-E coverage", "Delimična pokrivenost ENTSO-E podacima")
      : isLive
        ? t("Complete ENTSO-E coverage", "Potpuna pokrivenost ENTSO-E podacima")
        : t("Cached only", "Samo iz keša");

  const hasDiagnostics =
    (failedFetches && failedFetches.length > 0) ||
    totalSelectedDays != null ||
    attemptedDaysCount != null ||
    !!debugSummary;

  const computedDebug =
    debugSummary ??
    `ENTSO-E debug: selected ${selectedFrom ?? "?"} → ${selectedTo ?? "?"}; ` +
      `missing ${missingDays ?? 0} d; failed ${failedFetches?.length ?? 0} d` +
      (failedFetches && failedFetches.length
        ? `; first failed: ${failedFetches[0].day}${failedFetches[0].status ? ` http_${failedFetches[0].status}` : ""}${failedFetches[0].message ? ` — ${failedFetches[0].message}` : ""}`
        : "");

  async function copyDebug() {
    try {
      await navigator.clipboard.writeText(computedDebug);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-2">
      <div
        className={`rounded-2xl border px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1 ${tone}`}
      >
        <span className="inline-flex items-center gap-2 font-medium">
          <Icon className="h-4 w-4" />
          {statusLabel}
        </span>
        <span className="text-muted-foreground">
          {t("Source: ", "Izvor: ")}
          <span className="text-foreground">{marketArea}</span>
        </span>
        <span className="text-muted-foreground">
          {t("Time zone: ", "Vremenska zona: ")}
          <span className="text-foreground">Europe/Belgrade (CET/CEST)</span>
        </span>
        {selectedFrom && selectedTo && (
          <span className="text-muted-foreground">
            {t("Selected: ", "Izabrano: ")}
            <span className="text-foreground">
              {selectedFrom} → {selectedTo}
            </span>
          </span>
        )}
        {availableFrom && availableTo && (
          <span className="text-muted-foreground">
            {t("Loaded: ", "Učitano: ")}
            <span className="text-foreground">
              {availableFrom} → {availableTo}
            </span>
          </span>
        )}
        {lastUpdate && (
          <span className="text-muted-foreground">
            {t("Latest hour: ", "Najnoviji sat: ")}
            <span className="text-foreground">{formatHourStamp(lastUpdate)}</span>
          </span>
        )}
        <span className="text-muted-foreground">
          {hours.toLocaleString()} {t("hourly observations", "satnih zapisa")} · {completeDays}{" "}
          {t("complete day(s)", "potpunih dana")}
          {incompleteDays > 0 && (
            <span className="text-warning">
              {" "}
              · {incompleteDays} {t("incomplete", "nepotpunih")}
            </span>
          )}
          {missingDays != null && missingDays > 0 && (
            <span className="text-warning">
              {" "}
              · {missingDays} {t("missing selected day(s)", "izabranih dana bez podataka")}
            </span>
          )}
        </span>
        {isPartial && selectedFrom && selectedTo && (
          <span className="basis-full text-warning text-xs">
            {t(
              `Selected period is not fully covered by available data. Baseload is calculated only from available complete days: ${availableFrom ?? "?"} → ${availableTo ?? "?"}.`,
              `Izabrani period nije potpuno pokriven dostupnim podacima. Bazna cena se računa samo iz dostupnih potpunih dana: ${availableFrom ?? "?"} → ${availableTo ?? "?"}.`,
            )}
          </span>
        )}
        {incompleteDayList && incompleteDayList.length > 0 && (
          <span className="basis-full text-warning text-xs">
            {t("Incomplete days excluded: ", "Nepotpuni dani izuzeti: ")}
            {incompleteDayList.slice(0, 8).join(", ")}
            {incompleteDayList.length > 8 ? ` (+${incompleteDayList.length - 8})` : ""}
          </span>
        )}
        {warning && !incompleteDayList?.length && (
          <span className="basis-full text-warning text-xs">{warning}</span>
        )}
      </div>

      {hasDiagnostics && (
        <div className="rounded-2xl border border-border/70 bg-card/40 text-xs">
          <button
            type="button"
            onClick={() => setDiagOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-4 py-2 text-left"
          >
            <span className="inline-flex items-center gap-2 font-medium">
              {diagOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {t("ENTSO-E fetch diagnostics", "ENTSO-E dijagnostika preuzimanja")}
            </span>
            <span className="text-muted-foreground">
              {failedFetches?.length ?? 0} {t("failed", "neuspešnih")} · {fetchedDaysCount ?? 0}/
              {attemptedDaysCount ?? 0} {t("fetched", "preuzeto")}
              {capReached && maxFetchPerCall
                ? ` · ${t(`cap ${maxFetchPerCall}`, `limit ${maxFetchPerCall}`)}`
                : ""}
            </span>
          </button>
          {diagOpen && (
            <div className="px-4 pb-3 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-muted-foreground">
                <div>
                  {t("Selected days", "Izabrani dani")}:{" "}
                  <span className="text-foreground">{totalSelectedDays ?? "—"}</span>
                </div>
                <div>
                  {t("Complete", "Kompletno")}:{" "}
                  <span className="text-foreground">{completeDays}</span>
                </div>
                <div>
                  {t("Incomplete", "Nepotpuni")}:{" "}
                  <span className="text-foreground">{incompleteDays}</span>
                </div>
                <div>
                  {t("Missing", "Nedostaje")}:{" "}
                  <span className="text-foreground">{missingDays ?? 0}</span>
                </div>
                <div>
                  {t("Attempted this run", "Pokušano ovog puta")}:{" "}
                  <span className="text-foreground">{attemptedDaysCount ?? 0}</span>
                </div>
                <div>
                  {t("Fetched", "Preuzeto")}:{" "}
                  <span className="text-foreground">{fetchedDaysCount ?? 0}</span>
                </div>
                <div>
                  {t("Failed", "Neuspešno")}:{" "}
                  <span className="text-foreground">{failedFetches?.length ?? 0}</span>
                </div>
                <div>
                  {t("Per-call cap", "Limit po pozivu")}:{" "}
                  <span className="text-foreground">
                    {maxFetchPerCall ?? "—"}
                    {capReached ? " ⚠︎" : ""}
                  </span>
                </div>
              </div>

              {failureCounts && Object.keys(failureCounts).length > 0 && (
                <div>
                  <div className="font-medium mb-0.5">
                    {t("Failures by reason", "Neuspesi po razlogu")}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                    {Object.entries(failureCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([r, n]) => (
                        <span key={r}>
                          {r}: {n}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {failedFetches && failedFetches.length > 0 && (
                <div>
                  <div className="font-medium mb-0.5">
                    {t("First failed days", "Prvi neuspešni dani")} (
                    {Math.min(20, failedFetches.length)}/{failedFetches.length})
                  </div>
                  <div className="max-h-48 overflow-auto font-mono leading-5">
                    {failedFetches.slice(0, 20).map((f) => (
                      <div key={f.day}>
                        {f.day} · {f.reason}
                        {f.status ? ` · http_${f.status}` : ""}
                        {f.attempts ? ` · ${f.attempts}x` : ""}
                        {f.message ? ` — ${f.message}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 pt-1">
                <textarea
                  readOnly
                  value={computedDebug}
                  className="flex-1 min-h-[64px] rounded border border-border/60 bg-background/60 p-2 font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={copyDebug}
                  className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] hover:bg-muted/40"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? t("Copied", "Kopirano") : t("Copy debug", "Kopiraj dijagnostiku")}
                </button>
              </div>

              {reasons && reasons.length > 0 && (
                <div className="text-warning/90">
                  <span className="font-medium">{t("Reason log: ", "Dnevnik razloga: ")}</span>
                  <span className="font-mono">{reasons.slice(0, 10).join(" · ")}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
