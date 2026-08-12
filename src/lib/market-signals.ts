import type { CeaTraderReport } from "@/lib/report.functions";

export type MarketSignalStatus = "Positive" | "Neutral" | "Warning" | "Critical";

export type LocalizedSignalText = {
  en: string;
  sr: string;
};

export type MarketSignal = {
  id: string;
  title: LocalizedSignalText;
  text: LocalizedSignalText;
  metric: LocalizedSignalText;
  signal: MarketSignalStatus;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function priceSignal(value: number): MarketSignalStatus {
  if (value >= 160) return "Critical";
  if (value >= 120) return "Warning";
  if (value <= 70) return "Positive";
  return "Neutral";
}

export function buildMarketSignals(report?: CeaTraderReport | null): MarketSignal[] {
  if (!report) return [];

  const signals: MarketSignal[] = [];
  const rs = report.prices.marketSummary.find((row) => row.zone === "RS");
  const hu = report.prices.marketSummary.find((row) => row.zone === "HU");
  const capture = report.capture.summary;
  const strongestFlow = report.flows.latest24h[0];

  if (finite(rs?.baseload)) {
    signals.push({
      id: "price-level",
      title: { en: "Serbia price level", sr: "Nivo cene u Srbiji" },
      text: {
        en: "The selected-period baseload is classified against simple price-regime thresholds to flag unusually high or low market conditions.",
        sr: "Bazna cena izabranog perioda klasifikuje se prema jednostavnim pragovima kako bi se označili neuobičajeno visoki ili niski tržišni uslovi.",
      },
      metric: {
        en: `RS baseload ${rs.baseload.toFixed(1)} EUR/MWh`,
        sr: `RS bazna cena ${rs.baseload.toFixed(1)} EUR/MWh`,
      },
      signal: priceSignal(rs.baseload),
    });
  }

  if (finite(rs?.baseload) && finite(hu?.baseload)) {
    const spread = rs.baseload - hu.baseload;
    signals.push({
      id: "regional-spread",
      title: { en: "Serbia-Hungary spread", sr: "Spread Srbija-Mađarska" },
      text: {
        en:
          spread >= 0
            ? "Serbia is trading above Hungary on average in the selected period. A wide spread points to regional price dislocation and cross-border value."
            : "Serbia is trading below Hungary on average in the selected period. A wide spread points to regional price dislocation and cross-border value.",
        sr:
          spread >= 0
            ? "Srbija je u proseku skuplja od Mađarske u izabranom periodu. Širi spread ukazuje na regionalnu cenovnu neusklađenost i vrednost prekograničnog kapaciteta."
            : "Srbija je u proseku jeftinija od Mađarske u izabranom periodu. Širi spread ukazuje na regionalnu cenovnu neusklađenost i vrednost prekograničnog kapaciteta.",
      },
      metric: {
        en: `RS-HU ${spread >= 0 ? "+" : ""}${spread.toFixed(1)} EUR/MWh`,
        sr: `RS-HU ${spread >= 0 ? "+" : ""}${spread.toFixed(1)} EUR/MWh`,
      },
      signal: Math.abs(spread) >= 25 ? "Warning" : "Neutral",
    });
  }

  if (rs) {
    const negativeHours = rs.negativeHours;
    signals.push({
      id: "negative-prices",
      title: { en: "Negative-price pressure", sr: "Pritisak negativnih cena" },
      text: {
        en: "Negative-price hours are a direct downside signal for merchant RES and a potential charging window for storage.",
        sr: "Sati sa negativnim cenama direktan su rizik za merchant OIE i potencijalni period punjenja za skladištenje.",
      },
      metric: {
        en: `${negativeHours} negative hour${negativeHours === 1 ? "" : "s"}`,
        sr: `${negativeHours} ${negativeHours === 1 ? "negativan sat" : "negativnih sati"}`,
      },
      signal: negativeHours >= 12 ? "Critical" : negativeHours >= 3 ? "Warning" : negativeHours === 0 ? "Positive" : "Neutral",
    });
  }

  if (finite(capture?.solarCaptureRate)) {
    const rate = capture.solarCaptureRate;
    signals.push({
      id: "solar-capture",
      title: { en: "Solar capture", sr: "Solarni capture" },
      text: {
        en: "Solar capture rate measures realised solar-weighted power value relative to baseload and highlights cannibalisation risk.",
        sr: "Solarni capture rate meri realizovanu vrednost solarne proizvodnje u odnosu na baznu cenu i ukazuje na rizik kanibalizacije.",
      },
      metric: {
        en: `Solar capture ${(rate * 100).toFixed(0)}% of baseload`,
        sr: `Solarni capture ${(rate * 100).toFixed(0)}% bazne cene`,
      },
      signal: rate < 0.75 ? "Critical" : rate < 0.88 ? "Warning" : rate >= 0.95 ? "Positive" : "Neutral",
    });
  }

  if (finite(capture?.bessNet4h)) {
    const spread = capture.bessNet4h;
    signals.push({
      id: "bess-spread",
      title: { en: "4h BESS spread", sr: "4h BESS spread" },
      text: {
        en: "Indicative daily 4-hour storage spread after applying 85% discharge efficiency. It is a market signal, not a project-margin forecast.",
        sr: "Indikativni dnevni 4-časovni spread skladištenja uz 85% efikasnosti pražnjenja. Ovo je tržišni signal, a ne prognoza projektne marže.",
      },
      metric: {
        en: `${spread.toFixed(1)} EUR/MWh indicative net spread`,
        sr: `${spread.toFixed(1)} EUR/MWh indikativni neto spread`,
      },
      signal: spread >= 50 ? "Positive" : spread < 0 ? "Warning" : "Neutral",
    });
  }

  if (strongestFlow && finite(strongestFlow.absMw)) {
    const imports = strongestFlow.direction.endsWith("-> RS");
    signals.push({
      id: "physical-flow",
      title: { en: "Strongest physical flow", sr: "Najjači fizički tok" },
      text: {
        en: imports
          ? "The largest observed Serbia-border period-average flow is toward Serbia, indicating import support on that route."
          : "The largest observed Serbia-border period-average flow is away from Serbia, indicating export pressure on that route.",
        sr: imports
          ? "Najveći prosečni prekogranični tok u periodu ide ka Srbiji, što ukazuje na uvoznu podršku na toj ruti."
          : "Najveći prosečni prekogranični tok u periodu ide iz Srbije, što ukazuje na izvozni pritisak na toj ruti.",
      },
      metric: {
        en: `${strongestFlow.direction} ${strongestFlow.absMw.toFixed(0)} MW`,
        sr: `${strongestFlow.direction} ${strongestFlow.absMw.toFixed(0)} MW`,
      },
      signal: strongestFlow.absMw >= 500 ? (imports ? "Warning" : "Positive") : "Neutral",
    });
  }

  return signals;
}
