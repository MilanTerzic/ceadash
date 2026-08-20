import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), `cea-project-consistency-${process.pid}`);
const libdir = path.join(outdir, "project-economics");

async function transpile(name, replacements = []) {
  let source = await readFile(path.join(root, "src/lib/project-economics", `${name}.ts`), "utf8");
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: true,
    },
  });
  await writeFile(path.join(libdir, `${name}.mjs`), result.outputText, "utf8");
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

const defaults = await import(pathToFileURL(path.join(libdir, "defaults.mjs")).href);
const priceCurve = await import(pathToFileURL(path.join(libdir, "price-curve.mjs")).href);
const solar = await import(pathToFileURL(path.join(libdir, "solar.mjs")).href);

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

function historicalCurve() {
  const hourly = [
    "2026-01-15T12:00:00Z",
    "2026-01-15T13:00:00Z",
    "2026-01-15T14:00:00Z",
    "2026-01-15T15:00:00Z",
    "2026-02-15T12:00:00Z",
    "2026-02-15T13:00:00Z",
    "2026-02-15T14:00:00Z",
    "2026-02-15T15:00:00Z",
  ].map((ts, index) => ({ ts, priceEurPerMWh: 30 + index * 10 }));
  return priceCurve.buildExpectedPriceCurve({
    historicalShape: hourly,
    contracts: [],
    mode: "historical",
    loadType: "base",
    manualFallbackEurPerMWh: null,
    lifetimeYears: 1,
    terminalEscalationPct: 0,
  });
}

for (const structure of ["merchant", "fixed", "pay_as_produced", "hybrid", "baseload"]) {
  test(`monthly renewable revenue sums exactly to annual settlement for ${structure}`, () => {
    const result = solar.runSolarEconomics({
      assumptions: {
        ...defaults.DEFAULT_SOLAR_ASSUMPTIONS,
        capacityMWp: 1,
        gridMWac: 1,
        curtailmentPct: 0,
        negativePriceRule: "always",
        lifetimeYears: 1,
        revenueStructure: structure,
        merchantSharePct: 40,
        ppaPriceEurPerMWh: 70,
      },
      hourlyProfilePerMW: Array(8).fill(1),
      priceCurve: historicalCurve(),
    });
    const monthly = result.monthlyRevenueEur.reduce((sum, row) => sum + row.value, 0);
    const annual = result.merchantRevenueEur + result.ppaRevenueEur;
    assert.ok(Math.abs(monthly - annual) < 1e-9, `${structure}: ${monthly} != ${annual}`);
  });
}

test("Europe/Belgrade month delivery hours include leap year and DST", () => {
  assert.equal(priceCurve.belgradeMonthDeliveryHours("2028-02"), 696);
  assert.equal(priceCurve.belgradeMonthDeliveryHours("2028-03"), 743);
  assert.equal(priceCurve.belgradeMonthDeliveryHours("2028-10"), 745);
});

test("later-year futures average is delivery-hour weighted", () => {
  const contracts = [];
  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, "0");
    const next = month === 12 ? "2028-12-31" : `2028-${mm}-${new Date(Date.UTC(2028, month, 0)).getUTCDate()}`;
    contracts.push({
      contractName: `M${mm}-28`,
      loadType: "base",
      maturityType: "month",
      deliveryStart: `2028-${mm}-01`,
      deliveryEnd: next,
      settlementPrice: month === 2 ? 0 : month === 3 ? 200 : 100,
      tradingDate: "2026-12-15",
    });
  }
  // Add one 2027 forward so futuresScenarioYear anchors the first year to 2027.
  contracts.push({
    contractName: "Cal-27",
    loadType: "base",
    maturityType: "year",
    deliveryStart: "2027-01-01",
    deliveryEnd: "2027-12-31",
    settlementPrice: 90,
    tradingDate: "2026-12-15",
  });

  const curve = priceCurve.buildExpectedPriceCurve({
    historicalShape: [
      { ts: "2026-01-01T00:00:00Z", priceEurPerMWh: 80 },
      { ts: "2026-02-01T00:00:00Z", priceEurPerMWh: 80 },
    ],
    contracts,
    mode: "futures",
    loadType: "base",
    manualFallbackEurPerMWh: null,
    lifetimeYears: 2,
    terminalEscalationPct: 0,
  });
  const year2028 = curve.yearly.find((row) => row.year === 2028);
  assert.ok(year2028);
  const months = Array.from({ length: 12 }, (_, i) => `2028-${String(i + 1).padStart(2, "0")}`);
  const totalHours = months.reduce((sum, month) => sum + priceCurve.belgradeMonthDeliveryHours(month), 0);
  const expected = months.reduce((sum, month, i) => {
    const price = i === 1 ? 0 : i === 2 ? 200 : 100;
    return sum + price * priceCurve.belgradeMonthDeliveryHours(month);
  }, 0) / totalHours;
  assert.ok(Math.abs(year2028.averageEurPerMWh - expected) < 1e-9);
  assert.notEqual(year2028.averageEurPerMWh, 100);
});
