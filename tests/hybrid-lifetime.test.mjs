import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-hybrid-lifetime-tests");
const outfile = path.join(outdir, "hybrid-lifetime.mjs");
await mkdir(outdir, { recursive: true });
const source = await readFile(
  path.join(root, "src/lib/project-economics/hybrid-lifetime.ts"),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
});
await writeFile(outfile, transpiled.outputText, "utf8");
const mod = await import(pathToFileURL(outfile).href);

test.after(async () => rm(outdir, { recursive: true, force: true }));

const assumptions = {
  lifetimeYears: 2,
  basePriceEurPerMWh: 100,
  yearlyPricesEurPerMWh: [100, 200],
  solarShareOfRenewableRevenue: 1,
  solarDegradationPct: 1,
  windDegradationPct: 0,
  bessAnnualCapacityDegradationPct: 10,
};

test("tolling and ancillary revenue do not scale with wholesale power price", () => {
  const revenue = mod.buildHybridLifetimeRevenue(
    {
      renewableMerchantEur: 0,
      renewablePpaEur: 0,
      batteryMerchantEur: 0,
      tollingEur: 1_000,
      ancillaryEur: 500,
    },
    assumptions,
  );
  assert.deepEqual(revenue, [1_500, 1_500]);
});

test("renewable merchant revenue scales with price and renewable degradation", () => {
  const revenue = mod.buildHybridLifetimeRevenue(
    {
      renewableMerchantEur: 1_000,
      renewablePpaEur: 0,
      batteryMerchantEur: 0,
      tollingEur: 0,
      ancillaryEur: 0,
    },
    assumptions,
  );
  assert.equal(revenue[0], 1_000);
  assert.equal(revenue[1], 1_980);
});

test("battery merchant revenue scales with price and battery capacity degradation only", () => {
  const revenue = mod.buildHybridLifetimeRevenue(
    {
      renewableMerchantEur: 0,
      renewablePpaEur: 0,
      batteryMerchantEur: 1_000,
      tollingEur: 0,
      ancillaryEur: 0,
    },
    assumptions,
  );
  assert.equal(revenue[0], 1_000);
  assert.equal(revenue[1], 1_800);
});

test("solar and wind degradation are weighted separately", () => {
  const factor = mod.weightedRenewableDegradationFactor({
    yearIndex: 1,
    solarGenerationMWh: 75,
    windGenerationMWh: 25,
    solarDegradationPct: 2,
    windDegradationPct: 0,
  });
  assert.equal(Number(factor.toFixed(4)), 0.985);
});
