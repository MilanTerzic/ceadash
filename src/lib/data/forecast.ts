import { createServerFn } from "@tanstack/react-start";
import { fetchDayAheadPrices, fetchOutages, fetchLoadGen } from "../entsoe.server";
import { fetchWeather, fetchRiverDischarge } from "../openmeteo.server";
import { DANUBE_STATION_COORDS } from "../markets";
import { forecastPrices } from "../forecast";
import { fetchEexFutures, type EexProduct } from "../eex.server";
import {
  toDaily,
  toWeekly,
  toMonthly,
  arForecast,
  buildForecastPoints,
  blend,
  forecastDA,
  filterByLoadType,
  type Product,
  type LoadType,
  type Driver,
} from "../forecast-multi";
import { todayISO, offsetISO } from "./shared";

export const runForecast = createServerFn({ method: "GET" })
  .inputValidator((data: { horizon_h: number; history_days: number }) => data)
  .handler(async ({ data }) => {
    const histDays = Math.max(7, Math.min(365, data.history_days));
    const horizon = Math.max(1, Math.min(14 * 24, data.horizon_h));
    const today = new Date();
    const all: Array<{ ts: string; price: number }> = [];
    for (let i = histDays; i > 0; i--) {
      const day = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
      const r = await fetchDayAheadPrices("RS", day);
      all.push(...r.data.points);
    }
    return { ...forecastPrices(all, horizon), training_days: histDays };
  });

export { offsetISO, todayISO };

// ---- Multi-product SEEPEX forecast (DA / Week / Month) ----------------------
interface ForecastV2Input {
  product: Product;
  horizon: number; // DA: hours; week: weeks; month: months
  history_from?: string; // ISO date; default 2024-01-01
  history_to?: string; // optional cutoff (for backtest); default today
  load_type?: LoadType; // default baseload
  use_fundamentals?: boolean;
}

