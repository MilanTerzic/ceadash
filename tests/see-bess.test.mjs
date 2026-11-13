import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-see-bess-tests");
await mkdir(outdir, { recursive: true });
for (const name of ["analytics", "bess"]) {
  const source = (await readFile(path.join(root, `src/lib/see/${name}.ts`), "utf8")).replace(
    /from "\.\/analytics"/g,
    'from "./analytics.mjs"',
  );
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  await writeFile(path.join(outdir, `${name}.mjs`), result.outputText, "utf8");
}
const bess = await import(pathToFileURL(path.join(outdir, "bess.mjs")).href);

const hour = (iso) => Date.parse(iso) / 3_600_000;
// A full CET winter day starts at 23:00Z the day before.
const day = (values, start = "2026-01-13T23:00:00Z") => ({
  t: values.map((_, i) => hour(start) + i),
  v: values,
});
const base = {
  powerMW: 1,
  energyMWh: 1,
  roundTripEfficiency: 1,
  socMin: 0,
  socMax: 1,
  maxCyclesPerDay: 10,
  variableCost: 0,
  reservedShare: 0,
};
const near = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);

test("lossless 1 MW / 1 MWh battery captures the full spread of a two-price day", () => {
  const r = bess.optimiseDispatch(day([10, 50]), base);
  near(r.summary.netMargin, 40);
  near(r.steps[0].chargeMW, 1);
  near(r.steps[1].dischargeMW, 1);
  near(r.summary.cycles, 1);
  assert.deepEqual(bess.checkDispatch(r, base), []);
});

test("round-trip losses are applied on both legs and limited by grid power", () => {
  const p = { ...base, roundTripEfficiency: 0.81 };
  const r = bess.optimiseDispatch(day([10, 50]), p);
  // Buys 1 MWh, stores 0.9, sells 0.81.
  near(r.steps[0].chargeMW, 1);
  near(r.steps[0].socMWh, 0.9);
  near(r.steps[1].dischargeMW, 0.81);
  near(r.summary.netMargin, 0.81 * 50 - 10);
  assert.deepEqual(bess.checkDispatch(r, p), []);
});

test("no trade when the spread does not cover losses and wear", () => {
  const lossy = bess.optimiseDispatch(day([50, 52]), { ...base, roundTripEfficiency: 0.81 });
  near(lossy.summary.dischargedMWh, 0);
  near(lossy.summary.netMargin, 0);
  const wear = bess.optimiseDispatch(day([50, 60]), { ...base, variableCost: 12 });
  near(wear.summary.dischargedMWh, 0);
  const worth = bess.optimiseDispatch(day([50, 60]), { ...base, variableCost: 4 });
  near(worth.summary.netMargin, 6);
  near(worth.summary.variableCosts, 4);
});

test("a 2-hour battery needs two hours to fill and uses the two cheapest and dearest hours", () => {
  const p = { ...base, powerMW: 1, energyMWh: 2 };
  const r = bess.optimiseDispatch(day([30, 10, 20, 80, 90, 40]), p);
  near(r.summary.netMargin, 80 + 90 - 10 - 20);
  near(Math.max(...r.steps.map((s) => s.socMWh)), 2);
  assert.deepEqual(bess.checkDispatch(r, p), []);
});

test("it never sells energy it has not bought yet", () => {
  // The dear hour comes first: nothing to sell, and buying later has no outlet.
  const r = bess.optimiseDispatch(day([90, 10]), base);
  near(r.summary.dischargedMWh, 0);
  near(r.summary.chargedMWh, 0);
});

test("SoC window and reserved power reduce what can be traded", () => {
  const window = { ...base, energyMWh: 2, powerMW: 2, socMin: 0.1, socMax: 0.9 };
  const r = bess.optimiseDispatch(day([10, 50]), window);
  near(r.summary.dischargedMWh, 1.6);
  near(Math.min(...r.steps.map((s) => s.socMWh)), 0.2);
  assert.deepEqual(bess.checkDispatch(r, window), []);
  const reserved = { ...base, reservedShare: 0.5 };
  const half = bess.optimiseDispatch(day([10, 50]), reserved);
  near(half.summary.dischargedMWh, 0.5);
  assert.deepEqual(bess.checkDispatch(half, reserved), []);
});

