import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";

import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { useLang } from "@/lib/i18n";

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.enum(["7d", "30d", "mtd", "prev_month", "ytd", "custom"]).optional(),
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
  return (
    <div>
      <section className="border-b border-border/60 bg-surface/70">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("CEA Power Dashboard", "CEA Power Dashboard")}
            </div>
            <h1 className="mt-1 font-display text-3xl text-foreground md:text-4xl">
              {t(
                "Serbia Electricity Market Intelligence",
                "Analitika tržišta električne energije Srbije",
              )}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {t(
                "Prices, renewable capture, cross-border signals, project economics and CEA market intelligence in one workspace.",
                "Cene, capture OIE, prekogranični signali, ekonomika projekata i CEA tržišna analitika u jednom radnom prostoru.",
              )}
            </p>
          </div>
        </div>
      </section>
      <DashboardTabs />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </div>
    </div>
  );
}