async function fetchSeepexHistory(
  fromISO: string,
  toISO: string,
  maxDays = 180,
): Promise<Array<{ ts: string; price: number }>> {
  const from = new Date(fromISO + "T00:00:00Z").getTime();
  const to = new Date(toISO + "T00:00:00Z").getTime();
  const days: string[] = [];
  for (let t = from; t <= to; t += 86400_000) days.push(new Date(t).toISOString().slice(0, 10));
  // Cap range to keep server function under the worker timeout.
  const useDays = days.length > maxDays ? days.slice(-maxDays) : days;
  const BATCH = 60;
  const out: Array<{ ts: string; price: number }> = [];
  for (let i = 0; i < useDays.length; i += BATCH) {
    const chunk = useDays.slice(i, i + BATCH);
    const res = await Promise.all(
      chunk.map((d) =>
        fetchDayAheadPrices("RS", d).catch(() => ({
          data: { points: [] as Array<{ ts: string; price: number }> },
        })),
      ),
    );
    for (const r of res) out.push(...r.data.points);
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

export const runForecastV2 = createServerFn({ method: "GET" })
  .inputValidator((data: ForecastV2Input) => data)
  .handler(async ({ data }) => {
    const product = data.product;
    const historyFrom =
      data.history_from && /^\d{4}-\d{2}-\d{2}$/.test(data.history_from)
        ? data.history_from
        : "2024-01-01";
    const historyTo =
      data.history_to && /^\d{4}-\d{2}-\d{2}$/.test(data.history_to) ? data.history_to : todayISO();
    const loadType: LoadType = data.load_type ?? "baseload";
    const useFund = data.use_fundamentals ?? true;
    const horizon = Math.max(
      1,
      Math.min(product === "da" ? 14 * 24 : product === "week" ? 8 : 6, data.horizon),
    );

    const warnings: string[] = [];

    // 1. Fetch SEEPEX history, fundamentals, and EEX in parallel.
    const maxDays = 365;
    const historyP = fetchSeepexHistory(historyFrom, historyTo, maxDays);

    const balanceP = useFund
      ? fetchLoadGen("RS", historyTo).catch(() => null)
      : Promise.resolve(null);
    const outagesP = useFund
      ? fetchOutages("RS", historyTo).catch(() => null)
      : Promise.resolve(null);
    // Use Zemun (Belgrade area) as the Danube reference station.
    const danubeStation = DANUBE_STATION_COORDS["Zemun"];
    const danubeP =
      useFund && danubeStation
        ? fetchRiverDischarge(
            danubeStation.lat,
            danubeStation.lon,
            new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10),
            historyTo,
          ).catch(() => null)
        : Promise.resolve(null);
    const weatherP = useFund
      ? fetchWeather("RS", historyTo).catch(() => null)
      : Promise.resolve(null);
    const eexP = fetchEexFutures().catch(() => ({
      source: "unavailable" as const,
      reason: "fetch failed",
      anchor_zone: "HU" as const,
      prices: [] as Array<{
        zone: "HU" | "CZ" | "PL" | "SK";
        product: EexProduct;
        period_label: string;
        price_eur_mwh: number;
        fetched_at: string;
      }>,
      fetched_at: new Date().toISOString(),
    }));

    const [history, balance, outRes, danube, wx, eex] = await Promise.all([
      historyP,
      balanceP,
      outagesP,
      danubeP,
      weatherP,
      eexP,
    ]);

    if (!history.length) {
      return {
        product,
        loadType,
        horizon,
        historyFrom,
        historyTo,
        error: "SEEPEX history unavailable for the selected range.",
        warnings,
        history: [],
        forecast: [],
        drivers: [],
        diagnostics: null,
        latest_actual: null,
        eex: {
          source: "unavailable",
          reason: "skipped",
          prices: [],
          fetched_at: new Date().toISOString(),
        },
        eex_anchor: null,
        weights: { stat: 1, eex: 0, fund: 0 },
        fundamental_adj: 0,
      };
    }
    const latest = history[history.length - 1];

    // 2. Build driver cards from the fundamentals fetched above.
    const drivers: Driver[] = [];
    let fundamentalAdj = 0;

    if (useFund) {
      if (balance?.data?.length) {
        const last = balance.data.slice(-24);
        const avgLoad = last.reduce((s, p) => s + (p.load_mw ?? 0), 0) / Math.max(1, last.length);
        const prevDay = balance.data.slice(-48, -24);
        const prevLoad =
          prevDay.reduce((s, p) => s + (p.load_mw ?? 0), 0) / Math.max(1, prevDay.length);
        const delta = prevLoad ? (avgLoad - prevLoad) / prevLoad : 0;
        drivers.push({
          key: "load",
          label: "Load trend (RS, last 24h vs prev)",
          value: `${avgLoad.toFixed(0)} MW`,
          trend: delta > 0.02 ? "up" : delta < -0.02 ? "down" : "flat",
          impact: delta > 0.02 ? "bullish" : delta < -0.02 ? "bearish" : "neutral",
          explain: `${(delta * 100).toFixed(1)}% vs previous day`,
        });
        fundamentalAdj += delta * 8;
      } else {
        drivers.push({
          key: "load",
          label: "Load",
          value: "—",
          trend: "flat",
          impact: "neutral",
          explain: "no data",
        });
      }

      if (outRes?.data?.length) {
        const total = outRes.data.reduce((sum, outage) => {
          return sum + (outage.unavailable_mw ?? 0);
        }, 0);
        drivers.push({
          key: "outages",
          label: "Generation outages (RS)",
          value: `${total.toFixed(0)} MW unavailable`,
          trend: total > 500 ? "up" : "flat",
          impact: total > 500 ? "bullish" : "neutral",
          explain: `${outRes.data.length} active outage records`,
        });
        fundamentalAdj += Math.min(8, total / 250);
      } else {
        drivers.push({
          key: "outages",
          label: "Outages",
          value: "—",
          trend: "flat",
          impact: "neutral",
          explain: "no data",
        });
      }

      const series = (danube?.data ?? [])
        .map((d) => d.discharge_m3s)
        .filter((v): v is number => Number.isFinite(v));
      if (series.length >= 2) {
        const last = series[series.length - 1];
        const avg = series.reduce((a, b) => a + b, 0) / series.length;
        const dev = avg > 0 ? (last - avg) / avg : 0;
        drivers.push({
          key: "danube",
          label: "Danube discharge (Belgrade, 7d)",
          value: `${last.toFixed(0)} m³/s`,
          trend: dev > 0.05 ? "up" : dev < -0.05 ? "down" : "flat",
          impact: dev > 0.05 ? "bearish" : dev < -0.05 ? "bullish" : "neutral",
          explain: `${(dev * 100).toFixed(1)}% vs 7d avg (more water → more hydro → softer prices)`,
        });
        fundamentalAdj += -dev * 5;
      } else {
        drivers.push({
          key: "danube",
          label: "Danube",
          value: "—",
          trend: "flat",
          impact: "neutral",
          explain: "no data",
        });
      }

      const temps = (wx?.data ?? [])
        .map((p) => p.temp_c)
        .filter((v): v is number => Number.isFinite(v));
      if (temps.length) {
        const t = Math.max(...temps);
        const baseTemp = 18;
        const dd = t < baseTemp ? baseTemp - t : t - 24;
        drivers.push({
          key: "weather",
          label: "Belgrade peak temp (today)",
          value: `${t.toFixed(1)} °C`,
          trend: t > 26 ? "up" : t < 5 ? "up" : "flat",
          impact: dd > 5 ? "bullish" : "neutral",
          explain:
            dd > 5 ? `Strong ${t < baseTemp ? "heating" : "cooling"} demand` : "Mild conditions",
        });
        fundamentalAdj += Math.max(0, dd - 5) * 0.5;
      } else {
        drivers.push({
          key: "weather",
          label: "Weather",
          value: "—",
          trend: "flat",
          impact: "neutral",
          explain: "no data",
        });
      }
    }

    // Calendar driver (always available)
    const today = new Date(historyTo);
    const isWeekend = today.getUTCDay() === 0 || today.getUTCDay() === 6;
    drivers.push({
      key: "calendar",
      label: "Calendar",
      value: isWeekend ? "Weekend" : "Weekday",
      trend: "flat",
      impact: isWeekend ? "bearish" : "neutral",
      explain: isWeekend
        ? "Weekend demand typically lower"
        : `Month ${today.getUTCMonth() + 1}, weekday`,
    });

    // 3. EEX/PXE futures anchor (Hungary baseload = proxy for SEEPEX)
    //    Maps DA→front month, week→front month, month→front month, with
    //    fallback to nearest quarter / Cal if month row is missing.
    const anchorZone = eex.anchor_zone ?? "HU";
    const anchorRows = eex.prices.filter((p) => p.zone === anchorZone);
    const pickAnchor = (): { price: number; label: string } | null => {
      const order: EexProduct[] =
        product === "month" || product === "week" || product === "da"
          ? ["month", "quarter", "year"]
          : ["year", "quarter", "month"];
      for (const prod of order) {
        const row = anchorRows.find((p) => p.product === prod);
        if (row) return { price: row.price_eur_mwh, label: `${row.zone} ${row.period_label}` };
      }
      return null;
    };
    const liveAnchor = pickAnchor();
    const liveEexAnchor = liveAnchor?.price ?? null;
    const eexFresh = eex.source !== "unavailable" && liveEexAnchor != null;
    // Synthetic fallback: weighted mean of last 30d (60%) + last 365d (40%).
    let syntheticAnchor: number | null = null;
    {
      const filt = filterByLoadType(history, loadType).map((p) => p.price);
      if (filt.length >= 24) {
        const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
        const recent = filt.slice(-24 * 30);
        const long = filt.slice(-24 * 365);
        syntheticAnchor = 0.6 * mean(recent) + 0.4 * mean(long);
      }
    }
    const eexAnchor = liveEexAnchor ?? syntheticAnchor;
    if (liveEexAnchor != null && liveAnchor) {
      warnings.push(
        `Anchor: PXE ${liveAnchor.label} = €${liveEexAnchor.toFixed(2)}/MWh (HU baseload proxy).`,
      );
    } else {
      warnings.push(
        syntheticAnchor != null
          ? `PXE/EEX futures unavailable — using synthetic anchor from SEEPEX history (€${syntheticAnchor.toFixed(2)}/MWh).`
          : "PXE/EEX futures unavailable — using statistical-only forecast.",
      );
    }

    // 4. Build forecast per product
    const filteredHist = filterByLoadType(history, loadType);
    let statisticalForecast: number[] = [];
    let forecastPts: Array<{
      ts: string;
      forecast: number;
      lo80: number;
      hi80: number;
      blended?: number;
    }> = [];
    let model = "sarima_lite";
    let mae: number | undefined;
    let mape: number | undefined;
    let statConf: "low" | "medium" | "high" = "low";

    if (product === "da") {
      const r = forecastDA(filteredHist, horizon);
      statisticalForecast = r.forecast.map((p) => p.forecast);
      forecastPts = r.forecast;
      model = r.model;
      mae = r.mae;
      mape = r.mape;
      statConf =
        filteredHist.length > 24 * 90 ? "high" : filteredHist.length > 24 * 30 ? "medium" : "low";
      warnings.push(...r.warnings);
    } else {
      const daily = toDaily(history, loadType);
      const series = product === "week" ? toWeekly(daily) : toMonthly(daily);
      const values = series.map((s) => s.price);
      if (values.length < 4) {
        warnings.push(
          `Only ${values.length} ${product}ly observations — using last value as flat forecast.`,
        );
        const last = values[values.length - 1] ?? 0;
        statisticalForecast = Array.from({ length: horizon }, () => last);
        forecastPts = buildForecastPoints(
          series[series.length - 1]?.ts ?? new Date().toISOString(),
          product === "week" ? 7 : 30,
          statisticalForecast,
          5,
        );
        model = "rolling_mean";
      } else {
        const { fc, resid_std } = arForecast(values, horizon);
        statisticalForecast = fc;
        forecastPts = buildForecastPoints(
          series[series.length - 1].ts,
          product === "week" ? 7 : 30,
          fc,
          resid_std,
        );
        model = "ar1_drift";
        statConf = values.length >= 24 ? "high" : values.length >= 12 ? "medium" : "low";
        // Naive backtest: hold-out last 4 obs
        if (values.length >= 8) {
          const train = values.slice(0, -4);
          const test = values.slice(-4);
          const bt = arForecast(train, 4);
          const errs = test.map((t, i) => Math.abs(t - bt.fc[i]));
          mae = errs.reduce((a, b) => a + b, 0) / errs.length;
          const pcts = test.map((t, i) => (Math.abs(t) > 0.1 ? Math.abs((t - bt.fc[i]) / t) : 0));
          const valid = pcts.filter((_, i) => Math.abs(test[i]) > 0.1).length;
          mape = valid ? (pcts.reduce((a, b) => a + b, 0) / valid) * 100 : undefined;
        }
      }
    }

    // 5. Blend with EEX + fundamentals
    const { blended, weights } = blend({
      statistical: statisticalForecast,
      eexAnchor,
      fundamentalAdj,
      // Treat synthetic anchor as a soft anchor (lower weight) when EEX is down.
      eexFresh: eexAnchor != null && (eexFresh || syntheticAnchor != null),
      statConfidence: statConf,
    });
    forecastPts = forecastPts.map((p, i) => ({ ...p, blended: blended[i] }));

    return {
      product,
      loadType,
      horizon,
      historyFrom,
      historyTo,
      history: history.slice(-Math.min(history.length, product === "da" ? 24 * 30 : 365 * 2)),
      forecast: forecastPts,
      latest_actual: { ts: latest.ts, price: latest.price },
      eex,
      eex_anchor: eexAnchor,
      drivers,
      fundamental_adj: fundamentalAdj,
      weights,
      diagnostics: {
        model,
        training_points: filteredHist.length,
        history_from: historyFrom,
        history_to: historyTo,
        mae,
        mape,
        stat_confidence: statConf,
        fallback_used: model === "rolling_mean" || model === "seasonal_naive",
      },
      warnings,
    };
  });
