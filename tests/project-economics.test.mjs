import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-project-economics-tests");
const libdir = path.join(outdir, "project-economics");

async function transpile(sourceName, replacements = []) {
  let source = await readFile(
    path.join(root, "src/lib/project-economics", `${sourceName}.ts`),
    "utf8",
  );
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: true,
    },
  });
  await writeFile(path.join(libdir, `${sourceName}.mjs`), result.outputText, "utf8");
}

await mkdir(libdir, { recursive: true });
await transpile("types");
await transpile("defaults", [['from "./types"', 'from "./types.mjs"']]);
await transpile("finance", [['from "./types"', 'from "./types.mjs"']]);
await transpile("price-curve", [['from "./types"', 'from "./types.mjs"']]);
await transpile("solar", [
  ['from "./finance"', 'from "./finance.mjs"'],
  ['from "./types"', 'from "./types.mjs"'],
]);
await transpile("wind", [
  ['from "./finance"', 'from "./finance.mjs"'],
  ['from "./solar"', 'from "./solar.mjs"'],
  ['from "./types"', 'from "./types.mjs"'],
]);
await transpile("bess", [
  ['from "./finance"', 'from "./finance.mjs"'],
  ['from "./types"', 'from "./types.mjs"'],
]);
await transpile("hybrid", [
  ['from "./bess"', 'from "./bess.mjs"'],
  ['from "./finance"', 'from "./finance.mjs"'],
  ['from "./wind"', 'from "./wind.mjs"'],
  ['from "./types"', 'from "./types.mjs"'],
]);

