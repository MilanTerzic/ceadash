import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-interval-cache-tests");
const outfile = path.join(outdir, "interval-price-cache.server.mjs");

await mkdir(outdir, { recursive: true });
const source = await readFile(path.join(root, "src/lib/interval-price-cache.server.ts"), "utf8");
const result = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    verbatimModuleSyntax: true,
  },
});
await writeFile(outfile, result.outputText, "utf8");
const mod = await import(pathToFileURL(outfile).href);

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("interval cache preserves original timestamps and MTU", () => {
  const points = [
    { ts: "2026-08-20T10:00:00.000Z", price: 80, durationMinutes: 15 },
    { ts: "2026-08-20T10:15:00.000Z", price: 90, durationMinutes: 15 },
    { ts: "2026-08-20T10:30:00.000Z", price: 100, durationMinutes: 15 },
    { ts: "2026-08-20T10:45:00.000Z", price: 110, durationMinutes: 15 },
  ];
  const rows = mod.toIntervalRows("DA_HU", points);
  assert.deepEqual(rows.map((row) => row.datetime), points.map((point) => point.ts));
  assert.deepEqual(rows.map((row) => row.duration_minutes), [15, 15, 15, 15]);
  assert.deepEqual(mod.fromIntervalRows(rows), points);
});

test("interval cache never rounds quarter-hours to the top of the hour", () => {
  const points = mod.dedupeIntervalPoints([
    { ts: "2026-08-20T10:00:00.000Z", price: 80, durationMinutes: 15 },
    { ts: "2026-08-20T10:15:00.000Z", price: 90, durationMinutes: 15 },
  ]);
  assert.equal(points.length, 2);
  assert.equal(points[1].ts, "2026-08-20T10:15:00.000Z");
});

test("exact timestamp duplicates use the latest observation", () => {
  const points = mod.dedupeIntervalPoints([
    { ts: "2026-08-20T10:00:00.000Z", price: 80, durationMinutes: 60 },
    { ts: "2026-08-20T10:00:00.000Z", price: 82, durationMinutes: 60 },
  ]);
  assert.equal(points.length, 1);
  assert.equal(points[0].price, 82);
});

test("post-cutover coupled markets never trust duration-less legacy hourly rows", () => {
  assert.equal(
    mod.canUseLegacyHourlyFallback(
      "DA_HU",
      "2026-08-20T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z",
    ),
    false,
  );
  assert.equal(
    mod.canUseLegacyHourlyFallback(
      "DA_RO",
      "2025-09-01T00:00:00.000Z",
      "2025-09-02T00:00:00.000Z",
    ),
    true,
  );
});

test("Serbia can keep using known-hourly legacy cache after the SDAC cutover", () => {
  assert.equal(
    mod.canUseLegacyHourlyFallback(
      "DA_RS",
      "2026-08-20T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z",
    ),
    true,
  );
});
