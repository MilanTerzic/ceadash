import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-outage-revision-tests");

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

await mkdir(outdir, { recursive: true });
await transpileModule(path.join(root, "src/lib/fundamentals.ts"), path.join(outdir, "fundamentals.mjs"));
await transpileModule(path.join(root, "src/lib/markets.ts"), path.join(outdir, "markets.mjs"));
await transpileModule(
  path.join(root, "src/lib/entsoe-outages.ts"),
  path.join(outdir, "entsoe-outages.mjs"),
  [
    ['from "./fundamentals"', 'from "./fundamentals.mjs"'],
    ['from "./markets"', 'from "./markets.mjs"'],
  ],
);

const outages = await import(pathToFileURL(path.join(outdir, "entsoe-outages.mjs")).href);
const outageXml = await readFile(
  path.join(root, "tests/fixtures/entsoe-outage.sample.xml"),
  "utf8",
);

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("latest ENTSO-E revision replaces older periods when dates change", () => {
  const older = outages.parseOutageRows(outageXml, "RS", "2026-07-15", "2026-07-18");
  const newerXml = outageXml
    .replace("<revisionNumber>1</revisionNumber>", "<revisionNumber>2</revisionNumber>")
    .replaceAll("2026-07-15", "2026-07-17")
    .replaceAll("2026-07-16", "2026-07-18");
  const newer = outages.parseOutageRows(newerXml, "RS", "2026-07-15", "2026-07-18");

  const deduped = outages.dedupeOutageRevisions([...older, ...newer]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].revision, 2);
  assert.equal(deduped[0].start.slice(0, 10), "2026-07-17");
  assert.equal(deduped[0].end.slice(0, 10), "2026-07-18");
});

test("cancellation revision without TimeSeries removes older active outage", () => {
  const older = outages.parseOutageRows(outageXml, "RS", "2026-07-15", "2026-07-16");
  const cancelledWithoutSeries = outageXml
    .replace("<revisionNumber>1</revisionNumber>", "<revisionNumber>2</revisionNumber>")
    .replace("<value>A05</value>", "<value>A09</value>")
    .replace(/\s*<TimeSeries>[\s\S]*?<\/TimeSeries>\s*/, "\n");
  const cancelled = outages.parseOutageRows(
    cancelledWithoutSeries,
    "RS",
    "2026-07-15",
    "2026-07-16",
  );

  assert.equal(cancelled.length, 1, "internal cancellation marker should be retained for dedupe");
  assert.deepEqual(outages.dedupeOutageRevisions([...older, ...cancelled]), []);
});
