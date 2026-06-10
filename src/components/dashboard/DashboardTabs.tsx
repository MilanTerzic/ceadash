import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/dashboard", label: "Overview" },
  { to: "/dashboard/market", label: "Market Prices" },
  { to: "/dashboard/capture", label: "RES Capture Prices" },
  { to: "/dashboard/calculator", label: "Solar Project Calculator" },
  { to: "/dashboard/insights", label: "Serbia RES Insights" },
  { to: "/dashboard/news", label: "News & Policy" },
  { to: "/dashboard/methodology", label: "Methodology" },
] as const;

export function DashboardTabs() {
  const { pathname } = useLocation();
  return (
    <div className="border-b border-border/60 bg-surface">
      <div className="mx-auto max-w-7xl px-6">
        <nav className="flex gap-1 overflow-x-auto scrollbar-thin -mb-px">
          {TABS.map((t) => {
            const active =
              t.to === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "whitespace-nowrap px-4 py-3 text-sm border-b-2 transition-colors",
                  active
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
