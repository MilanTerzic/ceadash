import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-nav-tests");
await mkdir(outdir, { recursive: true });
const source = await readFile(path.join(root, "src/components/shell/nav-structure.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const file = path.join(outdir, "nav-structure.mjs");
await writeFile(file, compiled);
const nav = await import(pathToFileURL(file).href);

const routesDir = path.join(root, "src/routes");
async function realDashboardRoutes() {
  const out = [];
  for (const name of await readdir(routesDir)) {
    if (!/^dashboard\..+\.tsx$/.test(name)) continue;
    const text = await readFile(path.join(routesDir, name), "utf8");
    const match = /createFileRoute\("([^"]+)"\)/.exec(text);
    if (!match) continue;
    // Redirect-only routes forward to a real page and need no menu entry.
    if (text.includes("legacyDashboardRedirect") || text.includes("throw redirect(")) continue;
    // Dynamic children (an episode) belong to their parent's workspace.
    if (match[1].includes("$")) continue;
    out.push(match[1].replace(/\/$/, ""));
  }
  return out;
}

test("the menu has seven daily workspaces", () => {
  assert.equal(nav.NAV.filter((workspace) => workspace.primary).length, 7);
});

test("every real dashboard page is reachable from the menu", async () => {
  const reachable = new Set(nav.navDestinations().map((destination) => destination.to));
  const routes = await realDashboardRoutes();
  assert.ok(routes.length >= 15, "route scan found the pages");
  const missing = routes.filter((route) => !reachable.has(route));
  assert.deepEqual(missing, []);
});

test("every menu destination is a real page", async () => {
  const routes = new Set(await realDashboardRoutes());
  const stale = nav
    .navDestinations()
    .map((destination) => destination.to)
    .filter((to) => !routes.has(to));
  assert.deepEqual(stale, []);
});

test("no page appears twice", () => {
  const targets = nav.navDestinations().map((destination) => destination.to);
  assert.equal(new Set(targets).size, targets.length);
});

test("pages resolve to their workspace and tab", () => {
  assert.equal(nav.navWorkspaceFor("/dashboard").id, "command");
  assert.equal(nav.navWorkspaceFor("/dashboard/flows").id, "borders");
  assert.equal(nav.navWorkspaceFor("/dashboard/balance/").id, "borders");
  assert.equal(nav.navWorkspaceFor("/dashboard/outages").id, "fundamentals");
  assert.equal(nav.navWorkspaceFor("/dashboard/capture").id, "projects");
  assert.equal(nav.navWorkspaceFor("/dashboard/calculator").id, "projects");
  assert.equal(nav.navWorkspaceFor("/dashboard/insights").id, "watch");
  assert.equal(nav.navWorkspaceFor("/dashboard/academy/some-episode").id, "academy");
  assert.equal(nav.navWorkspaceFor("/dashboard/unknown").id, "command");

  const borders = nav.NAV.find((workspace) => workspace.id === "borders");
  assert.equal(nav.navTabFor(borders, "/dashboard/flows").to, "/dashboard/flows");
  assert.equal(nav.navTabFor(borders, "/dashboard/borders").to, "/dashboard/borders");
  const prices = nav.NAV.find((workspace) => workspace.id === "prices");
  assert.equal(nav.navTabFor(prices, "/dashboard/prices"), null);
});

test("tab landing pages match their workspace", () => {
  for (const workspace of nav.NAV) {
    if (workspace.tabs.length) assert.equal(workspace.tabs[0].to, workspace.to);
  }
});
