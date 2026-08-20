import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/routes");

test("active routes do not import the legacy DA profile function from data.functions", async () => {
  const files = (await readdir(root)).filter((name) => name.endsWith(".tsx"));
  const offenders = [];
  for (const name of files) {
    const source = await readFile(path.join(root, name), "utf8");
    if (
      source.includes("getAverageDAProfile") &&
      /from\s+["']@\/lib\/data\.functions["']/.test(source)
    ) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, []);
});
