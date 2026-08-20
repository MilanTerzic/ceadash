import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src/lib/capture.functions.ts");
const source = await readFile(sourcePath, "utf8");
const start = source.indexOf("function stripNs");
const end = source.indexOf("export type EntsoeReason");
assert.ok(start >= 0 && end > start, "capture parser helpers must remain discoverable");
const parserSource = `${source.slice(start, end)}\nexport { parseTimeSeriesHourly };\n`;
const compiled = ts.transpileModule(parserSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const outdir = path.join(tmpdir(), `cea-capture-generation-${process.pid}`);
await mkdir(outdir, { recursive: true });
const outfile = path.join(outdir, "capture-parser.mjs");
await writeFile(outfile, compiled.outputText, "utf8");
const mod = await import(pathToFileURL(outfile).href);

test.after(async () => rm(outdir, { recursive: true, force: true }));

test("missing ENTSO-E generation positions are not forward-filled", () => {
  const xml = `
    <Publication_MarketDocument>
      <TimeSeries><mRID>A</mRID><Period>
        <timeInterval><start>2026-01-01T00:00Z</start><end>2026-01-01T03:00Z</end></timeInterval>
        <resolution>PT60M</resolution>
        <Point><position>1</position><quantity>10</quantity></Point>
        <Point><position>3</position><quantity>30</quantity></Point>
      </Period></TimeSeries>
    </Publication_MarketDocument>`;
  const points = mod.parseTimeSeriesHourly(xml);
  assert.deepEqual(points.map((point) => point.ts), [
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T02:00:00.000Z",
  ]);
  assert.deepEqual(points.map((point) => point.value), [10, 30]);
});

test("distinct generation TimeSeries are explicitly summed at the same timestamp", () => {
  const xml = `
    <Publication_MarketDocument>
      <TimeSeries><mRID>A</mRID><Period><timeInterval><start>2026-01-01T00:00Z</start></timeInterval>
        <resolution>PT60M</resolution><Point><position>1</position><quantity>10</quantity></Point>
      </Period></TimeSeries>
      <TimeSeries><mRID>B</mRID><Period><timeInterval><start>2026-01-01T00:00Z</start></timeInterval>
        <resolution>PT60M</resolution><Point><position>1</position><quantity>20</quantity></Point>
      </Period></TimeSeries>
    </Publication_MarketDocument>`;
  const points = mod.parseTimeSeriesHourly(xml);
  assert.equal(points.length, 1);
  assert.equal(points[0].value, 30);
});

test("capture series is read-only GET and missing wind is not coerced to zero", () => {
  assert.match(source, /fetchCaptureSeries\s*=\s*createServerFn\(\{\s*method:\s*["']GET["']/);
  assert.doesNotMatch(source, /wind:\s*windH\.get\(p\.ts\)\s*\?\?\s*0/);
  assert.match(source, /wind:\s*windH\.get\(p\.ts\)\s*\?\?\s*Number\.NaN/);
});
