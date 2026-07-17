import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, FileChartColumn, Image, Newspaper } from "lucide-react";
import { z } from "zod";

import { AssetEmptyState } from "@/components/dashboard/WorkspaceSelectors";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";

const reportsSearch = z.object({
  tab: z.enum(["overview", "cea", "signals", "news"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.enum(["today", "d1", "7d", "30d", "mtd", "prev_month", "ytd", "custom"]).optional(),
});

export const Route = createFileRoute("/dashboard/reports")({
  validateSearch: (search) => reportsSearch.parse(search),
  head: () => ({ meta: [{ title: "Reports - CEA Power Dashboard" }] }),
  component: ReportsPage,
});

const reportTypes = [
  ["CEA Market Report", "CEA trzisni izvestaj", "Public Serbia and regional market summary."],
  [
    "Weekly Power Market Brief",
    "Nedeljni power market brief",
    "Prepared weekly market narrative and signals.",
  ],
  [
    "RES Producer Report",
    "Izvestaj za OIE proizvodjaca",
    "Requires production profile for revenue and imbalance metrics.",
  ],
  [
    "Consumer Cost Report",
    "Izvestaj troska za potrosaca",
    "Requires consumption and contract data.",
  ],
  [
    "VPP Flexibility Report",
    "VPP izvestaj fleksibilnosti",
    "Requires flexible-asset portfolio data.",
  ],
  ["Investor Summary", "Investitorski pregled", "Requires project assumptions."],
  [
    "LinkedIn Chart of the Week",
    "LinkedIn grafikon nedelje",
    "Export-ready public visual summary.",
  ],
];

function ReportsPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { range } = useDateRange();
  const activeTab = search.tab ?? "overview";
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold">{t("Reports", "Izvestaji")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t(
            "Report landing page with public market report outputs and clear private-data requirements for stakeholder-specific reports.",
            "Polazna strana za izvestaje sa javnim trzisnim izvestajima i jasnim zahtevima za privatne podatke kod izvestaja po tipu korisnika.",
          )}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reportTypes.map(([title, sr, description]) => (
          <div key={title} className="rounded-lg border border-border/70 bg-card p-5">
            <FileChartColumn className="h-5 w-5 text-primary" />
            <h3 className="mt-3 text-base font-semibold">{t(title, sr)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{t("Export tools", "Alati za izvoz")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "CSV, print and image exports remain available on implemented report views.",
                "CSV, print i image export ostaju dostupni na implementiranim prikazima izvestaja.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={activeTab === "cea" ? "default" : "outline"}
              className="gap-2"
              onClick={() =>
                navigate({
                  to: "/dashboard/reports",
                  search: {
                    ...search,
                    tab: "cea",
                    preset: "custom",
                    from: range.from,
                    to: range.to,
                  },
                })
              }
            >
              <Newspaper className="h-4 w-4" />
              {t("CEA report preview", "Pregled CEA izvestaja")}
            </Button>
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" className="gap-2">
              <Image className="h-4 w-4" />
              JPEG
            </Button>
          </div>
        </div>
      </section>

      {activeTab === "cea" ? (
        <section className="rounded-lg border border-border/70 bg-card p-5">
          <h3 className="text-lg font-semibold">
            {t("CEA Market Report preview", "Pregled CEA trzisnog izvestaja")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              "The consolidated report keeps the existing public market summary, regional prices, capture-price signals, BESS spread, physical-flow context, deterministic desk summary and export formats. Private report sections remain disabled until the required asset data is supplied.",
              "Konsolidovani izvestaj zadrzava javni trzisni pregled, regionalne cene, capture signale, BESS spread, kontekst fizickih tokova, deterministicki desk summary i export formate. Privatne sekcije ostaju iskljucene dok se ne dostave potrebni asset podaci.",
            )}
          </p>
        </section>
      ) : null}

      <AssetEmptyState description="Producer, consumer, VPP and investor reports require production, consumption, asset or project-assumption data before private financial results can be calculated." />
    </div>
  );
}
