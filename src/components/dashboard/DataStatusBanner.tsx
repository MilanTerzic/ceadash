import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
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
  failedFetches?: { day: string; reason: string }[];
}) {
  const { t } = useLang();

  // Detect partial coverage: selected range extends past what we actually loaded.
  const partial =
    !!selectedFrom && !!selectedTo &&
    (!availableFrom || !availableTo ||
      availableFrom > selectedFrom || availableTo < selectedTo);

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
      ? t("Partial ENTSO-E coverage", "Delimična ENTSO-E pokrivenost")
      : isLive
        ? t("Live ENTSO-E", "Uživo ENTSO-E")
        : t("Cached fallback", "Keširani podaci");

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1 ${tone}`}>
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
          <span className="text-foreground">{selectedFrom} → {selectedTo}</span>
        </span>
      )}
      {availableFrom && availableTo && (
        <span className="text-muted-foreground">
          {t("Loaded: ", "Učitano: ")}
          <span className="text-foreground">{availableFrom} → {availableTo}</span>
        </span>
      )}
      {lastUpdate && (
        <span className="text-muted-foreground">
          {t("Latest hour: ", "Najnoviji sat: ")}
          <span className="text-foreground">{formatHourStamp(lastUpdate)}</span>
        </span>
      )}
      <span className="text-muted-foreground">
        {hours.toLocaleString()} {t("hourly observations", "satnih opservacija")} · {completeDays}{" "}
        {t("complete day(s)", "kompletnih dana")}
        {incompleteDays > 0 && (
          <span className="text-warning"> · {incompleteDays} {t("incomplete", "nepotpunih")}</span>
        )}
        {missingDays != null && missingDays > 0 && (
          <span className="text-warning"> · {missingDays} {t("missing selected day(s)", "izabranih dana nedostaje")}</span>
        )}
      </span>
      {isPartial && selectedFrom && selectedTo && (
        <span className="basis-full text-warning text-xs">
          {t(
            `Selected period is not fully covered by available data. Baseload is calculated only from available complete days: ${availableFrom ?? "?"} → ${availableTo ?? "?"}.`,
            `Izabrani period nije potpuno pokriven dostupnim podacima. Baseload se računa samo iz dostupnih kompletnih dana: ${availableFrom ?? "?"} → ${availableTo ?? "?"}.`,
          )}
        </span>
      )}
      {warning && (
        <span className="basis-full text-warning text-xs">{warning}</span>
      )}
      {reasons && reasons.length > 0 && (
        <span className="basis-full text-warning/90 text-[11px]">
          {t("Fetch issues: ", "Problemi pri preuzimanju: ")}{reasons.join(" · ")}
        </span>
      )}
    </div>
  );
}
