import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "power-pulse-tests");
const libOutdir = path.join(outdir, "lib");
const outfile = path.join(libOutdir, "trading-calculations.mjs");
const priceMarketsOutfile = path.join(libOutdir, "price-markets.mjs");
const priceAnalysisOutfile = path.join(libOutdir, "price-analysis.mjs");
const unitsOutfile = path.join(libOutdir, "units.mjs");
const baseloadOutfile = path.join(libOutdir, "baseload.mjs");
const producerAnalyticsOutfile = path.join(libOutdir, "producer-analytics.mjs");

async function transpileModule(sourcePath, outPath, replacements = []) {
  let source = await readFile(sourcePath, "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: true,
    },
  });
  await writeFile(outPath, result.outputText, "utf8");
}

await mkdir(libOutdir, { recursive: true });
await transpileModule(path.join(root, "src/lib/markets.ts"), path.join(libOutdir, "markets.mjs"));
await transpileModule(path.join(root, "src/lib/price-markets.ts"), priceMarketsOutfile);
await transpileModule(path.join(root, "src/lib/trading-calculations.ts"), outfile, [
  ['from "./markets"', 'from "./markets.mjs"'],
]);
await transpileModule(path.join(root, "src/lib/price-analysis.ts"), priceAnalysisOutfile, [
  ['from "./price-markets"', 'from "./price-markets.mjs"'],
  ['from "./trading-calculations"', 'from "./trading-calculations.mjs"'],
]);
await transpileModule(path.join(root, "src/lib/units.ts"), unitsOutfile);
await transpileModule(path.join(root, "src/lib/baseload.ts"), baseloadOutfile);
await transpileModule(
  path.join(root, "src/components/dashboard/producer/producer-analytics.ts"),
  producerAnalyticsOutfile,
  [['from "@/lib/baseload"', 'from "./baseload.mjs"']],
);

const mod = await import(pathToFileURL(outfile).href);
const priceMarkets = await import(pathToFileURL(priceMarketsOutfile).href);
const priceAnalysis = await import(pathToFileURL(priceAnalysisOutfile).href);
const units = await import(pathToFileURL(unitsOutfile).href);
const producerAnalytics = await import(pathToFileURL(producerAnalyticsOutfile).href);

const points = (prices) =>
  prices.map((price, index) => ({
    ts: `2026-03-28T${String(index).padStart(2, "0")}:00:00.000Z`,
    price,
    durationMinutes: 60,
  }));

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("gross and net spread calculations preserve valid zero capacity price", () => {
  assert.equal(mod.calculateGrossSpread(80, 100), 20);
  assert.equal(mod.calculateNetSpread(20, 0), 20);

  const opportunity = mod.buildRouteOpportunity({
    from: "HU",
    to: "RS",
    label: "HU -> RS",
    sourcePoints: points([80, 85]),
    destinationPoints: points([100, 105]),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 0, offered_mw: 100, allocated_mw: null },
    },
    multiDay: false,
  });

  assert.equal(opportunity.status, "validated");
  assert.equal(opportunity.capacityCost, 0);
  assert.equal(opportunity.netSpread, 20);
});

test("missing capacity price is not converted to zero", () => {
  const opportunity = mod.buildRouteOpportunity({
    from: "ME",
    to: "RS",
    label: "ME -> RS",
    sourcePoints: points([90]),
    destinationPoints: points([110]),
    capacity: {
      source: "empty",
      data: { price_eur_mwh: null, offered_mw: 100, allocated_mw: null },
    },
    multiDay: false,
  });

  assert.equal(opportunity.status, "indicative");
  assert.equal(opportunity.capacityCost, null);
  assert.equal(opportunity.netSpread, null);
});

