import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, CloudSun, Droplets, Factory, LineChart, TrendingUp } from "lucide-react";

import { AssetEmptyState } from "@/components/dashboard/WorkspaceSelectors";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/markets/outlook")({
  head: () => ({ meta: [{ title: "Forwards & Outlook - CEA Power Dashboard" }] }),
  component: OutlookPage,
});

const outlookCards = [
  {
    title: "Forward curve",
    sr: "Forward kriva",
    icon: TrendingUp,
    text: "Public EEX/PXE snapshots, front-month, quarter and year references.",
    srText: "Javni EEX/PXE snapshot, front-month, kvartalni i godisnji referentni proizvodi.",
  },
  {
    title: "Forecast drivers",
    sr: "Faktori prognoze",
    icon: LineChart,
    text: "Statistical forecast inputs and transparent model diagnostics.",
    srText: "Ulazi statisticke prognoze i transparentna dijagnostika modela.",
  },
  {
    title: "Weather",
    sr: "Vreme",
    icon: CloudSun,
    text: "Temperature, demand and renewable-production context.",
    srText: "Temperatura, potraznja i kontekst OIE proizvodnje.",
  },
  {
    title: "Outages",
    sr: "Ispadi",
    icon: Factory,
    text: "Generation unavailability as a bullish, bearish or neutral factor.",
    srText: "Nedostupnost proizvodnje kao bullish, bearish ili neutralan faktor.",
  },
  {
    title: "Hydrology",
    sr: "Hidrologija",
    icon: Droplets,
    text: "Danube discharge and hydro-related market signals.",
    srText: "Protok Dunava i hidro signali trzista.",
  },
  {
    title: "Data status",
    sr: "Status podataka",
    icon: Activity,
    text: "Public snapshot · Not real time. Methodology and provider details are kept compact.",
    srText: "Javni snapshot · Nije real-time. Metodologija i provajderi su kompaktno prikazani.",
  },
];

function OutlookPage() {
  const { t } = useLang();
  const { range } = useDateRange();
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold">
          {t("Forwards & Outlook", "Terminske cene i izgledi")}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t(
            "A consolidated fundamentals view for futures, forecasts, weather, outages and hydrology. Unsupported trading recommendations are not generated.",
            "Konsolidovani pregled fundamenta za futures, prognoze, vreme, ispade i hidrologiju. Nepodrzane trgovacke preporuke se ne generisu.",
          )}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {outlookCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="rounded-lg border border-border/70 bg-card p-5">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-base font-semibold">{t(card.title, card.sr)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(card.text, card.srText)}</p>
            </div>
          );
        })}
      </section>

      <AssetEmptyState
        title={t("Compact public-snapshot notice", "Kompaktno obavestenje o javnom snapshot-u")}
        description={t(
          "Futures data remains a public snapshot and is not presented as licensed real-time data. Historical change calculations are shown only where source history exists.",
          "Futures podaci ostaju javni snapshot i ne predstavljaju se kao licencirani real-time podaci. Promene kroz istoriju se prikazuju samo kada izvor ima istoriju.",
        )}
      />

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link
            to="/dashboard/reports"
            search={{ preset: "custom", from: range.from, to: range.to }}
          >
            {t("Open reports", "Otvori izvestaje")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link
            to="/dashboard/markets/system"
            search={{ preset: "custom", from: range.from, to: range.to }}
          >
            {t("Open system signals", "Otvori sistemske signale")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
