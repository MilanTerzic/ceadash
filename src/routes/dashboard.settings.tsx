import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { Button } from "@/components/ui/button";
import { validatePriceMarkets } from "@/lib/data.functions";
import { PRICE_MARKETS, type PriceMarketCode } from "@/lib/price-markets";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/settings")({
  head: () => ({
    meta: [
      { title: "Data Sources and Status - CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Public status view for CEA Power Dashboard data providers, cache state and configuration requirements.",
      },
    ],
  }),
  component: DataSourcesPage,
});

function DataSourcesPage() {
  const { t } = useLang();
  const validateFn = useServerFn(validatePriceMarkets);
  const q = useQuery({
    queryKey: ["data-source-status"],
    queryFn: () => validateFn({ data: {} }),
    staleTime: 15 * 60_000,
    retry: 1,
  });

  const rows = q.data?.rows ?? [];
  const configured = rows.filter((row) => row.source === "live" || row.source === "cache").length;

  return (
    <>
      <TopBar
        title={t("Data Sources and Status", "Izvori podataka i status")}
        subtitle={t(
          "Provider availability, cache health and configuration checks for public market analytics.",
          "Dostupnost provajdera, stanje keša i provere konfiguracije za javnu tržišnu analitiku.",
        )}
        hideRange
        dataHealth={rows.length ? `${configured}/${rows.length}` : undefined}
        onRefresh={() => q.refetch()}
        isRefreshing={q.isFetching}
      />
      <div className="space-y-5 p-4 md:p-6">
        <Panel
          title={t("Public data-provider status", "Status javnih izvora podataka")}
          actions={
            <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
              {t("Refresh", "Osveži")}
            </Button>
          }
        >
          <p className="mb-4 text-sm text-muted-foreground">
            {t(
              "This page checks public market-data inputs without exposing server-side tokens, Supabase credentials or provider secrets.",
              "Ova stranica proverava ulazne podatke bez prikazivanja server-side tokena, Supabase kredencijala ili tajni provajdera.",
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2">{t("Dataset", "Skup podataka")}</th>
                  <th>{t("Provider", "Provajder")}</th>
                  <th>{t("Status", "Status")}</th>
                  <th className="text-right">{t("Intervals", "Intervali")}</th>
                  <th>{t("Coverage", "Pokrivenost")}</th>
                  <th>{t("Reason", "Razlog")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const market = PRICE_MARKETS[row.market as PriceMarketCode];
                  return (
                    <tr key={row.market} className="border-t border-border/60">
                      <td className="py-2 font-medium">
                        {market?.displayLabel ?? row.market}
                        <span className="ml-2 text-xs text-muted-foreground">{row.market}</span>
                      </td>
                      <td>ENTSO-E Transparency Platform</td>
                      <td>
                        <DataBadge source={row.source} />
                      </td>
                      <td className="text-right tabular-nums">{row.intervals}</td>
                      <td className="text-xs text-muted-foreground">
                        {row.firstTimestamp && row.lastTimestamp
                          ? `${row.firstTimestamp.slice(0, 16)} -> ${row.lastTimestamp.slice(0, 16)}`
                          : t("Unavailable", "Nedostupno")}
                      </td>
                      <td className="text-xs text-muted-foreground">{row.reason ?? ""}</td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {q.isLoading
                        ? t("Checking data sources...", "Provera izvora podataka...")
                        : t(
                            "No status rows are available. Check ENTSOE_API_TOKEN or ENTSOE_SECURITY_TOKEN on the server.",
                            "Nema dostupnih statusnih redova. Proverite ENTSOE_API_TOKEN ili ENTSOE_SECURITY_TOKEN na serveru.",
                          )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel title={t("Status definitions", "Definicije statusa")}>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                <DataBadge source="live" />{" "}
                {t(
                  "Fresh provider response was available.",
                  "Dostupan je svež odgovor provajdera.",
                )}
              </p>
              <p>
                <DataBadge source="cache" />{" "}
                {t("A cached server-side response is being used.", "Koristi se server-side keš.")}
              </p>
              <p>
                <DataBadge source="empty" />{" "}
                {t(
                  "No live or cached dataset is available for the checked period.",
                  "Nema live ili keširanih podataka za provereni period.",
                )}
              </p>
            </div>
          </Panel>
          <Panel title={t("Limitations", "Ograničenja")}>
            <p className="text-sm text-muted-foreground">
              {t(
                "Unavailable futures, outage, hydrology or weather inputs are shown explicitly on their pages. CEA does not substitute demo values as live market data.",
                "Nedostupni futures, outage, hidrološki ili vremenski ulazi se eksplicitno prikazuju na odgovarajućim stranicama. CEA ne zamenjuje demo vrednosti live tržišnim podacima.",
              )}
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
