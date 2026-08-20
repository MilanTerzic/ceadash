import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-admin-write-tests");
const outfile = path.join(outdir, "admin-write-guard.mjs");

await mkdir(outdir, { recursive: true });
const source = await readFile(path.join(root, "src/lib/admin-write-guard.ts"), "utf8");
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

test("missing token is rejected", () => {
  assert.equal(mod.isValidAdminWriteToken(undefined, "secret-token"), false);
});

test("missing configured secret is rejected", () => {
  assert.equal(mod.isValidAdminWriteToken("secret-token", undefined), false);
});

test("wrong token is rejected", () => {
  assert.equal(mod.isValidAdminWriteToken("wrong-token", "secret-token"), false);
});

test("correct token is accepted", () => {
  assert.equal(mod.isValidAdminWriteToken("secret-token", "secret-token"), true);
});
