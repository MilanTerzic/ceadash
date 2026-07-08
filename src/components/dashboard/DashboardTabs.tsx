import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

export function DashboardTabs() {
  const { pathname } = useLocation();
  const { t } = useLang();
  const TABS = [
    { to: "/dashboard", label: t("Overview", "Pregled") },
    { to: "/dashboard/regional", label: t("Regional Prices", "Regionalne cene") },
    { to: "/dashboard/capture", label: t("RES Capture Prices", "Capture cene OIE") },
    { to: "/dashboard/weekly", label: t("Weekly Intelligence", "Nedeljna analiza") },
    { to: "/dashboard/calculator", label: t("Solar Project Calculator", "Kalkulator solarnog projekta") },
    { to: "/dashboard/insights", label: t("Serbia RES Insights", "OIE uvidi — Srbija") },
    { to: "/dashboard/news", label: t("News & Policy", "Vesti i regulativa") },
    { to: "/dashboard/methodology", label: t("Methodology", "Metodologija") },
  ] as const;
  return (
    <div className="border-b border-border/60 bg-surface">
      <div className="mx-auto max-w-7xl px-6">
        <nav className="flex gap-1 overflow-x-auto scrollbar-thin -mb-px">
          {TABS.map((tab) => {
            const active =
              tab.to === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(tab.to);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "whitespace-nowrap px-4 py-3 text-sm border-b-2 transition-colors",
                  active
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