let legacyFinanceSource = await readFile(path.join(root, "src/lib/finance.ts"), "utf8");
const legacyFinanceJs = ts.transpileModule(legacyFinanceSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
await writeFile(path.join(outdir, "legacy-finance.mjs"), legacyFinanceJs.outputText, "utf8");

const defaults = await import(pathToFileURL(path.join(libdir, "defaults.mjs")).href);
const priceCurve = await import(pathToFileURL(path.join(libdir, "price-curve.mjs")).href);
const solar = await import(pathToFileURL(path.join(libdir, "solar.mjs")).href);
const wind = await import(pathToFileURL(path.join(libdir, "wind.mjs")).href);
const bess = await import(pathToFileURL(path.join(libdir, "bess.mjs")).href);
const hybrid = await import(pathToFileURL(path.join(libdir, "hybrid.mjs")).href);
const legacyFinance = await import(pathToFileURL(path.join(outdir, "legacy-finance.mjs")).href);

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

const hourlyShape = (prices) =>
  prices.map((priceEurPerMWh, index) => ({
    ts: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    priceEurPerMWh,
  }));

const historicalCurve = (prices, years = 3) =>
  priceCurve.buildExpectedPriceCurve({
    historicalShape: hourlyShape(prices),
    contracts: [],
    mode: "historical",
    loadType: "base",
    manualFallbackEurPerMWh: null,
    lifetimeYears: years,
    terminalEscalationPct: 0,
  });

test("wind profile scaling produces the selected annual capacity factor", () => {
  const scaled = wind.scaleWindProfileToCapacityFactor(
    Array.from({ length: 8760 }, (_, index) => 0.15 + (index % 24) / 48),
    0.35,
  );
  const mean = scaled.reduce((sum, value) => sum + value, 0) / scaled.length;
  assert.ok(Math.abs(mean - 0.35) < 1e-8);
});

test("merchant renewable revenue uses the hourly price curve", () => {
  const assumptions = {
    ...defaults.DEFAULT_SOLAR_ASSUMPTIONS,
    capacityMWp: 1,
    gridMWac: 1,
    curtailmentPct: 0,
    revenueStructure: "merchant",
    negativePriceRule: "always",
    lifetimeYears: 1,
  };
  const result = solar.runSolarEconomics({
    assumptions,
    hourlyProfilePerMW: [1, 1],
    priceCurve: historicalCurve([10, 100], 1),
  });
  assert.equal(result.merchantRevenueEur, 110);
  assert.equal(result.ppaRevenueEur, 0);
});

test("fixed PPA revenue does not change when merchant prices change", () => {
  const assumptions = {
    ...defaults.DEFAULT_SOLAR_ASSUMPTIONS,
    capacityMWp: 1,
    gridMWac: 1,
    curtailmentPct: 0,
    revenueStructure: "fixed",
    ppaPriceEurPerMWh: 70,
    negativePriceRule: "always",
    lifetimeYears: 1,
  };
  const low = solar.runSolarEconomics({
    assumptions,
    hourlyProfilePerMW: [1, 1],
    priceCurve: historicalCurve([10, 20], 1),
  });
  const high = solar.runSolarEconomics({
    assumptions,
    hourlyProfilePerMW: [1, 1],
    priceCurve: historicalCurve([200, 300], 1),
  });
  assert.equal(low.ppaRevenueEur, 140);
  assert.equal(high.ppaRevenueEur, 140);
  assert.equal(low.merchantRevenueEur, 0);
});

test("partial PPA applies the market curve only to merchant share", () => {
  const assumptions = {
    ...defaults.DEFAULT_SOLAR_ASSUMPTIONS,
    capacityMWp: 1,
    gridMWac: 1,
    curtailmentPct: 0,
    revenueStructure: "hybrid",
    merchantSharePct: 25,
    ppaPriceEurPerMWh: 60,
    negativePriceRule: "always",
    lifetimeYears: 1,
  };
  const result = solar.runSolarEconomics({
    assumptions,
    hourlyProfilePerMW: [1, 1],
    priceCurve: historicalCurve([20, 100], 1),
  });
  assert.equal(result.ppaRevenueEur, 90);
  assert.equal(result.merchantRevenueEur, 30);
});

test("futures contract selection follows month then quarter then year hierarchy", () => {
  const common = {
    loadType: "base",
    deliveryStart: "2026-01-01",
    deliveryEnd: "2026-12-31",
    settlementPrice: 70,
    tradingDate: "2025-12-15",
  };
  const selected = priceCurve.selectContractForMonth(
    [
      { ...common, contractName: "Cal-26", maturityType: "year" },
      {
        ...common,
        contractName: "Q1-26",
        maturityType: "quarter",
        deliveryEnd: "2026-03-31",
        settlementPrice: 80,
      },
      {
        ...common,
        contractName: "Jan-26",
        maturityType: "month",
        deliveryEnd: "2026-01-31",
        settlementPrice: 90,
      },
    ],
    "2026-01",
    "base",
  );
  assert.equal(selected.contractName, "Jan-26");
});

test("monthly futures anchoring produces the requested monthly mean", () => {
  const shape = Array.from({ length: 24 }, (_, index) => ({
    ts: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    priceEurPerMWh: index,
  }));
  const curve = priceCurve.buildExpectedPriceCurve({
    historicalShape: shape,
    contracts: [
      {
        contractName: "Jan-26",
        loadType: "base",
        maturityType: "month",
        deliveryStart: "2026-01-01",
        deliveryEnd: "2026-01-31",
        settlementPrice: 100,
        tradingDate: "2025-12-15",
      },
    ],
    mode: "futures",
    loadType: "base",
    manualFallbackEurPerMWh: null,
    lifetimeYears: 1,
    terminalEscalationPct: 0,
  });
  const mean = curve.hourly.reduce((sum, point) => sum + point.priceEurPerMWh, 0) / 24;
  assert.ok(Math.abs(mean - 100) < 1e-9);
});

test("missing futures values are not fabricated", () => {
  const curve = priceCurve.buildExpectedPriceCurve({
    historicalShape: hourlyShape([40, 60]),
    contracts: [],
    mode: "futures",
    loadType: "base",
    manualFallbackEurPerMWh: null,
    lifetimeYears: 1,
    terminalEscalationPct: 0,
  });
  assert.deepEqual(
    curve.hourly.map((point) => point.priceEurPerMWh),
    [40, 60],
  );
  assert.equal(curve.contractsUsed.length, 0);
  assert.ok(curve.warnings.some((warning) => warning.includes("no futures value was fabricated")));
});

test("BESS dispatch respects MW, MWh and SOC constraints without simultaneous operation", () => {
  const assumptions = {
    ...defaults.DEFAULT_BESS_ASSUMPTIONS,
    powerMW: 10,
    energyMWh: 20,
    gridImportMW: 8,
    gridExportMW: 9,
    minSocPct: 10,
    maxSocPct: 90,
    maxCyclesPerDay: 1,
  };
  const prices = hourlyShape([
    90, 80, 70, 60, 50, 40, 20, 10, 15, 25, 35, 45, 55, 65, 75, 85, 100, 120, 140, 130, 110, 95, 85,
    75,
  ]);
  const rows = bess.dispatchBess({ assumptions, prices });
  assert.ok(rows.every((row) => row.chargingMW <= 8 && row.dischargingMW <= 9));
  assert.ok(rows.every((row) => row.socMWh >= 2 - 1e-9 && row.socMWh <= 18 + 1e-9));
  assert.ok(rows.every((row) => !(row.chargingMW > 0 && row.dischargingMW > 0)));
});

test("BESS applies round-trip losses and flat prices create no positive arbitrage", () => {
  const assumptions = {
    ...defaults.DEFAULT_BESS_ASSUMPTIONS,
    powerMW: 10,
    energyMWh: 20,
    minSocPct: 0,
    maxSocPct: 100,
    roundTripEfficiencyPct: 81,
    maxCyclesPerDay: 1,
  };
  const varied = bess.runBessEconomics({
    assumptions,
    priceCurve: historicalCurve(
      [
        10, 10, 10, 10, 10, 10, 10, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 90, 70,
        40, 20,
      ],
      1,
    ),
  });
  assert.ok(varied.annualChargedMWh > varied.annualDischargedMWh);
  const flat = bess.runBessEconomics({
    assumptions,
    priceCurve: historicalCurve(Array(24).fill(50), 1),
  });
  assert.equal(flat.grossArbitrageRevenueEur, 0);
});

test("hybrid export stays below shared grid and BESS recovers clipped renewable energy", () => {
  const assumptions = {
    ...defaults.DEFAULT_HYBRID_ASSUMPTIONS,
    components: "solar_bess",
    sharedGridExportMW: 5,
    sharedGridImportMW: 0,
    gridChargingAllowed: false,
    curtailmentRecovery: true,
    solar: {
      ...defaults.DEFAULT_SOLAR_ASSUMPTIONS,
      capacityMWp: 10,
      curtailmentPct: 0,
    },
    bess: {
      ...defaults.DEFAULT_BESS_ASSUMPTIONS,
      powerMW: 5,
      energyMWh: 10,
      minSocPct: 0,
      maxSocPct: 100,
      availabilityPct: 100,
    },
    lifetimeYears: 1,
  };
  const result = hybrid.runHybridEconomics({
    assumptions,
    solarProfilePerMW: [1],
    windProfile: [0],
    priceCurve: historicalCurve([50], 1),
  });
  assert.ok(result.dispatch.every((row) => row.gridExportMW <= 5));
  assert.equal(result.recoveredClippedEnergyMWh, 5);
});

test("invalid inputs do not produce NaN or Infinity", () => {
  const result = bess.runBessEconomics({
    assumptions: {
      ...defaults.DEFAULT_BESS_ASSUMPTIONS,
      powerMW: -10,
      energyMWh: -20,
      roundTripEfficiencyPct: 500,
      lifetimeYears: 1,
    },
    priceCurve: historicalCurve([10, 100], 1),
  });
  const numeric = [
    result.totalCapexEur,
    result.durationHours,
    result.annualChargedMWh,
    result.annualDischargedMWh,
    result.npvEur,
  ];
  assert.ok(numeric.every(Number.isFinite));
});

test("legacy solar runCalc remains operational", () => {
  const result = legacyFinance.runCalc({
    capacityMwp: 1,
    gridMwac: 1,
    capexEurKwp: 750,
    fixedOpexEurKwYr: 12,
    varOpexEurMwh: 1,
    degradationPct: 0.5,
    lifetimeYears: 2,
    discountRatePct: 8,
    debtSharePct: 50,
    interestRatePct: 6,
    loanTenorYears: 2,
    ppaPriceEurMwh: 65,
    ppaStructure: "merchant",
    merchantSharePct: 100,
    curtailmentPct: 0,
    negativePriceRule: "always",
    curtailThreshold: 0,
    hourlyProfilePerMw: [1, 1],
    hourlyPrice: [50, 60],
  });
  assert.equal(result.annualGenMwh, 2);
  assert.ok(Number.isFinite(result.npv));
});
