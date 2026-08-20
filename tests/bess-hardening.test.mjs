import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-bess-hardening-tests");
await mkdir(outdir, { recursive: true });

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
    },
  });
  await writeFile(path.join(outdir, `${sourceName}.mjs`), result.outputText, "utf8");
}

await transpile("types");
await transpile("finance", [['from "./types"', 'from "./types.mjs"']]);
await transpile("defaults", [['from "./types"', 'from "./types.mjs"']]);
await transpile("bess", [
  ['from "./finance"', 'from "./finance.mjs"'],
  ['from "./types"', 'from "./types.mjs"'],
]);

const bess = await import(pathToFileURL(path.join(outdir, "bess.mjs")).href);
const defaults = await import(pathToFileURL(path.join(outdir, "defaults.mjs")).href);

test.after(async () => rm(outdir, { recursive: true, force: true }));

test("small positive nominal spread is rejected when losses and throughput cost make it uneconomic", () => {
  const signals = bess.dailySignalSets([50, 54], 1, 1, {
    roundTripEfficiencyPct: 80,
    variableThroughputEurPerMWh: 2,
  });
  assert.equal(signals.charge.size, 0);
  assert.equal(signals.discharge.size, 0);
});

test("25-hour Belgrade DST day is treated as one delivery day", () => {
  const assumptions = {
    ...defaults.DEFAULT_BESS_ASSUMPTIONS,
    powerMW: 1,
    energyMWh: 1,
    gridImportMW: 1,
    gridExportMW: 1,
    minSocPct: 0,
    maxSocPct: 100,
    availabilityPct: 100,
    roundTripEfficiencyPct: 100,
    variableThroughputEurPerMWh: 0,
    maxCyclesPerDay: 1,
  };
  const start = Date.parse("2026-10-24T22:00:00Z");
  const prices = Array.from({ length: 25 }, (_, index) => ({
    ts: new Date(start + index * 3_600_000).toISOString(),
    priceEurPerMWh: index === 0 ? 0 : index === 24 ? 100 : 50,
  }));
  const dispatch = bess.dispatchBess({ assumptions, prices });
  assert.equal(dispatch.length, 25);
  assert.ok(dispatch[0].chargingMW > 0);
  assert.ok(dispatch[24].dischargingMW > 0);
  assert.ok(dispatch.reduce((sum, row) => sum + row.chargingMW, 0) <= 1 + 1e-9);
  assert.ok(dispatch.reduce((sum, row) => sum + row.dischargingMW, 0) <= 1 + 1e-9);
});
