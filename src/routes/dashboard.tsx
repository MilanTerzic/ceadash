import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";

import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { DateRangeControl, useDashboardRange } from "@/components/dashboard/DateRangeControl";
import { LoadingBar } from "@/components/dashboard/LoadingBar";

import { DateRangeProvider } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.enum(["today", "d1", "7d", "30d", "mtd", "prev_month", "ytd", "custom"]).optional(),
  asset: z.enum(["solar", "wind", "bess", "hybrid"]).optional(),
});

export const Route = createFileRoute("/dashboard")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Dashboard - CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Live analytical dashboard of renewable energy market signals, capture prices and project economics in Serbia.",
      },
    ],
  }),
  component: DashboardLayout,
});

function DashboardLayout() {
  const { t } = useLang();
  const dashboardRange = useDashboardRange({});
  return (
    <DateRangeProvider range={dashboardRange.rangeKeys} setRange={dashboardRange.setRangeKeys}>
      <div>
        <section className="border-b border-border/60 bg-surface/70">
          <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("CEA Power Dashboard", "CEA Power Dashboard")}
              </div>
              <h1 className="mt-0.5 font-display text-xl font-semibold text-foreground md:text-2xl">
                {t(
                  "Serbia Electricity Market Intelligence",
                  "Analitika tržišta električne energije Srbije",
                )}
              </h1>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                {t(
                  "Prices, renewable capture, cross-border signals, project economics and CEA market intelligence in one workspace.",
                  "Cene, capture OIE, prekogranični signali, ekonomika projekata i CEA tržišna analitika u jednom radnom prostoru.",
                )}
              </p>
            </div>
          </div>
        </section>
        <DashboardTabs />
        <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6">
          <LoadingBar />
          <DateRangeControl maxFutureDays={1} />
          <Outlet />
        </div>

      </div>
    </DateRangeProvider>
  );
}
