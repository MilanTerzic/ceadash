import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import type { ReactNode } from "react";

export function MetricLabel({
  label,
  hint,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground", className)}>
      <span>{label}</span>
      {hint && (
        <TooltipProvider delayDuration={120}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground/60 hover:text-foreground">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">{hint}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

export function KpiCard({
  label,
  hint,
  value,
  unit,
  trend,
  demo,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: ReactNode;
  unit?: string;
  trend?: { delta: number; suffix?: string };
  demo?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
      <div className="flex items-start justify-between">
        <MetricLabel label={label} hint={hint} />
        {demo && <DemoBadge />}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <div className="font-display text-3xl text-foreground">{value}</div>
        {unit && <div className="text-xs text-muted-foreground">{unit}</div>}
      </div>
      {trend && (
        <div
          className={cn(
            "mt-1 text-xs",
            trend.delta > 0 ? "text-positive" : trend.delta < 0 ? "text-critical" : "text-muted-foreground",
          )}
        >
          {trend.delta > 0 ? "▲" : trend.delta < 0 ? "▼" : "·"} {Math.abs(trend.delta).toFixed(1)}
          {trend.suffix ?? "%"}
        </div>
      )}
    </div>
  );
}

export function DemoBadge() {
  const { t } = useLang();
  return (
    <span className="inline-flex items-center rounded-full bg-accent/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
      {t("Demo data", "Demo podaci")}
    </span>
  );
}

export function ChartCard({
  title,
  description,
  children,
  right,
  demo,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  demo?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display text-xl text-foreground">{title}</h3>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {demo && <DemoBadge />}
          {right}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function SignalPill({ signal }: { signal: "Positive" | "Neutral" | "Warning" | "Critical" }) {
  const { t } = useLang();
  const color =
    signal === "Positive"
      ? "bg-positive/15 text-positive"
      : signal === "Warning"
        ? "bg-warning/20 text-warning"
        : signal === "Critical"
          ? "bg-critical/15 text-critical"
          : "bg-muted text-muted-foreground";
  const label =
    signal === "Positive"
      ? t("Positive", "Pozitivno")
      : signal === "Warning"
        ? t("Warning", "Upozorenje")
        : signal === "Critical"
          ? t("Critical", "Kritično")
          : t("Neutral", "Neutralno");
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium", color)}>
      {label}
    </span>
  );
}
