import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-interval-price-tests");
const libOutdir = path.join(outdir, "lib");

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
await transpileModule(
  path.join(root, "src/lib/price-markets.ts"),
  path.join(libOutdir, "price-markets.mjs"),
);
await transpileModule(
  path.join(root, "src/lib/trading-calculations.ts"),
  path.join(libOutdir, "trading-calculations.mjs"),
  [['from "./markets"', 'from "./markets.mjs"']],
);
await transpileModule(
  path.join(root, "src/lib/price-analysis.ts"),
  path.join(libOutdir, "price-analysis.mjs"),
  [
    ['from "./price-markets"', 'from "./price-markets.mjs"'],
    ['from "./trading-calculations"', 'from "./trading-calculations.mjs"'],
  ],
);

const trading = await import(pathToFileURL(path.join(libOutdir, "trading-calculations.mjs")).href);
const analysis = await import(pathToFileURL(path.join(libOutdir, "price-analysis.mjs")).href);

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("averagePrice weights observations by delivery duration", () => {
  const result = trading.averagePrice([
    { ts: "2026-01-15T00:00:00.000Z", price: 100, durationMinutes: 60 },
    { ts: "2026-01-15T01:00:00.000Z", price: 200, durationMinutes: 15 },
  ]);
  assert.equal(result, 120);
});

test("four quarter-hours aggregate to one hourly price without overwriting", () => {
  const points = [100, 200, 300, 400].map((price, index) => ({
    ts: new Date(Date.parse("2026-01-15T00:00:00.000Z") + index * 15 * 60_000).toISOString(),
    price,
    durationMinutes: 15,
  }));
  const hourly = analysis.normalizeToHourlyPrices(points);
  assert.equal(hourly.length, 1);
  assert.equal(hourly[0].price, 250);
  assert.equal(hourly[0].durationMinutes, 60);
});

test("mixed 15-minute and hourly markets produce an hourly spread", () => {
  const market = [80, 100, 120, 140].map((price, index) => ({
    ts: new Date(Date.parse("2026-01-15T00:00:00.000Z") + index * 15 * 60_000).toISOString(),
    price,
    durationMinutes: 15,
  }));
  const serbia = [
    { ts: "2026-01-15T00:00:00.000Z", price: 100, durationMinutes: 60 },
  ];
  const spreads = analysis.matchedSpreadPoints(market, serbia);
  assert.equal(spreads.length, 1);
  assert.equal(spreads[0].marketPrice, 110);
  assert.equal(spreads[0].serbiaPrice, 100);
  assert.equal(spreads[0].spread, 10);
});

test("quarter-hour completeness uses 96 intervals on a normal day", () => {
  const qh = Array.from({ length: 96 }, (_, index) => ({
    ts: new Date(Date.parse("2026-01-14T23:00:00.000Z") + index * 15 * 60_000).toISOString(),
    price: 100,
    durationMinutes: 15,
  }));
  const completeness = trading.completenessForSeries(qh, ["2026-01-15"]);
  assert.equal(completeness.receivedIntervals, 96);
  assert.equal(completeness.expectedIntervals, 96);
  assert.equal(completeness.completenessPct, 100);
});
