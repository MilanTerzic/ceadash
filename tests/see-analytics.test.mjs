import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-see-analytics-tests");

async function load(relative) {
  const source = await readFile(path.join(root, relative), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  await mkdir(outdir, { recursive: true });
  const out = path.join(outdir, path.basename(relative).replace(/\.ts$/, ".mjs"));
  await writeFile(out, result.outputText, "utf8");
  return import(pathToFileURL(out).href);
}

const a = await load("src/lib/see/analytics.ts");
const xml = await load("src/lib/entsoe-xml.ts");

const hour = (iso) => Date.parse(iso) / 3_600_000;
const series = (startISO, values) => ({
  t: values.map((_, i) => hour(startISO) + i),
  v: values,
});

test("15-minute prices collapse to hourly means only for fully covered hours", () => {
  const points = [
    { ts: "2026-03-10T10:00:00Z", value: 10, durationMinutes: 15 },
    { ts: "2026-03-10T10:15:00Z", value: 20, durationMinutes: 15 },
    { ts: "2026-03-10T10:30:00Z", value: 30, durationMinutes: 15 },
    { ts: "2026-03-10T10:45:00Z", value: 40, durationMinutes: 15 },
    // 11:00 hour is missing its last quarter and must be dropped.
    { ts: "2026-03-10T11:00:00Z", value: 50, durationMinutes: 15 },
    { ts: "2026-03-10T11:15:00Z", value: 50, durationMinutes: 15 },
    { ts: "2026-03-10T11:30:00Z", value: 50, durationMinutes: 15 },
    // A 60-minute point that starts at :30 cannot be assigned to a delivery hour.
    { ts: "2026-03-10T12:30:00Z", value: 99, durationMinutes: 60 },
    { ts: "2026-03-10T13:00:00Z", value: 70, durationMinutes: 60 },
  ];
  const out = a.toHourlySeries(points);
  assert.deepEqual(out.t, [hour("2026-03-10T10:00:00Z"), hour("2026-03-10T13:00:00Z")]);
  assert.deepEqual(out.v, [25, 70]);
});

test("delivery days have 23, 24 and 25 hours around the DST switches", () => {
  assert.equal(a.deliveryHours("2026-03-29"), 23);
  assert.equal(a.deliveryHours("2026-06-15"), 24);
  assert.equal(a.deliveryHours("2026-10-25"), 25);
});

test("market time converts UTC hours to CET/CEST and flags weekends", () => {
  // 2026-07-15 22:00Z = 2026-07-16 00:00 CEST (Thursday)
  assert.deepEqual(a.marketTime(hour("2026-07-15T22:00:00Z")), {
    day: "2026-07-16",
    hour: 0,
    weekend: false,
  });
  // 2026-01-10 23:00Z = 2026-01-11 00:00 CET (Sunday)
  assert.deepEqual(a.marketTime(hour("2026-01-10T23:00:00Z")), {
    day: "2026-01-11",
    hour: 0,
    weekend: true,
  });
});

test("peak is weekday 08-20 market time", () => {
  assert.equal(a.isPeak(hour("2026-07-15T06:00:00Z")), true); // Wed 08:00 CEST
  assert.equal(a.isPeak(hour("2026-07-15T05:00:00Z")), false); // Wed 07:00 CEST
  assert.equal(a.isPeak(hour("2026-07-15T18:00:00Z")), false); // Wed 20:00 CEST
  assert.equal(a.isPeak(hour("2026-07-18T10:00:00Z")), false); // Saturday
});

test("price stats: base, peak, off-peak, negatives and a completeness-aware daily spread", () => {
  // Wed 2026-01-14, full CET day starts 2026-01-13T23:00Z.
  const values = Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 20 ? 100 : 40));
  values[3] = -10;
  const s = series("2026-01-13T23:00:00Z", values);
  const stats = a.priceStats(s);
  assert.equal(stats.hours, 24);
  assert.equal(stats.peak, 100);
  assert.equal(stats.negativeHours, 1);
  assert.equal(stats.min, -10);
  assert.equal(stats.max, 100);
  assert.equal(stats.dailySpread, 110);
  assert.ok(Math.abs(stats.base - (12 * 100 + 11 * 40 - 10) / 24) < 1e-9);

  const partial = a.dailyStats(series("2026-01-13T23:00:00Z", values.slice(0, 20)));
  assert.equal(partial[0].complete, false);
  assert.equal(a.priceStats(series("2026-01-13T23:00:00Z", values.slice(0, 20))).dailySpread, null);
});