test("import and export ranking uses only validated positive net routes", () => {
  const validated = mod.buildRouteOpportunity({
    from: "BG",
    to: "RS",
    label: "BG -> RS",
    sourcePoints: points([70]),
    destinationPoints: points([100]),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 5, offered_mw: 100, allocated_mw: null },
    },
    multiDay: false,
  });
  const negative = mod.buildRouteOpportunity({
    from: "RO",
    to: "RS",
    label: "RO -> RS",
    sourcePoints: points([99]),
    destinationPoints: points([100]),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 5, offered_mw: 100, allocated_mw: null },
    },
    multiDay: false,
  });
  const indicative = mod.buildRouteOpportunity({
    from: "ME",
    to: "RS",
    label: "ME -> RS",
    sourcePoints: points([70]),
    destinationPoints: points([100]),
    capacity: {
      source: "empty",
      data: { price_eur_mwh: null, offered_mw: null, allocated_mw: null },
    },
    multiDay: false,
  });

  assert.deepEqual(
    mod.rankOpportunities([negative, indicative, validated]).map((route) => route.label),
    ["BG -> RS"],
  );
});

test("multi-day selection falls back to indicative gross spread", () => {
  const opportunity = mod.buildRouteOpportunity({
    from: "HR",
    to: "RS",
    label: "HR -> RS",
    sourcePoints: points([80, 90]),
    destinationPoints: points([100, 110]),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 1, offered_mw: 100, allocated_mw: null },
    },
    multiDay: true,
  });

  assert.equal(opportunity.status, "indicative");
  assert.equal(opportunity.grossSpread, 20);
  assert.equal(opportunity.netSpread, null);
});

test("Europe/Belgrade expected intervals handle CET/CEST transition days", () => {
  assert.equal(mod.expectedIntervalsForBelgradeDay("2026-03-29"), 23);
  assert.equal(mod.expectedIntervalsForBelgradeDay("2026-10-25"), 25);
  assert.equal(mod.expectedIntervalsForBelgradeDay("2026-01-15"), 24);
});

test("incomplete interval handling reports missing observations", () => {
  const completeness = mod.completenessForSeries(points([1, 2, 3]), ["2026-01-15"]);
  assert.equal(completeness.receivedIntervals, 3);
  assert.equal(completeness.expectedIntervals, 24);
  assert.equal(completeness.missingIntervals, 21);
});

test("Albania is not a direct Serbian import route", () => {
  assert.equal(
    mod.DIRECT_SERBIAN_IMPORT_ROUTES.some((route) => route.from === "AL" && route.to === "RS"),
    false,
  );
});

test("all configured price markets have unique ENTSO-E EIC values", () => {
  const eics = priceMarkets.PRICE_MARKET_LIST.map((market) => market.eic);
  assert.equal(new Set(eics).size, eics.length);
  assert.deepEqual(priceMarkets.PRICE_MARKET_CODES, [
    "RS",
    "HU",
    "RO",
    "BG",
    "HR",
    "ME",
    "MK",
    "SI",
    "GR",
    "IT_CSUD",
    "AT",
    "DE_LU",
    "AL",
  ]);
});

test("spread matching uses exact UTC timestamps and never array position fallback", () => {
  const serbia = [
    { ts: "2026-07-15T00:00:00.000Z", price: 100, durationMinutes: 60 },
    { ts: "2026-07-15T01:00:00.000Z", price: 110, durationMinutes: 60 },
  ];
  const market = [
    { ts: "2026-07-15T00:30:00.000Z", price: 80, durationMinutes: 60 },
    { ts: "2026-07-15T01:00:00.000Z", price: 90, durationMinutes: 60 },
  ];
  const matched = priceAnalysis.matchedSpreadPoints(market, serbia);
  assert.deepEqual(
    matched.map((point) => point.ts),
    ["2026-07-15T01:00:00.000Z"],
  );
  assert.equal(matched[0].spread, -20);
});

test("15-minute price data is counted with the correct expected interval denominator", () => {
  const qh = Array.from({ length: 96 }, (_, index) => ({
    ts: new Date(Date.parse("2026-01-15T00:00:00.000Z") + index * 15 * 60_000).toISOString(),
    price: 100 + index,
    durationMinutes: 15,
  }));
  const completeness = mod.completenessForSeries(qh, ["2026-01-15"]);
  assert.equal(completeness.expectedIntervals, 96);
  assert.equal(completeness.receivedIntervals, 96);
});

