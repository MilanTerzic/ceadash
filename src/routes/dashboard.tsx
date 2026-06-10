import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — CEA Power Dashboard" },
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
      <section className="bg-surface border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex items-baseline justify-between gap-6 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                {t("CEA Analytical Tool", "CEA analitički alat")}
              </div>
              <h1 className="mt-1 font-display text-4xl md:text-5xl text-foreground">
                CEA Power Dashboard
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                {t(
                  "An analytical tool for tracking renewable energy market signals, capture prices and project economics in Serbia.",
                  "Analitički alat za praćenje signala tržišta obnovljivih izvora energije, capture cena i ekonomike projekata u Srbiji.",
                )}
              </p>
            </div>
          </div>
        </div>
      </section>
      <DashboardTabs />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </div>
    </div>
  );
}

