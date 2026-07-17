import {
  AlertTriangle,
  BatteryCharging,
  CircleDollarSign,
  Sun,
  TrendingDown,
  Wind,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fmtNum } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CapturePeriodMetrics } from "./producer-analytics";

type Technology = "solar" | "wind" | "both";

function formatRate(value: number | null) {
  return value == null || !Number.isFinite(value) ? "N/A" : `${fmtNum(value * 100, 1)}%`;
}

function formatPrice(value: number | null) {
  return value == null || !Number.isFinite(value) ? "N/A" : fmtNum(value, 1);
}

function ProducerKpi({
  label,
  value,
  unit,
  detail,
  icon: Icon,
  accent,
  badge,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  icon: LucideIcon;
  accent: string;
  badge?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", accent)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        {badge ? (
          <Badge variant="outline" className="h-5 max-w-full px-1.5 text-[10px]">
            {badge}
          </Badge>
        ) : null}
      </div>
      <div className="mt-3 min-h-8 text-[11px] font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex min-h-9 min-w-0 items-baseline gap-1.5">
        <span className="min-w-0 text-2xl font-semibold tabular-nums text-foreground">{value}</span>
        {unit ? <span className="text-[11px] text-muted-foreground">{unit}</span> : null}
      </div>
      <p className="mt-2 min-h-8 text-xs leading-4 text-muted-foreground">{detail}</p>
    </div>
  );
}

export function ProducerKpiStrip({
  metrics,
  technology,
  solarModelled,
}: {
  metrics: CapturePeriodMetrics;
  technology: Technology;
  solarModelled: boolean;
}) {
  const { t } = useLang();
  const rateCandidates =
    technology === "solar"
      ? [{ technology: "Solar", value: metrics.solarCaptureRate }]
      : technology === "wind"
        ? [{ technology: "Wind", value: metrics.windCaptureRate }]
        : [
            { technology: "Solar", value: metrics.solarCaptureRate },
            { technology: "Wind", value: metrics.windCaptureRate },
          ];
  const weakerRate = rateCandidates
    .filter(
      (candidate): candidate is { technology: string; value: number } =>
        candidate.value != null && Number.isFinite(candidate.value),
    )
    .sort((left, right) => left.value - right.value)[0];
  const exposure =
    technology === "solar"
      ? metrics.solarNegativeExposure
      : technology === "wind"
        ? metrics.windNegativeExposure
        : Math.max(metrics.solarNegativeExposure ?? 0, metrics.windNegativeExposure ?? 0);
  const captureDiscount =
    weakerRate == null ? "No reliable comparison" : `${weakerRate.technology} is the weaker result`;

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <ProducerKpi
        label={t("Serbia baseload", "Bazna cena Srbija")}
        value={formatPrice(metrics.baseloadEurPerMWh)}
        unit="EUR/MWh"
        detail={t("Hourly day-ahead average", "Prosek satnih dan-unapred cena")}
        icon={CircleDollarSign}
        accent="bg-blue-500/12 text-blue-600 dark:text-blue-400"
      />
      <ProducerKpi
        label={t("Solar capture price", "Solarna capture cena")}
        value={formatPrice(metrics.solarCaptureEurPerMWh)}
        unit="EUR/MWh"
        detail={
          metrics.solarCaptureEurPerMWh == null || metrics.baseloadEurPerMWh == null
            ? t("Solar profile unavailable", "Solarni profil nije dostupan")
            : `${fmtNum(metrics.solarCaptureEurPerMWh - metrics.baseloadEurPerMWh, 1)} vs baseload`
        }
        icon={Sun}
        accent="bg-amber-500/15 text-amber-700 dark:text-amber-400"
        badge={solarModelled ? t("Modelled", "Modelovano") : undefined}
      />
      <ProducerKpi
        label={t("Wind capture price", "Capture cena vetra")}
        value={formatPrice(metrics.windCaptureEurPerMWh)}
        unit="EUR/MWh"
        detail={
          metrics.windCaptureEurPerMWh == null || metrics.baseloadEurPerMWh == null
            ? t("Wind profile unavailable", "Profil vetra nije dostupan")
            : `${fmtNum(metrics.windCaptureEurPerMWh - metrics.baseloadEurPerMWh, 1)} vs baseload`
        }
        icon={Wind}
        accent="bg-teal-500/12 text-teal-700 dark:text-teal-400"
      />
      <ProducerKpi
        label={t("Weaker capture rate", "Slabija capture stopa")}
        value={weakerRate ? formatRate(weakerRate.value) : "N/A"}
        detail={captureDiscount}
        icon={TrendingDown}
        accent="bg-slate-500/12 text-slate-700 dark:text-slate-300"
      />
      <ProducerKpi
        label={t("Negative-price exposure", "Izlozenost negativnim cenama")}
        value={formatRate(exposure)}
        detail={`${metrics.negativePriceHours} ${t("negative intervals", "negativnih intervala")}`}
        icon={AlertTriangle}
        accent="bg-red-500/12 text-red-600 dark:text-red-400"
      />
      <ProducerKpi
        label={t("BESS 2h net spread", "BESS 2h neto raspon")}
        value={formatPrice(metrics.bess.avgNet2)}
        unit="EUR/MWh"
        detail={`${metrics.bess.days} ${t("days included", "ukljucenih dana")} · 85% RTE`}
        icon={BatteryCharging}
        accent="bg-violet-500/12 text-violet-700 dark:text-violet-400"
      />
    </section>
  );
}