test("period price stats use row-level hourly average instead of profile average", () => {
  const stats = priceAnalysis.calculatePricePeriodStats(
    [
      { ts: "2025-12-31T23:00:00.000Z", price: 100, durationMinutes: 60 },
      { ts: "2026-01-01T00:00:00.000Z", price: 200, durationMinutes: 60 },
      { ts: "2026-01-01T23:00:00.000Z", price: 100, durationMinutes: 60 },
    ],
    ["2026-01-01", "2026-01-02"],
  );

  assert.equal(Number(stats.baseloadAverage.toFixed(2)), 133.33);
  assert.equal(Number(stats.profileAverage.toFixed(2)), 150);
  assert.equal(stats.receivedIntervals, 3);
  assert.equal(stats.expectedIntervals, 48);
});

test("period price stats normalize 15-minute MTUs to hourly prices", () => {
  const stats = priceAnalysis.calculatePricePeriodStats(
    [
      { ts: "2026-01-14T23:00:00.000Z", price: 100, durationMinutes: 15 },
      { ts: "2026-01-14T23:15:00.000Z", price: 200, durationMinutes: 15 },
      { ts: "2026-01-14T23:30:00.000Z", price: 300, durationMinutes: 15 },
      { ts: "2026-01-14T23:45:00.000Z", price: 400, durationMinutes: 15 },
      { ts: "2026-01-15T00:00:00.000Z", price: 500, durationMinutes: 60 },
    ],
    ["2026-01-15"],
  );

  assert.equal(stats.receivedIntervals, 2);
  assert.equal(stats.baseloadAverage, 375);
});

test("DST days support 23-hour and 25-hour expected interval counts", () => {
  assert.equal(priceAnalysis.expectedIntervalsForDays(["2026-03-29"]), 23);
  assert.equal(priceAnalysis.expectedIntervalsForDays(["2026-10-25"]), 25);
});

test("unavailable price markets retain neutral unavailable metadata", () => {
  const status = priceAnalysis.marketAvailabilityStatus([], ["2026-07-15"], "entsoe_no_data");
  assert.equal(status.status, "Unavailable");
  assert.equal(status.receivedIntervals, 0);
  assert.equal(status.reason, "entsoe_no_data");
});

test("market presets include benchmarks without adding them to direct neighbours", () => {
  assert.deepEqual(priceAnalysis.resolveMarketPreset("europeanBenchmarks"), [
    "RS",
    "AT",
    "DE_LU",
    "IT_CSUD",
  ]);
  assert.equal(priceAnalysis.resolveMarketPreset("directNeighbours").includes("AT"), false);
  assert.equal(priceAnalysis.resolveMarketPreset("directNeighbours").includes("IT_CSUD"), false);
});

test("select all action resolves to every configured price market", () => {
  assert.deepEqual(priceAnalysis.resolveMarketPreset("all"), priceMarkets.PRICE_MARKET_CODES);
});

const powerPoints = (count, mw, stepMinutes, start = "2026-01-15T00:00:00.000Z") =>
  Array.from({ length: count }, (_, index) => ({
    ts: new Date(Date.parse(start) + index * stepMinutes * 60_000).toISOString(),
    mw,
    durationMinutes: stepMinutes,
  }));

test("energy integration handles hourly, quarter-hour and half-hour observations", () => {
  assert.equal(units.integratePowerSeries(powerPoints(24, 100, 60)).mwh, 2400);
  assert.equal(units.formatEnergyMWh(2400), "2.4 GWh");
  assert.equal(units.integratePowerSeries(powerPoints(4, 100, 15)).mwh, 100);
  assert.equal(units.integratePowerSeries(powerPoints(48, 100, 30)).mwh, 2400);
});

test("energy integration handles 23-hour and 25-hour DST delivery days", () => {
  assert.equal(
    units.integratePowerSeries(powerPoints(23, 100, 60, "2026-03-28T23:00:00.000Z")).mwh,
    2300,
  );
  assert.equal(
    units.integratePowerSeries(powerPoints(25, 100, 60, "2026-10-24T22:00:00.000Z")).mwh,
    2500,
  );
});

