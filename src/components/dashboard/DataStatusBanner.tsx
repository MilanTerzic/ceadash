import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useLang } from "@/lib/i18n";

export function DataStatusBanner({
  source,
  lastUpdate,
  hours,
  completeDays,
  incompleteDays,
  marketArea = "Serbia SEEPEX (EIC 10YCS-SERBIATSOV)",
  warning,
}: {
  source: "entsoe" | "cache" | "none";
  lastUpdate?: Date;
  hours: number;
  completeDays: number;
  incompleteDays: number;
  marketArea?: string;
  warning?: string;
}) {
  const { t } = useLang();
  const isLive = source === "entsoe";
  const isCache = source === "cache";
  const Icon = source === "none" ? AlertCircle : isLive ? CheckCircle2 : Clock;
  const tone =
    source === "none"
      ? "border-critical/40 bg-critical/5 text-critical"
      : isLive
        ? "border-positive/40 bg-positive/5 text-foreground"
        : "border-warning/40 bg-warning/10 text-foreground";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1 ${tone}`}>
      <span className="inline-flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4" />
        {isLive
          ? t("Live ENTSO-E", "Uživo ENTSO-E")
          : isCache
            ? t("Cached fallback", "Keširani podaci")
            : t("Data unavailable", "Podaci nedostupni")}
      </span>
      <span className="text-muted-foreground">
        {t("Source: ", "Izvor: ")}
        <span className="text-foreground">{marketArea}</span>
      </span>
      <span className="text-muted-foreground">
        {t("Time zone: ", "Vremenska zona: ")}
        <span className="text-foreground">Europe/Belgrade (CET/CEST)</span>
      </span>
      {lastUpdate && (
        <span className="text-muted-foreground">
          {t("Latest hour: ", "Najnoviji sat: ")}
          <span className="text-foreground">{lastUpdate.toLocaleString("en-GB", { timeZone: "Europe/Belgrade" })}</span>
        </span>
      )}
      <span className="text-muted-foreground">
        {hours.toLocaleString()} {t("hours", "sati")} · {completeDays}{" "}
        {t("complete day(s)", "kompletnih dana")}
        {incompleteDays > 0 && (
          <span className="text-warning"> · {incompleteDays} {t("incomplete", "nepotpunih")}</span>
        )}
      </span>
      {warning && (
        <span className="basis-full text-warning text-xs">{warning}</span>
      )}
    </div>
  );
}
