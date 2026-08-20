import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/routes");

test("active routes do not consume legacy explicit-allocation snapshot semantics", async () => {
  const files = (await readdir(root)).filter((name) => /\.(ts|tsx)$/.test(name));
  const offenders = [];
  for (const name of files) {
    const source = await readFile(path.join(root, name), "utf8");
    if (source.includes("getDashboardSnapshot") || source.includes("fetchExplicitAllocation")) {
      offenders.push(name);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Legacy auction-capacity path is still used by active routes: ${offenders.join(", ")}`,
  );
});