test("spread uses only hours present in both markets", () => {
  const rs = series("2026-01-14T00:00:00Z", [100, 110, 120]);
  const hu = { t: [rs.t[0], rs.t[2]], v: [90, 150] };
  const spread = a.spreadSeries(rs, hu);
  assert.deepEqual(spread.t, [rs.t[0], rs.t[2]]);
  assert.deepEqual(spread.v, [-10, 30]);
  const stats = a.spreadStats(spread);
  assert.equal(stats.mean, 10);
  assert.equal(stats.meanPositive, 15);
  assert.equal(stats.positiveShare, 0.5);
  assert.equal(stats.splitShare, 1);
});

test("net flow never treats a missing direction as zero", () => {
  const ab = series("2026-01-14T00:00:00Z", [300, 0, 200]);
  const ba = { t: [ab.t[0], ab.t[1]], v: [0, 150] };
  const net = a.netFlow(ab, ba);
  assert.deepEqual(net.t, [ab.t[0], ab.t[1]]);
  assert.deepEqual(net.v, [300, -150]);
  const stats = a.flowStats(net);
  assert.equal(stats.meanNet, 75);
  assert.equal(stats.meanAbs, 225);
  assert.equal(stats.maxAtoB, 300);
  assert.equal(stats.maxBtoA, 150);
  assert.equal(stats.shareAtoB, 0.5);
  assert.equal(a.flowStats(a.EMPTY_SERIES).meanNet, null);
});

test("utilisation divides by the capacity of the flow direction and skips unknown capacity", () => {
  const net = series("2026-01-14T00:00:00Z", [300, -150, 100]);
  const ntcAB = { t: [net.t[0], net.t[1]], v: [600, 600] };
  const ntcBA = { t: [net.t[1]], v: [300] };
  const u = a.utilisation(net, ntcAB, ntcBA);
  assert.deepEqual(u.t, [net.t[0], net.t[1]]);
  assert.deepEqual(u.v, [0.5, 0.5]);
});

test("flow/spread alignment separates with-spread, against-spread and converged hours", () => {
  const net = series("2026-01-14T00:00:00Z", [100, 100, -50, 100]);
  const spread = series("2026-01-14T00:00:00Z", [20, -20, -5, 0.1]);
  const out = a.flowSpreadAlignment(net, spread);
  assert.equal(out.hours, 4);
  assert.equal(out.withSpread, 0.5);
  assert.equal(out.againstSpread, 0.25);
});

test("route economics: net needs an observed capacity price", () => {
  const src = series("2026-01-14T00:00:00Z", [50, 80]);
  const dst = series("2026-01-14T00:00:00Z", [70, 60]);
  const noCap = a.routeEconomics(src, dst, null);
  assert.equal(noCap.meanSpread, 0);
  assert.equal(noCap.meanPositiveSpread, 10);
  assert.equal(noCap.illustrativeNet, null);
  const withCap = a.routeEconomics(src, dst, 4, 1);
  assert.equal(withCap.illustrativeNet, 5);
});

test("quantile, correlation and duration curve", () => {
  assert.equal(a.quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(a.quantile([], 0.5), null);
  const x = series("2026-01-14T00:00:00Z", [1, 2, 3, 4]);
  const y = series("2026-01-14T00:00:00Z", [2, 4, 6, 8]);
  assert.ok(Math.abs(a.correlation(x, y) - 1) < 1e-12);
  assert.equal(a.correlation(x, series("2026-01-14T00:00:00Z", [5, 5, 5, 5])), null);
  const curve = a.durationCurve(x);
  assert.deepEqual(
    curve.map((p) => p.value),
    [4, 3, 2, 1],
  );
  assert.equal(curve[0].pct, 0);
  assert.equal(curve[3].pct, 100);
});

test("ENTSO-E A03 curves repeat the last value across omitted positions; A01 does not", () => {
  const doc = (curveType) => `<Publication_MarketDocument xmlns="urn:x">
    <TimeSeries><curveType>${curveType}</curveType>
      <Period><timeInterval><start>2026-01-13T23:00Z</start><end>2026-01-14T05:00Z</end></timeInterval>
        <resolution>PT60M</resolution>
        <Point><position>1</position><price.amount>50</price.amount></Point>
        <Point><position>4</position><price.amount>80</price.amount></Point>
      </Period>
    </TimeSeries></Publication_MarketDocument>`;
  const a03 = xml.parseTimeSeriesIntervals(doc("A03"));
  assert.deepEqual(
    a03.map((p) => p.value),
    [50, 50, 50, 80, 80, 80],
  );
  assert.deepEqual(
    a03.map((p) => Boolean(p.repeated)),
    [false, true, true, false, true, true],
  );
  assert.equal(a03[5].ts, "2026-01-14T04:00:00.000Z");
  const a01 = xml.parseTimeSeriesIntervals(doc("A01"));
  assert.deepEqual(
    a01.map((p) => p.value),
    [50, 80],
  );
});

test("ENTSO-E parser keeps 15-minute resolution and production type", () => {
  const doc = `<GL_MarketDocument><TimeSeries><mRID>1</mRID><curveType>A01</curveType>
    <MktPSRType><psrType>B16</psrType></MktPSRType>
    <Period><timeInterval><start>2026-06-01T10:00Z</start><end>2026-06-01T10:30Z</end></timeInterval>
      <resolution>PT15M</resolution>
      <Point><position>1</position><quantity>120</quantity></Point>
      <Point><position>2</position><quantity>130</quantity></Point>
    </Period></TimeSeries></GL_MarketDocument>`;
  const out = xml.parseTimeSeriesIntervals(doc);
  assert.equal(out.length, 2);
  assert.equal(out[1].ts, "2026-06-01T10:15:00.000Z");
  assert.equal(out[1].durationMinutes, 15);
  assert.equal(out[0].productionType, "B16");
});

// --- Region model ------------------------------------------------------------
import { rm } from "node:fs/promises";

async function loadRegion() {
  const dir = path.join(outdir, "region");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const name of ["analytics", "registry", "region"]) {
    let source = await readFile(path.join(root, `src/lib/see/${name}.ts`), "utf8");
    source = source.replace(/from "\.\/(analytics|registry|status)"/g, 'from "./$1.mjs"');
    const result = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    });
    await writeFile(path.join(dir, `${name}.mjs`), result.outputText, "utf8");
  }
  return import(pathToFileURL(path.join(dir, "region.mjs")).href);
}
const region = await loadRegion();
const ok = { state: "cache", fetchedAt: "2026-01-14T00:00:00Z" };

