import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const routes = path.join(src, "routes");

// "/dashboard/flows" -> "dashboard.flows.tsx", "/dashboard" -> "dashboard.index.tsx"
function routeFile(target) {
  const name = target === "/dashboard" ? "dashboard.index" : target.slice(1).replaceAll("/", ".");
  return path.join(routes, `${name}.tsx`);
}

test("every legacy redirect points at an existing canonical route", async () => {
  const files = (await readdir(routes)).filter((name) => name.endsWith(".tsx"));
  let redirects = 0;
  for (const name of files) {
    const source = await readFile(path.join(routes, name), "utf8");
    for (const match of source.matchAll(/legacyDashboardRedirect\(\s*"([^"]+)"/g)) {
      redirects += 1;
      await access(routeFile(match[1])).catch(() => {
        assert.fail(`${name} redirects to ${match[1]}, which has no route file`);
      });
    }
  }
  assert.ok(redirects > 0, "expected legacy redirects to audit");
});

test("legacy redirects preserve the shared dashboard search state", async () => {
  const source = await readFile(path.join(src, "lib/dashboard-redirect.ts"), "utf8");
  for (const key of ["from", "to", "preset", "compare", "asset"]) {
    assert.ok(source.includes(`"${key}"`), `redirect helper drops "${key}"`);
  }
});

test("dashboard search validation never throws on malformed params", async () => {
  const source = await readFile(path.join(routes, "dashboard.tsx"), "utf8");
  const schema = source.slice(
    source.indexOf("searchSchema = "),
    source.indexOf("export const Route"),
  );
  const fields = schema
    .split("\n")
    .filter((line) => /^\s+(from|to|preset|compare|asset):/.test(line));
  assert.equal(fields.length, 5);
  assert.equal((schema.match(/\.catch\(undefined\)/g) ?? []).length, 5);
});
