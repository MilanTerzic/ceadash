import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-fundamentals-tests");
const libOutdir = path.join(outdir, "lib");
const fflateModuleUrl = import.meta.resolve("fflate");

async function transpileModule(sourcePath, outPath, replacements = []) {
  let source = await readFile(sourcePath, "utf8");
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
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
await transpileModule(
  path.join(root, "src/lib/fundamentals.ts"),
  path.join(libOutdir, "fundamentals.mjs"),
);
await transpileModule(path.join(root, "src/lib/markets.ts"), path.join(libOutdir, "markets.mjs"));
await transpileModule(
  path.join(root, "src/lib/entsoe-outages.ts"),
  path.join(libOutdir, "entsoe-outages.mjs"),
  [
    ['from "./fundamentals"', 'from "./fundamentals.mjs"'],
    ['from "./markets"', 'from "./markets.mjs"'],
  ],
);
await transpileModule(
  path.join(root, "src/lib/entsoe-token.ts"),
  path.join(libOutdir, "entsoe-token.mjs"),
);
await transpileModule(
  path.join(root, "src/lib/entsoe-zip.ts"),
  path.join(libOutdir, "entsoe-zip.mjs"),
  [['from "fflate"', `from "${fflateModuleUrl}"`]],
);

const fundamentals = await import(pathToFileURL(path.join(libOutdir, "fundamentals.mjs")).href);
const outages = await import(pathToFileURL(path.join(libOutdir, "entsoe-outages.mjs")).href);
const tokens = await import(pathToFileURL(path.join(libOutdir, "entsoe-token.mjs")).href);
const entsoeZip = await import(pathToFileURL(path.join(libOutdir, "entsoe-zip.mjs")).href);
const outageXml = await readFile(
  path.join(root, "tests/fixtures/entsoe-outage.sample.xml"),
  "utf8",
);
const acknowledgementXml = await readFile(
  path.join(root, "tests/fixtures/entsoe-acknowledgement.sample.xml"),
  "utf8",
);

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("weather ranges split into historical and forecast portions", () => {
  assert.deepEqual(fundamentals.splitWeatherRange("2026-07-01", "2026-07-20", "2026-07-20"), [
    { kind: "historical", from: "2026-07-01", to: "2026-07-19" },
    { kind: "forecast", from: "2026-07-20", to: "2026-07-20" },
  ]);
  assert.deepEqual(fundamentals.splitWeatherRange("2026-01-01", "2026-01-31", "2026-07-20"), [
    { kind: "historical", from: "2026-01-01", to: "2026-01-31" },
  ]);
});

test("weather observations merge, deduplicate and reject malformed values", () => {
  const merged = fundamentals.mergeWeatherPoints([
    [
      {
        ts: "2026-07-20T01:00:00.000Z",
        temp_c: 20,
        wind_ms: 4,
        source: "open-meteo-forecast",
      },
      {
        ts: "bad",
        temp_c: 20,
        wind_ms: 4,
        source: "open-meteo-forecast",
      },
    ],
    [
      {
        ts: "2026-07-20T01:00:00Z",
        temp_c: 21,
        wind_ms: 5,
        source: "open-meteo-historical",
      },
      {
        ts: "2026-07-20T00:00:00Z",
        temp_c: 19,
        wind_ms: 3,
        source: "open-meteo-historical",
      },
    ],
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].ts, "2026-07-20T00:00:00.000Z");
  assert.equal(merged[1].temp_c, 21);
});

test("wind speed conversion occurs exactly once", () => {
  assert.equal(fundamentals.kmhToMs(36), 10);
  const points = fundamentals.normalizeOpenMeteoWeather(
    {
      hourly: {
        time: ["2026-07-20T00:00"],
        temperature_2m: [20],
        wind_speed_10m: [3.6],
      },
    },
    "open-meteo-forecast",
  );
  assert.equal(points[0].wind_ms, 3.6);
});

test("weather reports partial status when one zone fails", () => {
  const status = fundamentals.aggregateDataStatus(
    [
      {
        source: "RS",
        status: "live",
        fetched_at: "2026-07-20T00:00:00Z",
      },
      {
        source: "HU",
        status: "error",
        reason: "http_500",
        fetched_at: "2026-07-20T00:00:00Z",
      },
    ],
    "Open-Meteo weather",
  );
  assert.equal(status.status, "partial");
});

test("hydrology removes null, negative, malformed and duplicate values", () => {
  const normalized = fundamentals.normalizeDischargePayload({
    latitude: 44.825,
    longitude: 20.375,
    daily: {
      time: ["2026-07-18", "2026-07-19", "2026-07-19", "2026-07-20", "bad"],
      river_discharge: [1000, null, 1100, -1, 1200],
    },
  });
  assert.deepEqual(normalized.data, [
    { date: "2026-07-18", discharge_m3s: 1000 },
    { date: "2026-07-19", discharge_m3s: 1100 },
  ]);
  assert.deepEqual(normalized.selected_coordinates, { lat: 44.825, lon: 20.375 });
});

test("hydrology fallback chooses the candidate with the most valid observations", () => {
  const selected = fundamentals.selectBestHydrologyCandidate([
    {
      data: [{ date: "2026-07-20", discharge_m3s: 1000 }],
      query_coordinates: { lat: 44.8, lon: 20.4 },
      selected_coordinates: { lat: 44.8, lon: 20.4 },
    },
    {
      data: [
        { date: "2026-07-19", discharge_m3s: 990 },
        { date: "2026-07-20", discharge_m3s: 1000 },
      ],
      query_coordinates: { lat: 44.85, lon: 20.4 },
      selected_coordinates: { lat: 44.85, lon: 20.4 },
    },
  ]);
  assert.equal(selected.data.length, 2);
  assert.equal(selected.query_coordinates.lat, 44.85);
});

test("Danube candidate validation rejects tiny non-river runoff cells", () => {
  assert.deepEqual(
    fundamentals.filterPlausibleDanubeDischarge([
      { date: "2026-07-19", discharge_m3s: 0 },
      { date: "2026-07-20", discharge_m3s: 0.5 },
    ]),
    [],
  );
  assert.deepEqual(
    fundamentals.filterPlausibleDanubeDischarge([
      { date: "2026-07-19", discharge_m3s: 0 },
      { date: "2026-07-20", discharge_m3s: 1500 },
    ]),
    [{ date: "2026-07-20", discharge_m3s: 1500 }],
  );
});

test("one hydrology station failure produces partial rather than empty status", () => {
  const status = fundamentals.aggregateDataStatus(
    [
      { source: "Zemun", status: "live", fetched_at: "2026-07-20T00:00:00Z" },
      {
        source: "Prahovo",
        status: "error",
        reason: "no_valid_discharge_observations",
        fetched_at: "2026-07-20T00:00:00Z",
      },
    ],
    "Open-Meteo hydrology",
  );
  assert.equal(status.status, "partial");
});

test("ENTSO-E outage parser preserves available capacity and calculates unavailable capacity", () => {
  const rows = outages.parseOutageRows(outageXml, "RS", "2026-07-15", "2026-07-16");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unit, "Anonymous Unit");
  assert.equal(rows[0].outage_type, "planned");
  assert.equal(rows[0].available_mw, 200);
  assert.equal(rows[0].normal_capacity_mw, 500);
  assert.equal(rows[0].unavailable_mw, 300);
  assert.equal(rows[0].mw, 300);
  assert.equal(rows[0].type, "planned");
  assert.equal(rows[0].source, "ENTSO-E A77");
});

