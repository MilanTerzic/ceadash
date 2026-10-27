import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-belgrade-delivery-tests");
const outfile = path.join(outdir, "belgrade-delivery-boundary.mjs");

await mkdir(outdir, { recursive: true });
const source = await readFile(path.join(root, "src/lib/belgrade-delivery-boundary.ts"), "utf8");
await writeFile(outfile, ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText, "utf8");
const { belgradeDeliveryStartUtc } = await import(pathToFileURL(outfile).href);
test.after(async () => rm(outdir, { recursive: true, force: true }));

test("Belgrade day boundaries track spring DST without losing the first hour", () => {
  assert.equal(belgradeDeliveryStartUtc("2026-03-29").toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(belgradeDeliveryStartUtc("2026-03-30").toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(
    (belgradeDeliveryStartUtc("2026-03-30") - belgradeDeliveryStartUtc("2026-03-29")) / 3600000,
    23,
  );
});

test("Belgrade day boundaries cover all 25 hours of autumn DST transition", () => {
  assert.equal(belgradeDeliveryStartUtc("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(belgradeDeliveryStartUtc("2026-10-26").toISOString(), "2026-10-25T23:00:00.000Z");
  assert.equal(
    (belgradeDeliveryStartUtc("2026-10-26") - belgradeDeliveryStartUtc("2026-10-25")) / 3600000,
    25,
  );
});

test("normal winter/summer delivery windows are exactly 24 hours", () => {
  for (const day of ["2026-01-10", "2026-07-10"]) {
    const next = new Date(day + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    assert.equal(
      (belgradeDeliveryStartUtc(next.toISOString().slice(0, 10)) -
        belgradeDeliveryStartUtc(day)) /
        3600000,
      24,
    );
  }
});

test("invalid delivery-day input is rejected", () => {
  assert.throws(() => belgradeDeliveryStartUtc("2026-02-30"), /invalid_delivery_date/);
  assert.throws(() => belgradeDeliveryStartUtc("2026/10/25"), /invalid_delivery_date/);
});