test("region: net import needs every border of a market; spreads and signals follow the data", () => {
  const start = "2026-01-13T23:00:00Z"; // Wed 14 Jan 00:00 CET
  const flat = (value) => series(start, new Array(24).fill(value));
  const built = region.buildRegion({
    prices: {
      RS: { series: flat(100), status: ok },
      HU: { series: flat(80), status: ok },
      XK: { series: series(start, [-5, ...new Array(23).fill(90)]), status: ok },
    },
    physical: {
      "RS-HU": { ab: flat(0), ba: flat(400), statusAB: ok, statusBA: ok },
      "RS-XK": { ab: flat(100), ba: flat(0), statusAB: ok, statusBA: ok },
    },
    focus: { mode: "day", day: "2026-01-14" },
  });
  // HU -> RS 400 MW: net a(RS)->b(HU) is -400.
  assert.equal(built.borders["RS-HU"].flow.meanNet, -400);
  assert.equal(built.borders["RS-HU"].spreadStats.mean, -20);
  // Flow runs HU -> RS and RS is dearer: with the spread in every hour.
  assert.equal(built.borders["RS-HU"].alignment.withSpread, 1);
  // RS has eight borders but only two are covered, so no net position is reported.
  assert.equal(built.markets.RS.bordersCovered, 2);
  assert.equal(built.markets.RS.netImport, null);
  assert.equal(built.markets.XK.stats.negativeHours, 1);
  assert.equal(built.markets.BA.stats.base, null);

  const signals = region.computeSignals(built);
  assert.ok(signals.some((s) => s.id === "negative" && s.en.includes("XK 1 h")));
  assert.ok(
    signals.some((s) => s.id === "spread-RS-HU" && s.en.startsWith("HU → RS mean spread 20.0")),
  );
});

test("region: focus on a day slices by market-time day, and missing flows stay missing", () => {
  const two = series("2026-01-13T23:00:00Z", new Array(48).fill(50));
  const built = region.buildRegion({
    prices: { RS: { series: two, status: ok } },
    physical: {},
    focus: { mode: "day", day: "2026-01-15" },
  });
  assert.equal(built.markets.RS.series.t.length, 24);
  assert.equal(built.borders["RS-HU"].flow.meanNet, null);
  assert.deepEqual(region.daysBetween("2026-01-30", "2026-02-02"), [
    "2026-01-30",
    "2026-01-31",
    "2026-02-01",
    "2026-02-02",
  ]);
});

test("calendar buckets: ISO weeks across a year boundary, quarters and hour-weighted means", () => {
  assert.equal(a.bucketKey("2026-01-01", "week"), "2026-W01");
  assert.equal(a.bucketKey("2025-12-29", "week"), "2026-W01");
  assert.equal(a.bucketKey("2027-01-03", "week"), "2026-W53");
  assert.equal(a.bucketKey("2026-11-14", "quarter"), "2026-Q4");
  assert.equal(a.bucketKey("2026-11-14", "month"), "2026-11");
  // Two CET days: 24 h at 10 then 12 h at 40 -> month mean is hour weighted (20), not 25.
  const s = series("2026-01-13T23:00:00Z", [...new Array(24).fill(10), ...new Array(12).fill(40)]);
  const months = a.aggregateBy(s, "month");
  assert.equal(months.length, 1);
  assert.equal(months[0].hours, 36);
  assert.equal(months[0].base, 20);
  assert.equal(a.aggregateBy(s, "day").length, 2);
  assert.deepEqual(a.indexTo100({ t: [1, 2], v: [50, 75] }).v, [100, 150]);
  assert.equal(a.indexTo100({ t: [1], v: [-5] }).v.length, 0);
});

