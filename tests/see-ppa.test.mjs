import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-see-ppa-tests");
await mkdir(outdir, { recursive: true });
for (const name of ["analytics", "ppa"]) {
  const source = (await readFile(path.join(root, `src/lib/see/${name}.ts`), "utf8")).replace(
    /from "\.\/analytics"/g,
    'from "./analytics.mjs"',
  );
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  await writeFile(path.join(outdir, `${name}.mjs`), result.outputText, "utf8");
}
const ppa = await import(pathToFileURL(path.join(outdir, "ppa.mjs")).href);

const hour = (iso) => Date.parse(iso) / 3_600_000;
const series = (values, start = "2026-06-01T00:00:00Z") => ({
  t: values.map((_, i) => hour(start) + i),
  v: values,
});
const near = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);

const contract = {
  volumeBasis: "produced",
  pricing: "fixed",
  strike: 60,
  baseloadMW: 0,
  indexDiscount: 0,
  indexFee: 0,
  indexFloor: null,
  indexCap: null,
  skipNegativeHours: false,
  balancingCost: 0,
  balancingBy: "seller",
  nominationError: 0,
  imbalanceCost: 0,
};
// Four hours: solar produces when prices are low.
const prices = series([100, 20, 40, 120]);
const gen = series([0, 10, 10, 0]);
const m = ppa.matchHours(prices, gen);

test("matching keeps only hours with both a price and a valid generation value", () => {
  const partial = ppa.matchHours(prices, {
    t: [prices.t[1], prices.t[2], prices.t[3]],
    v: [5, -1, NaN],
  });
  assert.deepEqual(partial.t, [prices.t[1]]);
});

test("capture price is generation weighted; capture rate and profile cost follow", () => {
  const s = ppa.captureStats(m, 10);
  near(s.baseload, 70);
  near(s.capturePrice, 30);
  near(s.captureRate, 30 / 70);
  near(s.profileCost, 40);
  near(s.volumeMWh, 20);
  near(s.capacityFactor, 0.5);
  assert.equal(ppa.captureStats({ t: [], price: [], gen: [] }).capturePrice, null);
});

test("pay-as-produced fixed price: seller advantage is volume x (strike - capture)", () => {
  const s = ppa.settle(m, m.price, contract);
  near(s.contractRevenue, 20 * 60);
  near(s.merchantRevenue, 600);
  near(s.sellerAdvantage, 20 * (60 - 30));
  near(s.realisedPrice, 60);
});

test("baseload delivery: shortfalls are bought and surpluses sold at spot", () => {
  const base = { ...contract, volumeBasis: "baseload", baseloadMW: 5, strike: 70 };
  const s = ppa.settle(m, m.price, base);
  near(s.contractMWh, 20);
  near(s.residualBoughtMWh, 10);
  near(s.residualSoldMWh, 10);
  // 5 MW x 70 x 4 h + sum((gen - 5) x spot) = 1400 + (-500 + 100 + 200 - 600)
  near(s.contractRevenue, 1400 - 800);
  // At a strike equal to the baseload price the seller is indifferent to merchant.
  near(s.sellerAdvantage, 0);
});

test("indexed pricing applies discount, fee, floor and cap per hour", () => {
  const idx = {
    ...contract,
    pricing: "indexed",
    indexDiscount: 0.1,
    indexFee: 2,
    indexFloor: 25,
    indexCap: 30,
  };
  const s = ppa.settle(m, m.price, idx);
  // hour 2: 20*0.9-2 = 16 -> floor 25; hour 3: 40*0.9-2 = 34 -> cap 30
  near(s.contractRevenue, 10 * 25 + 10 * 30);
  near(s.realisedPrice, 27.5);
});

test("negative-price clause curtails output for contract and merchant alike", () => {
  const neg = ppa.matchHours(series([-10, 50]), series([10, 10]));
  const off = ppa.settle(neg, neg.price, contract);
  near(off.merchantRevenue, 400);
  const on = ppa.settle(neg, neg.price, { ...contract, skipNegativeHours: true });
  near(on.skippedMWh, 10);
  near(on.producedMWh, 10);
  near(on.merchantRevenue, 500);
  near(on.contractRevenue, 600);
  const stats = ppa.captureStats(neg);
  assert.equal(stats.negativeHours, 1);
  near(stats.negativeVolumeShare, 0.5);
});

