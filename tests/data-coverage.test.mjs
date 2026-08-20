import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-data-coverage-tests");
await mkdir(outdir, { recursive: true });
const source = await readFile(path.join(root, "src/lib/data-coverage.ts"), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const outfile = path.join(outdir, "data-coverage.mjs");
await writeFile(outfile, transpiled.outputText, "utf8");
const coverage = await import(pathToFileURL(outfile).href);

test.after(async () => rm(outdir, { recursive: true, force: true }));

const fullBounds = {
  selectedFrom: "2026-07-01",
  selectedTo: "2026-07-31",
  availableFrom: "2026-07-01",
  availableTo: "2026-07-31",
};

test("live range with full bounds and no gaps is complete", () => {
  assert.equal(coverage.classifyCoverage({ source: "entsoe", ...fullBounds }), "complete");
});

test("internal missing day makes coverage partial even when bounds are full", () => {
  assert.equal(
    coverage.classifyCoverage({ source: "entsoe", ...fullBounds, missingDays: 1 }),
    "partial",
  );
});

test("incomplete day makes coverage partial", () => {
  assert.equal(
    coverage.classifyCoverage({ source: "entsoe", ...fullBounds, incompleteDays: 1 }),
    "partial",
  );
});

test("failed fetch makes coverage partial", () => {
  assert.equal(
    coverage.classifyCoverage({ source: "entsoe", ...fullBounds, failedFetches: 1 }),
    "partial",
  );
});

test("fetch cap makes coverage partial", () => {
  assert.equal(
    coverage.classifyCoverage({ source: "entsoe", ...fullBounds, capReached: true }),
    "partial",
  );
});

test("cache distinguishes complete and partial", () => {
  assert.equal(coverage.classifyCoverage({ source: "cache", ...fullBounds }), "cached-complete");
  assert.equal(
    coverage.classifyCoverage({ source: "cache", ...fullBounds, missingDays: 2 }),
    "cached-partial",
  );
});

test("none is unavailable", () => {
  assert.equal(coverage.classifyCoverage({ source: "none", ...fullBounds }), "unavailable");
});