test("energy integration preserves negative net flow", () => {
  assert.equal(units.integratePowerSeries(powerPoints(2, -100, 60)).mwh, -200);
  assert.equal(units.formatEnergyMWh(-225806), "-225.8 GWh");
});

test("energy integration reports missing, duplicate and irregular intervals", () => {
  const missing = units.integratePowerSeries([
    { ts: "2026-01-15T00:00:00.000Z", mw: 100 },
    { ts: "2026-01-15T01:00:00.000Z", mw: 100 },
    { ts: "2026-01-15T03:00:00.000Z", mw: 100 },
  ]);
  assert.equal(missing.mwh, 100);
  assert.equal(missing.gapCount, 1);
  assert.equal(missing.intervalsSkipped > 0, true);
  assert.equal(missing.coveragePct < 100, true);

  const duplicate = units.integratePowerSeries([
    { ts: "2026-01-15T00:00:00.000Z", mw: 100 },
    { ts: "2026-01-15T00:00:00.000Z", mw: 100 },
    { ts: "2026-01-15T01:00:00.000Z", mw: 100 },
  ]);
  assert.equal(duplicate.duplicateTimestampCount, 1);

  const irregular = units.integratePowerSeries([
    { ts: "2026-01-15T00:00:00.000Z", mw: 100 },
    { ts: "2026-01-15T00:45:00.000Z", mw: 100 },
    { ts: "2026-01-15T01:45:00.000Z", mw: 100 },
  ]);
  assert.equal(irregular.mwh, 175);
  assert.equal(irregular.irregularIntervalCount, 1);
});

test("energy formatting thresholds and null values are explicit", () => {
  assert.equal(units.formatEnergyMWh(999), "999 MWh");
  assert.equal(units.formatEnergyMWh(1000), "1 GWh");
  assert.equal(units.formatEnergyMWh(999999), "1,000 GWh");
  assert.equal(units.formatEnergyMWh(1000000), "1 TWh");
  assert.equal(units.formatEnergyMWh(2662136), "2.66 TWh");
  assert.equal(units.formatEnergyMWh(0), "0 MWh");
  assert.equal(units.formatEnergyMWh(null), "-");
});

test("energy charts select one common unit for a complete series", () => {
  const valuesMWh = [725, 2450, 225806];
  const unit = units.selectEnergyUnit(valuesMWh);
  assert.equal(unit, "GWh");
  assert.deepEqual(
    valuesMWh.map((value) => units.convertMWh(value, unit)),
    [0.725, 2.45, 225.806],
  );
});

test("producer capture prices remain generation weighted", () => {
  const capturePoints = Array.from({ length: 24 }, (_, hour) => ({
    ts: new Date(Date.parse("2026-01-14T23:00:00.000Z") + hour * 3_600_000).toISOString(),
    price: hour,
    solar: hour >= 12 ? 1 : 0,
    wind: 100,
  }));
  const metrics = producerAnalytics.computeProducerMetrics(capturePoints);

  assert.equal(metrics.baseloadEurPerMWh, 11.5);
  assert.equal(metrics.solarCaptureEurPerMWh, 17.5);
  assert.equal(metrics.windCaptureEurPerMWh, 11.5);
  assert.equal(Number(metrics.solarCaptureRate.toFixed(4)), 1.5217);
  assert.equal(metrics.windCaptureRate, 1);
});

test("producer negative exposure and 85% BESS spread use actual price intervals", () => {
  const capturePoints = Array.from({ length: 24 }, (_, hour) => ({
    ts: new Date(Date.parse("2026-01-14T23:00:00.000Z") + hour * 3_600_000).toISOString(),
    price: hour < 2 ? -10 : hour,
    solar: hour < 4 ? 25 : 0,
    wind: 100,
  }));
  const metrics = producerAnalytics.computeProducerMetrics(capturePoints);

  assert.equal(metrics.negativePriceHours, 2);
  assert.equal(metrics.solarNegativeExposure, 0.5);
  assert.equal(metrics.windNegativeExposure, 2 / 24);
  assert.equal(metrics.bess.days, 1);
  assert.equal(Number(metrics.bess.avgNet2.toFixed(3)), 29.125);
});
