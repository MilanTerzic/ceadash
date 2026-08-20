import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-flow-tests");
const outfile = path.join(outdir, "flow-calculations.mjs");

await mkdir(outdir, { recursive: true });
const source = await readFile(path.join(root, "src/lib/flow-calculations.ts"), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
});
await writeFile(outfile, transpiled.outputText, "utf8");
const mod = await import(pathToFileURL(outfile).href);

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("missing export observation is not converted to zero", () => {
  const result = mod.mergeDirectionalFlowPoints(
    [
      { ts: "2026-08-20T00:00:00.000Z", mw: 100 },
      { ts: "2026-08-20T01:00:00.000Z", mw: 120 },
    ],
    [{ ts: "2026-08-20T00:00:00.000Z", mw: 40 }],
  );

  assert.deepEqual(result.hourly, [
    { ts: "2026-08-20T00:00:00.000Z", imp_mw: 100, exp_mw: 40, net_mw: 60 },
  ]);
  assert.equal(result.unmatchedIntervals, 1);
});

test("missing import observation is not converted to zero", () => {
  const result = mod.mergeDirectionalFlowPoints(
    [{ ts: "2026-08-20T00:00:00.000Z", mw: 100 }],
    [
      { ts: "2026-08-20T00:00:00.000Z", mw: 40 },
      { ts: "2026-08-20T01:00:00.000Z", mw: 30 },
    ],
  );

  assert.equal(result.hourly.length, 1);
  assert.equal(result.hourly[0].net_mw, 60);
  assert.equal(result.unmatchedIntervals, 1);
});

test("real measured zero remains a valid observation", () => {
  const result = mod.mergeDirectionalFlowPoints(
    [{ ts: "2026-08-20T00:00:00.000Z", mw: 0 }],
    [{ ts: "2026-08-20T00:00:00.000Z", mw: 0 }],
  );

  assert.deepEqual(result.hourly, [
    { ts: "2026-08-20T00:00:00.000Z", imp_mw: 0, exp_mw: 0, net_mw: 0 },
  ]);
  assert.equal(result.unmatchedIntervals, 0);
});
