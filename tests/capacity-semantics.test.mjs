import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-capacity-tests");
await mkdir(outdir, { recursive: true });

async function transpile(sourcePath, outPath, replacements = []) {
  let source = await readFile(sourcePath, "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
  await writeFile(outPath, result.outputText, "utf8");
}

await transpile(path.join(root, "src/lib/markets.ts"), path.join(outdir, "markets.mjs"));
await transpile(
  path.join(root, "src/lib/trading-calculations.ts"),
  path.join(outdir, "trading-calculations.mjs"),
  [['from "./markets"', 'from "./markets.mjs"']],
);
const mod = await import(pathToFileURL(path.join(outdir, "trading-calculations.mjs")).href);

test.after(async () => rm(outdir, { recursive: true, force: true }));

const prices = (value) => [
  { ts: "2026-08-20T00:00:00.000Z", price: value, durationMinutes: 60 },
];

test("public auction allocation is not exposed as available capacity", () => {
  const opportunity = mod.buildRouteOpportunity({
    from: "HU",
    to: "RS",
    label: "HU -> RS",
    sourcePoints: prices(80),
    destinationPoints: prices(100),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 5, offered_mw: 600, allocated_mw: 500 },
    },
    multiDay: false,
  });

  assert.equal(opportunity.availableCapacityMw, null);
  assert.equal(opportunity.auctionAllocatedMw, 500);
  assert.equal(opportunity.auctionOfferedMw, 600);
  assert.equal(opportunity.netSpread, 15);
  assert.equal(opportunity.potentialMarginPerMw, 15);
  assert.match(opportunity.reason ?? "", /per MW only/i);
});

test("verified executable capacity may populate available capacity", () => {
  const opportunity = mod.buildRouteOpportunity({
    from: "HU",
    to: "RS",
    label: "HU -> RS",
    sourcePoints: prices(80),
    destinationPoints: prices(100),
    capacity: {
      source: "owned-position",
      data: {
        price_eur_mwh: 5,
        offered_mw: 600,
        allocated_mw: 500,
        executable_capacity_mw: 12,
      },
    },
    multiDay: false,
  });

  assert.equal(opportunity.availableCapacityMw, 12);
  assert.equal(opportunity.netSpread, 15);
});
