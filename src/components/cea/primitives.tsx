import type { ReactNode } from "react";
import { AlertTriangle, CircleDashed, CloudOff, FlaskConical, Loader2 } from "lucide-react";

import { useLang } from "@/lib/i18n";
import { fmtAge, fmtSigned } from "@/lib/see/format";
import { reasonText, type Provenance, type SeriesStatus } from "@/lib/see/status";
import { cn } from "@/lib/utils";

/** Bordered analytical surface. Every workspace is composed of these. */
export function Panel({
  title,
  subtitle,
  actions,
  status,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Remove body padding (tables, maps). */
  flush?: boolean;
}) {
  return (
    <section
      className={cn("flex min-w-0 flex-col rounded-md border border-border bg-surface", className)}
    >
      {(title || actions || status) && (
        <header className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
          <div className="min-w-0 flex-1">
            <h2 className="eyebrow truncate !text-ink-2">{title}</h2>
            {subtitle && (
              <p className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {status}
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 min-w-0 flex-1", !flush && "p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

const PROVENANCE: Record<
  Provenance,
  { en: string; sr: string; className: string; title: { en: string; sr: string } }
> = {
  live: {
    en: "LIVE",
    sr: "UŽIVO",
    className: "border-positive/40 text-positive",
    title: { en: "Fetched from the provider just now", sr: "Preuzeto od provajdera upravo sada" },
  },
  cache: {
    en: "OBSERVED",
    sr: "IZMERENO",
    className: "border-border-strong text-ink-2",
    title: {
      en: "Provider observation served from cache",
      sr: "Podatak provajdera iz keša",
    },
  },
  stale: {
    en: "STALE",
    sr: "ZASTARELO",
    className: "border-warning/50 text-warning",
    title: {
      en: "Last good provider observation; the provider could not be reached",
      sr: "Poslednji ispravan podatak; provajder nije dostupan",
    },
  },
  synthetic: {
    en: "SYNTHETIC",
    sr: "SINTETIČKO",
    className: "border-serious/60 bg-serious/10 text-serious",
    title: {
      en: "Generated development data, not a market observation",
      sr: "Generisani razvojni podaci, nisu tržišna merenja",
    },
  },
  empty: {
    en: "NO DATA",
    sr: "NEMA PODATAKA",
    className: "border-border-strong text-muted-foreground",
    title: { en: "The provider published nothing", sr: "Provajder nije objavio podatke" },
  },
  unavailable: {
    en: "NOT CONNECTED",
    sr: "NIJE POVEZANO",
    className: "border-border-strong text-muted-foreground",
    title: { en: "Source not connected", sr: "Izvor nije povezan" },
  },
  error: {
    en: "ERROR",
    sr: "GREŠKA",
    className: "border-critical/50 text-critical",
    title: { en: "The request failed", sr: "Zahtev nije uspeo" },
  },
};

export function ProvenanceBadge({
  state,
  status,
  className,
}: {
  state?: Provenance | null;
  status?: SeriesStatus;
  className?: string;
}) {
  const { lang } = useLang();
  const resolved = state ?? status?.state;
  if (!resolved) return null;
  const meta = PROVENANCE[resolved];
  const age = status?.fetchedAt ? ` · ${fmtAge(status.fetchedAt)}` : "";
  return (
    <span
      title={`${meta.title[lang]}${age}`}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-sm border px-1.5 font-condensed text-[10px] font-semibold tracking-wider",
        meta.className,
        className,
      )}
    >
      {meta[lang]}
    </span>
  );
}

/** Signed change. Colour is a cue only: the sign and arrow carry the meaning. */
export function Delta({
  value,
  digits = 1,
  unit,
  className,
  neutral = false,
}: {
  value: number | null | undefined;
  digits?: number;
  unit?: string;
  className?: string;
  /** Render without up/down colour (when direction is not good or bad). */
  neutral?: boolean;
}) {
  const finite = value !== null && value !== undefined && Number.isFinite(value);
  const rounded = finite ? Number(value.toFixed(digits)) : 0;
  const tone =
    !finite || rounded === 0 || neutral
      ? "text-muted-foreground"
      : rounded > 0
        ? "text-up"
        : "text-down";
  const arrow = !finite || rounded === 0 ? "" : rounded > 0 ? "▲" : "▼";
  return (
    <span
      className={cn("num inline-flex items-baseline gap-0.5 whitespace-nowrap", tone, className)}
    >
      {arrow && <span className="text-[0.7em]">{arrow}</span>}
      {fmtSigned(value, digits)}
      {unit && finite && <span className="text-[0.85em] opacity-80">{unit}</span>}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  delta,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  delta?: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="num text-xl font-medium leading-none text-foreground">{value}</span>
        {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
        {delta}
      </div>
      {hint && <div className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string; disabled?: boolean }>;
  size?: "sm" | "xs";
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-sm border border-border bg-background p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "whitespace-nowrap rounded-[3px] font-condensed font-medium tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-6 px-2.5 text-xs" : "h-5 px-2 text-[11px]",
              active
                ? "bg-surface-2 text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The one way a panel says it has nothing to draw. It always states why: still loading,
 * not connected, nothing published, or failed. It never renders a placeholder number.
 */
export function DataState({
  loading,
  status,
  state,
  reason,
  children,
  title: titleOverride,
  height = 160,
  compact = false,
}: {
  /** Replaces the default heading, for instructional empty states. */
  title?: string;
  loading?: boolean;
  status?: SeriesStatus;
  state?: Provenance;
  reason?: string;
  children?: ReactNode;
  height?: number | string;
  compact?: boolean;
}) {
  const { t, lang } = useLang();
  const resolved = state ?? status?.state ?? "empty";
  const Icon = loading
    ? Loader2
    : resolved === "error"
      ? AlertTriangle
      : resolved === "unavailable"
        ? CloudOff
        : resolved === "synthetic"
          ? FlaskConical
          : CircleDashed;
  const title = titleOverride
    ? titleOverride
    : loading
      ? t("Loading…", "Učitavanje…")
      : resolved === "unavailable"
        ? t("Source not connected", "Izvor nije povezan")
        : resolved === "error"
          ? t("Could not load", "Učitavanje nije uspelo")
          : t("No data for this selection", "Nema podataka za ovaj izbor");
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 px-4 text-center"
      style={{ minHeight: height }}
    >
      <Icon
        className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin")}
        aria-hidden
      />
      <div className={cn("font-medium text-ink-2", compact ? "text-xs" : "text-[13px]")}>
        {title}
      </div>
      {!loading && (
        <div className="max-w-sm text-[11.5px] leading-snug text-muted-foreground">
          {children ?? reasonText(reason ?? status?.reason, lang)}
        </div>
      )}
    </div>
  );
}

export function LegendDot({
  color,
  label,
  shape = "dot",
}: {
  color: string;
  label: ReactNode;
  shape?: "dot" | "line";
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-2">
      <span
        aria-hidden
        className={shape === "dot" ? "h-2 w-2 rounded-[2px]" : "h-0.5 w-3 rounded-full"}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  active,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-surface-2 hover:text-foreground",
        active && "border-border-strong bg-surface-2 text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Table shell with the system's dense header and row rhythm. */
export function DataTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[12.5px] [&_tbody_tr:hover]:bg-surface-2/60 [&_tbody_tr]:border-t [&_tbody_tr]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:eyebrow [&_th]:whitespace-nowrap [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold">
        {children}
      </table>
    </div>
  );
}

/** Labelled numeric input with a unit. Keeps the typed text so decimals can be entered. */
export function NumField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
  title,
  className,
}: {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
  className?: string;
}) {
  return (
    <label className={cn("grid min-w-0 gap-0.5", className)} title={title}>
      <span className="truncate text-[11px] font-normal text-muted-foreground">{label}</span>
      <span className="flex h-7 min-w-0 items-center rounded-sm border border-input bg-background focus-within:border-ring">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (event.target.value === "" || !Number.isFinite(next)) return;
            onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
          }}
          className="num h-full w-0 min-w-0 flex-1 bg-transparent px-2 text-xs text-foreground outline-none"
        />
        {unit && <span className="shrink-0 pr-2 text-[10.5px] text-muted-foreground">{unit}</span>}
      </span>
    </label>
  );
}
