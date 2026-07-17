import { ChevronDown, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { downloadCSV, fmtNum } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import type { MonthlyCaptureRow } from "./producer-analytics";

function numberOrBlank(value: number | null, multiplier = 1) {
  return value == null || !Number.isFinite(value) ? null : value * multiplier;
}

function display(value: number | null, digits = 1, suffix = "") {
  return value == null || !Number.isFinite(value) ? "N/A" : `${fmtNum(value, digits)}${suffix}`;
}

export function MonthlyCaptureTable({ rows }: { rows: MonthlyCaptureRow[] }) {
  const { t } = useLang();
  const exportRows = rows.map((row) => ({
    month: row.month,
    baseload_eur_per_mwh: numberOrBlank(row.baseloadEurPerMWh),
    solar_capture_eur_per_mwh: numberOrBlank(row.solarCaptureEurPerMWh),
    solar_capture_rate_pct: numberOrBlank(row.solarCaptureRate, 100),
    solar_negative_exposure_pct: numberOrBlank(row.solarNegativeExposure, 100),
    wind_capture_eur_per_mwh: numberOrBlank(row.windCaptureEurPerMWh),
    wind_capture_rate_pct: numberOrBlank(row.windCaptureRate, 100),
    wind_negative_exposure_pct: numberOrBlank(row.windNegativeExposure, 100),
    bess_2h_net_spread_eur_per_mwh: numberOrBlank(row.bess.avgNet2),
    bess_4h_net_spread_eur_per_mwh: numberOrBlank(row.bess.avgNet4),
    price_hours: row.priceHours,
    solar_hours: row.solarHours,
    wind_hours: row.windHours,
    coverage_pct: row.coveragePct,
    solar_source: row.solarSource,
  }));

  return (
    <details open className="group rounded-lg border border-border/70 bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold">
            {t("Monthly capture detail", "Mesecni capture detalji")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              "Numeric base values remain available in the CSV export.",
              "Numericke bazne vrednosti ostaju dostupne u CSV izvozu.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={!rows.length}
            onClick={(event) => {
              event.preventDefault();
              downloadCSV("serbia-producer-monthly-capture.csv", exportRows);
            }}
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="overflow-x-auto border-t border-border/70">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">{t("Month", "Mesec")}</th>
              <th className="px-4 py-3 text-right">
                Baseload
                <br />
                EUR/MWh
              </th>
              <th className="px-4 py-3 text-right">
                Solar capture
                <br />
                EUR/MWh
              </th>
              <th className="px-4 py-3 text-right">{t("Solar rate", "Solarna stopa")}</th>
              <th className="px-4 py-3 text-right">{t("Solar negative", "Solar negativno")}</th>
              <th className="px-4 py-3 text-right">
                Wind capture
                <br />
                EUR/MWh
              </th>
              <th className="px-4 py-3 text-right">{t("Wind rate", "Stopa vetra")}</th>
              <th className="px-4 py-3 text-right">{t("Wind negative", "Vetar negativno")}</th>
              <th className="px-4 py-3 text-right">
                BESS 2h net
                <br />
                EUR/MWh
              </th>
              <th className="px-4 py-3 text-right">
                BESS 4h net
                <br />
                EUR/MWh
              </th>
              <th className="px-4 py-3 text-right">{t("Coverage", "Pokrivenost")}</th>
              <th className="px-4 py-3">{t("Source", "Izvor")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.month} className="border-t border-border/60">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{row.month}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {display(row.baseloadEurPerMWh)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {display(row.solarCaptureEurPerMWh)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {display(numberOrBlank(row.solarCaptureRate, 100), 1, "%")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {display(numberOrBlank(row.solarNegativeExposure, 100), 1, "%")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {display(row.windCaptureEurPerMWh)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {display(numberOrBlank(row.windCaptureRate, 100), 1, "%")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {display(numberOrBlank(row.windNegativeExposure, 100), 1, "%")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{display(row.bess.avgNet2)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{display(row.bess.avgNet4)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {display(row.coveragePct, 1, "%")}
                  </td>
                  <td className="px-4 py-3">
                    {row.solarSource === "modelled"
                      ? t("Modelled solar / measured wind", "Modelovano sunce / meren vetar")
                      : t("ENTSO-E measured", "ENTSO-E mereno")}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-muted-foreground">
                  {t(
                    "No monthly data for the selected period.",
                    "Nema mesecnih podataka za period.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