test("histogram uses nice edges, keeps every value and folds outliers into the end bins", () => {
  const values = [...Array.from({ length: 98 }, (_, i) => i / 10), 500, -500];
  const bins = a.histogram(values, 10);
  assert.equal(
    bins.reduce((sum, bin) => sum + bin.count, 0),
    values.length,
  );
  assert.ok(Math.abs(bins.reduce((sum, bin) => sum + bin.share, 0) - 1) < 1e-9);
  assert.ok(bins.length <= 12);
  // 1%–99% span is about 19.6, so ten bins round up to a step of 2.
  assert.equal(Number((bins[1].from - bins[0].from).toFixed(6)), 2);
  assert.deepEqual(a.histogram([5], 10), []);
});

// --- Alerts ------------------------------------------------------------------
async function loadAlerts() {
  const dir = path.join(outdir, "region");
  let source = await readFile(path.join(root, "src/lib/see/alerts.ts"), "utf8");
  source = source.replace(/from "\.\/(region|registry)"/g, 'from "./$1.mjs"');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  await writeFile(path.join(dir, "alerts.mjs"), result.outputText, "utf8");
  return import(pathToFileURL(path.join(dir, "alerts.mjs")).href);
}
const alerts = await loadAlerts();

test("alerts: each rule kind reports triggered, clear or no data with the observed figure", () => {
  const start = "2026-01-13T23:00:00Z";
  const flat = (value) => series(start, new Array(24).fill(value));
  const built = region.buildRegion({
    prices: {
      RS: { series: flat(100), status: ok },
      HU: { series: series(start, [-5, -1, ...new Array(22).fill(80)]), status: ok },
    },
    physical: { "RS-HU": { ab: flat(300), ba: flat(0), statusAB: ok, statusBA: ok } },
    focus: { mode: "day", day: "2026-01-14" },
  });
  const run = (rule) => alerts.evaluateAlert({ id: "x", ...rule }, built);

  assert.deepEqual(run({ kind: "price", market: "RS", basis: "base", op: "above", value: 90 }), {
    state: "triggered",
    observed: 100,
  });
  assert.equal(
    run({ kind: "price", market: "RS", basis: "base", op: "below", value: 90 }).state,
    "clear",
  );
  assert.deepEqual(run({ kind: "price", market: "HU", basis: "anyHour", op: "below", value: 0 }), {
    state: "triggered",
    observed: -5,
  });
  assert.equal(
    run({ kind: "price", market: "BA", basis: "base", op: "above", value: 1 }).state,
    "nodata",
  );
  assert.deepEqual(run({ kind: "negative", market: "HU", hours: 2 }), {
    state: "triggered",
    observed: 2,
  });
  assert.equal(run({ kind: "negative", market: "HU", hours: 3 }).state, "clear");

  // HU is cheaper than RS: the HU -> RS spread is positive, RS -> HU negative.
  const huToRs = run({ kind: "spread", border: "RS-HU", from: "HU", value: 10 });
  assert.equal(huToRs.state, "triggered");
  assert.ok(Math.abs(huToRs.observed - (100 - (22 * 80 - 6) / 24)) < 1e-9);
  assert.equal(run({ kind: "spread", border: "RS-HU", from: "RS", value: 10 }).state, "clear");
  assert.equal(run({ kind: "spread", border: "RS-BA", from: "RS", value: 1 }).state, "nodata");

  // Power flows RS -> HU although HU is cheaper in every hour.
  assert.deepEqual(run({ kind: "counterflow", border: "RS-HU", share: 0.5 }), {
    state: "triggered",
    observed: 1,
  });
  assert.equal(run({ kind: "counterflow", border: "RS-RO", share: 0.5 }).state, "nodata");

  assert.equal(
    alerts.describeAlert({ id: "x", kind: "spread", border: "RS-HU", from: "HU", value: 10 }, "en"),
    "Spread HU → RS above 10 €/MWh (day mean)",
  );
  assert.equal(
    alerts.sanitizeRules([
      { id: "a", kind: "price", market: "RS", basis: "base", op: "above", value: 5 },
      { id: "b", kind: "price", market: "ZZ", basis: "base", op: "above", value: 5 },
      { id: "c", kind: "spread", border: "RS-ZZ", from: "RS", value: 1 },
      "junk",
    ]).length,
    1,
  );
});
