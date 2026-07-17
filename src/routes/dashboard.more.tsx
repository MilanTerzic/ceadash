import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, Database, Info, Settings } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";

const moreSearch = z.object({
  tab: z.enum(["methodology", "data", "settings", "about"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.enum(["today", "d1", "7d", "30d", "mtd", "prev_month", "ytd", "custom"]).optional(),
});

export const Route = createFileRoute("/dashboard/more")({
  validateSearch: (search) => moreSearch.parse(search),
  head: () => ({ meta: [{ title: "More - CEA Power Dashboard" }] }),
  component: MorePage,
});

function MorePage() {
  const { t } = useLang();
  const { range } = useDateRange();
  const cards = [
    {
      title: t("Methodology", "Metodologija"),
      text: t(
        "Calculation methods, unit conventions, data transformations and caveats.",
        "Metode obracuna, jedinice, transformacije podataka i ogranicenja.",
      ),
      icon: BookOpen,
      tab: "methodology",
    },
    {
      title: t("Data Sources", "Izvori podataka"),
      text: t(
        "ENTSO-E, public futures snapshots, weather and other source notes.",
        "ENTSO-E, javni futures snapshot, vreme i napomene o izvorima.",
      ),
      icon: Database,
      tab: "data",
    },
    {
      title: t("Settings", "Podesavanja"),
      text: t(
        "Language, display and dashboard configuration.",
        "Jezik, prikaz i konfiguracija dashboard-a.",
      ),
      icon: Settings,
      tab: "settings",
    },
    {
      title: t("About the dashboard", "O dashboard-u"),
      text: t(
        "Public electricity-market intelligence platform by CEA.",
        "Javna platforma za power market intelligence od CEA.",
      ),
      icon: Info,
      tab: "about",
    },
  ] as const;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold">{t("More", "Vise")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t(
            "Methodology, data status, settings and dashboard context are grouped here so technical detail stays out of business KPIs.",
            "Metodologija, status podataka, podesavanja i kontekst dashboard-a grupisani su ovde kako tehnicki detalji ne bi dominirali poslovnim KPI karticama.",
          )}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="rounded-lg border border-border/70 bg-card p-5">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-base font-semibold">{card.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{card.text}</p>
              <Button asChild variant="ghost" className="mt-3 px-0">
                <Link
                  to="/dashboard/more"
                  search={{
                    tab: card.tab,
                    preset: "custom",
                    from: range.from,
                    to: range.to,
                  }}
                >
                  {t("Open", "Otvori")}
                </Link>
              </Button>
            </div>
          );
        })}
      </section>

      <section className="rounded-lg border border-border/70 bg-card p-5">
        <h3 className="text-lg font-semibold">{t("Progressive detail", "Postepeni detalji")}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Legacy methodology, settings and data-status URLs redirect here. Technical diagnostics and source notes are intentionally grouped away from primary business KPIs.",
            "Legacy URL-ovi za metodologiju, podesavanja i status podataka vode ovde. Tehnicka dijagnostika i napomene o izvorima su namerno odvojene od primarnih poslovnih KPI kartica.",
          )}
        </p>
      </section>
    </div>
  );
}