test("outage revision deduplication retains the latest valid revision", () => {
  const older = outages.parseOutageRows(outageXml, "RS", "2026-07-15", "2026-07-16");
  const newerXml = outageXml
    .replace("<revisionNumber>1</revisionNumber>", "<revisionNumber>2</revisionNumber>")
    .replace("<quantity>200</quantity>", "<quantity>250</quantity>");
  const newer = outages.parseOutageRows(newerXml, "RS", "2026-07-15", "2026-07-16");
  const deduped = outages.dedupeOutageRevisions([...older, ...newer]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].revision, 2);
  assert.equal(deduped[0].unavailable_mw, 250);
});

test("cancelled latest outage revision removes the publication", () => {
  const older = outages.parseOutageRows(outageXml, "RS", "2026-07-15", "2026-07-16");
  const cancelledXml = outageXml
    .replace("<revisionNumber>1</revisionNumber>", "<revisionNumber>2</revisionNumber>")
    .replace("<value>A05</value>", "<value>A09</value>");
  const cancelled = outages.parseOutageRows(cancelledXml, "RS", "2026-07-15", "2026-07-16");
  assert.deepEqual(outages.dedupeOutageRevisions([...older, ...cancelled]), []);
});

test("planned and forced business types are mapped explicitly", () => {
  assert.equal(outages.outageTypeFromBusinessType("A53"), "planned");
  assert.equal(outages.outageTypeFromBusinessType("A54"), "forced");
  assert.equal(outages.outageTypeFromBusinessType("B18"), "unknown");
});