test("balancing: buyer-borne cost is an advantage; nomination error adds imbalance cost", () => {
  const seller = ppa.settle(m, m.price, { ...contract, balancingCost: 3 });
  near(seller.sellerAdvantage, 20 * 30);
  const buyer = ppa.settle(m, m.price, { ...contract, balancingCost: 3, balancingBy: "buyer" });
  near(buyer.sellerAdvantage, 20 * 30 + 20 * 3);
  const nominated = ppa.settle(m, m.price, {
    ...contract,
    volumeBasis: "nominated",
    balancingCost: 3,
    nominationError: 0.1,
    imbalanceCost: 50,
  });
  near(nominated.sellerBalancing, 20 * (3 + 5));
  near(nominated.sellerAdvantage, 20 * 30 - 20 * 5);
});

test("forward curve keeps the target baseload; shape stress lowers the capture rate", () => {
  const flat = ppa.forwardCurve(m, 140);
  near(flat.reduce((a, b) => a + b, 0) / 4, 140);
  near(flat[1] / flat[0], 0.2);
  const stressed = ppa.forwardCurve(m, 140, 0.5);
  near(stressed.reduce((a, b) => a + b, 0) / 4, 140);
  const rate = (curve) => ppa.captureStats({ ...m, price: curve }).captureRate;
  assert.ok(rate(stressed) < rate(flat));
});

test("valuation: fair strike zeroes the NPV and equals the discounted capture price", () => {
  const term = {
    years: 3,
    forwardBaseload: 70,
    baseloadEscalation: 0,
    shapeStressPerYear: 0,
    shapeStressStart: 0,
    degradation: 0,
    discountRate: 0.08,
  };
  const v = ppa.valuePpa(m, contract, term);
  near(v.fairStrike, 30, 1e-9);
  near(v.years[0].producedMWh, 20 * (8760 / 4));
  const expected = [0.5, 1.5, 2.5].reduce((sum, t) => sum + (20 * 2190 * 30) / 1.08 ** t, 0);
  near(v.npvSeller, expected, 1e-6);
  near(ppa.valuePpa(m, { ...contract, strike: v.fairStrike }, term).npvSeller, 0, 1e-6);
  near(v.npvPerMWh, 30, 1e-9);

  // Baseload basis: the fair strike is the forward baseload itself.
  const base = ppa.valuePpa(m, { ...contract, volumeBasis: "baseload", baseloadMW: 5 }, term);
  near(base.fairStrike, 70, 1e-9);

  // A rising shape stress and degradation reduce later years.
  const worse = ppa.valuePpa(m, contract, { ...term, shapeStressPerYear: 0.2, degradation: 0.01 });
  assert.ok(worse.years[2].captureRate < worse.years[0].captureRate);
  assert.ok(worse.years[2].producedMWh < worse.years[0].producedMWh);
  assert.ok(worse.fairStrike < 30);
  assert.equal(ppa.valuePpa(m, { ...contract, pricing: "indexed" }, term).fairStrike, null);
});

test("profile scaling hits the capacity factor and never exceeds capacity", () => {
  const scaled = ppa.scaleToCapacityFactor(series([0, 1, 3, 0]), 10, 0.25);
  near(scaled.v.reduce((a, b) => a + b, 0) / 4, 2.5);
  const clipped = ppa.scaleToCapacityFactor(series([0, 0, 0, 1]), 10, 0.5);
  assert.equal(Math.max(...clipped.v), 10);
  assert.equal(ppa.scaleToCapacityFactor(series([0, 0]), 10, 0.2).t.length, 0);
});

test("CSV profile: header, delimiters, decimal comma, zones, DST and bad lines", () => {
  const utc = ppa.parseProfileCsv(
    "timestamp,mw\n2026-06-01T10:00:00Z,4.5\n2026-06-01 11:00,5\nbroken\n2026-06-01 12:00,-1\n",
    "utc",
  );
  assert.equal(utc.points.length, 2);
  assert.equal(utc.points[1].ts, "2026-06-01T11:00:00.000Z");
  assert.deepEqual(utc.badLines, [4, 5]);

  const local = ppa.parseProfileCsv(
    "time;MW\n2026-06-01 12:00;3,25\n2026-01-15 12:00;1\n",
    "market",
  );
  assert.equal(local.detectedDelimiter, ";");
  assert.equal(local.points[0].ts, "2026-06-01T10:00:00.000Z"); // CEST = UTC+2
  assert.equal(local.points[0].value, 3.25);
  assert.equal(local.points[1].ts, "2026-01-15T11:00:00.000Z"); // CET = UTC+1

  // Hour after the spring switch: 03:00 CEST = 01:00Z.
  assert.equal(
    ppa.parseProfileCsv("2026-03-29 03:00,1", "market").points[0].ts,
    "2026-03-29T01:00:00.000Z",
  );
  assert.equal(
    ppa.parseProfileCsv("2026-06-01T12:00:00+02:00,1", "utc").points[0].ts,
    "2026-06-01T10:00:00.000Z",
  );
});
