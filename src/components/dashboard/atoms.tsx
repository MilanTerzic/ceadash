import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
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
            trend.delta > 0
              ? "text-positive"
              : trend.delta < 0
                ? "text-critical"
                : "text-muted-foreground",
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
  // Demo badges are suppressed app-wide; live ENTSO-E data is fetched via server functions.
  return null;
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

export function SignalPill({
  signal,
}: {
  signal: "Positive" | "Neutral" | "Warning" | "Critical";
}) {
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
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        color,
      )}
    >
      {label}
    </span>
  );
}

export function PageLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-10 w-72 max-w-full" />
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-24" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-4 h-9 w-32" />
            <Skeleton className="mt-3 h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-border/70 bg-card p-6 shadow-card">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="mt-5 h-72 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DataUnavailableState({
  title,
  description,
  onRetry,
}: {
  title: ReactNode;
  description: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-8 text-center shadow-card">
      <AlertTriangle className="mx-auto h-9 w-9 text-warning" />
      <h2 className="mt-4 font-display text-2xl text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button type="button" variant="outline" className="mt-5 gap-2" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Retry live data
        </Button>
      )}
    </div>
  );
}