test("the daily cycle limit binds and keeps the most valuable cycle", () => {
  const prices = day([10, 60, 20, 50, 5, 100]);
  const free = bess.optimiseDispatch(prices, base);
  near(free.summary.cycles, 3);
  const capped = { ...base, maxCyclesPerDay: 1 };
  const r = bess.optimiseDispatch(prices, capped);
  assert.ok(r.summary.cycles <= 1 + 1e-9);
  near(r.summary.netMargin, 95);
  assert.deepEqual(bess.checkDispatch(r, capped), []);
});

test("negative prices: charging is paid and the battery does not discharge into them", () => {
  const r = bess.optimiseDispatch(day([-20, 30]), base);
  near(r.summary.netMargin, 50);
  near(r.summary.chargingCost, -20);
});

test("days are optimised independently and gaps are never bridged", () => {
  const two = {
    t: [...day(new Array(24).fill(0)).t, ...day(new Array(24).fill(0), "2026-01-14T23:00:00Z").t],
    v: [
      ...Array.from({ length: 24 }, (_, h) => (h === 3 ? 10 : h === 19 ? 110 : 60)),
      ...Array.from({ length: 24 }, (_, h) => (h === 3 ? 20 : h === 19 ? 70 : 50)),
    ],
  };
  const r = bess.optimiseDispatch(two, base);
  assert.equal(r.daily.length, 2);
  near(r.daily[0].netMargin, 100);
  near(r.daily[1].netMargin, 50);
  // Remove the hours between charge and discharge on day one: the block is split.
  const gap = { t: [two.t[3], two.t[19]], v: [10, 110] };
  near(bess.optimiseDispatch(gap, base).summary.netMargin, 0);
});

test("random prices: the plan is always feasible and never loses money", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let run = 0; run < 25; run++) {
    const p = {
      powerMW: 1 + Math.floor(rand() * 20),
      energyMWh: 1 + Math.floor(rand() * 60),
      roundTripEfficiency: 0.7 + rand() * 0.3,
      socMin: rand() * 0.2,
      socMax: 0.8 + rand() * 0.2,
      maxCyclesPerDay: 0.5 + rand() * 2,
      variableCost: rand() * 10,
      reservedShare: rand() * 0.5,
    };
    const prices = day(Array.from({ length: 24 }, () => -30 + rand() * 250));
    const r = bess.optimiseDispatch(prices, p);
    assert.deepEqual(bess.checkDispatch(r, p), []);
    assert.ok(r.summary.netMargin >= -1e-6);
  }
});

test("invalid parameters return an empty dispatch and a reason", () => {
  assert.equal(bess.validParams({ ...base, socMin: 0.9, socMax: 0.5 }), "soc_window_invalid");
  assert.equal(bess.validParams({ ...base, roundTripEfficiency: 1.2 }), "efficiency_out_of_range");
  assert.equal(bess.optimiseDispatch(day([10, 50]), { ...base, powerMW: 0 }).steps.length, 0);
});

test("valuation: annualisation, capacity fade, reserved revenue, NPV, IRR and payback", () => {
  const summary = {
    ...bess.optimiseDispatch(day([10, 50]), base).summary,
    netMargin: 100,
    days: 1,
  };
  const p = { ...base, powerMW: 2, energyMWh: 4, reservedShare: 0.25 };
  const inv = {
    capexPerKWh: 10,
    capexPerKW: 5,
    fixedOpexPerMWYear: 1000,
    availability: 1,
    degradationPerYear: 0.1,
    lifetimeYears: 3,
    discountRate: 0.1,
    reservedRevenuePerMWYear: 4000,
  };
  const v = bess.valueBess(summary, p, inv);
  assert.equal(v.capex, 10 * 4000 + 5 * 2000);
  near(v.arbitrageYear1, 36500);
  near(v.reservedYear1, 4000 * 2 * 0.25);
  near(v.fixedOpex, 2000);
  assert.deepEqual(
    v.cashflows.map((x) => Math.round(x)),
    [36500, 32850, 29200],
  );
  near(v.npv, -50000 + 36500 / 1.1 + 32850 / 1.21 + 29200 / 1.331, 1e-6);
  near(v.paybackYears, 1 + (50000 - 36500) / 32850, 1e-9);
  // IRR is the rate at which NPV is zero.
  const check = -50000 + 36500 / (1 + v.irr) + 32850 / (1 + v.irr) ** 2 + 29200 / (1 + v.irr) ** 3;
  near(check, 0, 1e-3);
  assert.equal(bess.irr([-10, -5]), null);
});
