import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Database, Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDateRange } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";
import { PORTFOLIO_PROFILES, type PortfolioProfile, useWorkspace } from "@/lib/workspace";

export function PortfolioSelector() {
  const { t } = useLang();
  const { portfolio, setPortfolio } = useWorkspace();
  const { range } = useDateRange();
  const navigate = useNavigate();
  const activeView = useRouterState({
    select: (state) =>
      state.location.pathname === "/dashboard/portfolio"
        ? (state.location.search as { view?: string }).view
        : undefined,
  });
  const routedPortfolio: PortfolioProfile | null =
    activeView === "consumer"
      ? "industrial-consumer"
      : activeView === "battery"
        ? "battery"
        : activeView === "vpp"
          ? "aggregated-portfolio"
          : activeView === "producer"
            ? portfolio === "serbia-market" ||
              portfolio === "solar-project" ||
              portfolio === "wind-project"
              ? portfolio
              : "serbia-market"
            : activeView === "project"
              ? portfolio === "solar-project" || portfolio === "wind-project"
                ? portfolio
                : "solar-project"
              : null;
  const displayedPortfolio = routedPortfolio ?? portfolio;

  useEffect(() => {
    if (routedPortfolio && routedPortfolio !== portfolio) {
      setPortfolio(routedPortfolio);
    }
  }, [portfolio, routedPortfolio, setPortfolio]);

  const selectPortfolio = (value: string) => {
    const nextPortfolio = value as PortfolioProfile;
    setPortfolio(nextPortfolio);
    const view =
      nextPortfolio === "industrial-consumer"
        ? "consumer"
        : nextPortfolio === "battery"
          ? "battery"
          : nextPortfolio === "aggregated-portfolio"
            ? "vpp"
            : "producer";
    void navigate({
      to: "/dashboard/portfolio",
      search: {
        view,
        preset: "custom",
        from: range.from,
        to: range.to,
      },
    });
  };
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>{t("Asset / portfolio", "Asset / portfolio")}</span>
      <Select value={displayedPortfolio} onValueChange={selectPortfolio}>
        <SelectTrigger className="h-9 min-w-[190px] bg-surface-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PORTFOLIO_PROFILES.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {t(item.en, item.sr)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function DataQualityIndicator({
  status,
  updatedAt,
}: {
  status?: "Complete" | "Partial" | "Cached" | "Unavailable";
  updatedAt?: string;
}) {
  const { t } = useLang();
  const navigate = useNavigate();
  const statusLabel =
    status == null
      ? t("Data status", "Status podataka")
      : status === "Complete"
        ? t("Complete", "Potpuno")
        : status === "Partial"
          ? t("Partial", "Delimicno")
          : status === "Cached"
            ? t("Cached", "Iz kesa")
            : t("Unavailable", "Nedostupno");
  const dot =
    status == null
      ? "bg-muted-foreground"
      : status === "Complete"
        ? "bg-success"
        : status === "Partial" || status === "Cached"
          ? "bg-warning"
          : "bg-destructive";
  const time = updatedAt
    ? new Date(updatedAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Belgrade",
      })
    : null;
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border/60 bg-surface-2 px-3 text-xs text-muted-foreground hover:text-foreground"
      title={t(
        "Open detailed data-quality diagnostics on individual pages.",
        "Detaljna dijagnostika kvaliteta podataka nalazi se na pojedinacnim stranicama.",
      )}
      onClick={() => {
        const event = new Event("cea:data-quality", { cancelable: true });
        const unhandled = window.dispatchEvent(event);
        if (unhandled) {
          void navigate({ to: "/dashboard/more", search: { tab: "data" } });
        }
      }}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{statusLabel}</span>
      {time ? <span className="num">· {time}</span> : null}
    </button>
  );
}

export function HeaderActionButtons() {
  const { t } = useLang();
  const [alertPreferences, setAlertPreferences] = useState<Record<string, boolean>>({});
  const alerts = [
    {
      key: "negative-prices",
      title: t("Negative-price intervals", "Intervali negativnih cena"),
      severity: t("Warning", "Upozorenje"),
      threshold: "< 0 EUR/MWh",
      page: "/dashboard/markets/spot",
    },
    {
      key: "capture-rate",
      title: t("Solar capture rate below threshold", "Solarni capture rate ispod praga"),
      severity: t("Warning", "Upozorenje"),
      threshold: "< 85%",
      page: "/dashboard/portfolio?view=producer",
    },
    {
      key: "bess-spread",
      title: t("BESS net spread above threshold", "BESS neto spread iznad praga"),
      severity: t("Positive", "Pozitivno"),
      threshold: "> 30 EUR/MWh",
      page: "/dashboard/portfolio?view=battery",
    },
    {
      key: "border-utilization",
      title: t("Border utilization above threshold", "Iskoriscenost granice iznad praga"),
      severity: t("Critical", "Kriticno"),
      threshold: "> 90%",
      page: "/dashboard/markets/system",
    },
    {
      key: "partial-data",
      title: t("Missing or partial data", "Nedostajuci ili delimicni podaci"),
      severity: t("Warning", "Upozorenje"),
      threshold: "coverage < 100%",
      page: "/dashboard/more?tab=data",
    },
  ];

  useEffect(() => {
    try {
      const stored = localStorage.getItem("cea.alert.preferences");
      if (stored) setAlertPreferences(JSON.parse(stored) as Record<string, boolean>);
    } catch {
      // Alert preferences are optional.
    }
  }, []);

  const toggleAlert = (key: string, checked: boolean) => {
    setAlertPreferences((current) => {
      const next = { ...current, [key]: checked };
      try {
        localStorage.setItem("cea.alert.preferences", JSON.stringify(next));
      } catch {
        // Alert preferences are optional.
      }
      return next;
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5">
            <Bell className="h-3.5 w-3.5" />
            {t("Alerts", "Alerti")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-2rem)] p-0">
          <div className="border-b border-border/70 p-4">
            <div className="text-sm font-semibold">
              {t("Alert preferences", "Podesavanja alerta")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "Deterministic public-data alerts are prepared locally. Email delivery is not enabled.",
                "Deterministicki alerti iz javnih podataka su pripremljeni lokalno. Email slanje nije ukljuceno.",
              )}
            </p>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-2">
            {alerts.map((alert) => (
              <label
                key={alert.key}
                className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-3 hover:bg-muted/60"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={alertPreferences[alert.key] ?? true}
                  onCheckedChange={(checked) => toggleAlert(alert.key, checked === true)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{alert.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {alert.severity} · {alert.threshold}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{alert.page}</span>
                </span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function AssetEmptyState({ title, description }: { title?: string; description?: string }) {
  const { t } = useLang();
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-surface/50 p-5 text-sm">
      <div className="flex items-start gap-3">
        <Database className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <div className="font-medium">
            {title ?? t("Private asset data required", "Potrebni su privatni podaci asseta")}
          </div>
          <p className="mt-1 text-muted-foreground">
            {description ??
              t(
                "Connect or upload asset data to calculate this metric.",
                "Povezite ili ucitajte podatke asseta da biste izracunali ovu metriku.",
              )}
          </p>
        </div>
      </div>
    </div>
  );
}