test("outage date ranges are split into no more than 31 days", () => {
  const chunks = outages.chunkOutageRange("2026-01-01", "2026-03-05");
  assert.deepEqual(chunks, [
    { from: "2026-01-01", to: "2026-01-31" },
    { from: "2026-02-01", to: "2026-03-03" },
    { from: "2026-03-04", to: "2026-03-05" },
  ]);
});

test("ENTSO-E acknowledgement XML is recognized as no data", () => {
  assert.deepEqual(outages.inspectEntsoeXml(acknowledgementXml), {
    kind: "no_data",
    reason: "entsoe_no_data",
  });
});

test("ENTSO-E ZIP responses extract and parse every XML document", () => {
  const secondXml = outageXml
    .replace("DOC-ANON-1", "DOC-ANON-2")
    .replace("UNIT-ANON-1", "UNIT-ANON-2")
    .replace("Anonymous Unit", "Second Anonymous Unit");
  const archive = zipSync({
    "first.xml": strToU8(outageXml),
    "nested/second.XML": strToU8(secondXml),
    "readme.txt": strToU8("not an XML document"),
  });
  assert.equal(entsoeZip.isZipPayload(archive, "application/zip"), true);
  const documents = entsoeZip.extractEntsoeZipDocuments(archive);
  const rows = documents.flatMap((xml) =>
    outages.parseOutageRows(xml, "RS", "2026-07-15", "2026-07-16"),
  );
  assert.equal(documents.length, 2);
  assert.deepEqual(rows.map((row) => row.unit).sort(), ["Anonymous Unit", "Second Anonymous Unit"]);
});

test("ENTSO-E ZIP responses reject archives without XML documents", () => {
  const archive = zipSync({ "readme.txt": strToU8("not an XML document") });
  assert.throws(() => entsoeZip.extractEntsoeZipDocuments(archive), /entsoe_zip_no_xml_documents/);
});

test("canonical ENTSO-E token name takes precedence and missing token is explicit", () => {
  assert.deepEqual(
    tokens.resolveEntsoeToken({
      ENTSOE_SECURITY_TOKEN: "canonical",
      ENTSOE_API_TOKEN: "alias",
    }),
    { token: "canonical", envName: "ENTSOE_SECURITY_TOKEN" },
  );
  assert.equal(tokens.resolveEntsoeToken({}), null);
});

test("load and generation merge independently with duplicate timestamps removed", () => {
  const merged = fundamentals.mergeLoadGeneration(
    [
      { ts: "2026-07-20T00:00:00Z", load_mw: 4000, durationMinutes: 60 },
      { ts: "2026-07-20T00:00:00Z", load_mw: 4100, durationMinutes: 30 },
    ],
    [{ ts: "2026-07-20T01:00:00Z", gen_mw: 3500, durationMinutes: 15 }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].load_mw, 4100);
  assert.equal(merged[0].gen_mw, null);
  assert.equal(merged[1].load_mw, null);
  assert.equal(merged[1].gen_mw, 3500);
  assert.equal(fundamentals.durationWeightedAverage(merged, "load_mw"), 4100);
});

test("empty source status remains distinct from source error", () => {
  const empty = fundamentals.aggregateDataStatus(
    [{ source: "ENTSO-E", status: "empty", fetched_at: "2026-07-20T00:00:00Z" }],
    "ENTSO-E outages",
  );
  const error = fundamentals.aggregateDataStatus(
    [
      {
        source: "ENTSO-E",
        status: "error",
        reason: "entsoe_token_missing",
        fetched_at: "2026-07-20T00:00:00Z",
      },
    ],
    "ENTSO-E outages",
  );
  assert.equal(empty.status, "empty");
  assert.equal(error.status, "error");
});
