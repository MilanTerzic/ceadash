#!/usr/bin/env node
// Validates public/academy/catalog.json and reports which referenced files exist.
//
//   node scripts/check-academy.mjs            catalogue must be valid; missing files are warnings
//   node scripts/check-academy.mjs --strict   missing files fail too (run before announcing an episode)
//   node scripts/check-academy.mjs --remote   also HEAD-check files that live on mediaBase / absolute URLs
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const remote = process.argv.includes("--remote");

// Reuse the app's own parser so this check can never disagree with the browser.
const source = await readFile(path.join(root, "src/lib/academy/catalog.ts"), "utf8");
const out = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dir = await mkdtemp(path.join(tmpdir(), "academy-check-"));
const file = path.join(dir, "catalog.mjs");
await writeFile(file, out);
const { parseCatalog, resolveMedia } = await import(pathToFileURL(file).href);

const raw = JSON.parse(await readFile(path.join(root, "public/academy/catalog.json"), "utf8"));
const catalog = parseCatalog(raw);

let errors = 0;
let warnings = 0;
const fail = (message) => (console.error(`ERROR   ${message}`), errors++);
const warn = (message) => (console.warn(`WARN    ${message}`), warnings++);

for (const item of catalog.rejected) fail(`entry ${item.slug ?? `#${item.index}`}: ${item.reason}`);
if (!catalog.categories.length) fail("no categories defined");

async function exists(url) {
  // Lovable-hosted assets exist only on the platform; they cannot be checked from the repository.
  if (url.startsWith("/__l5e/")) return null;
  if (url.startsWith("/")) {
    try {
      await access(path.join(root, "public", url));
      return true;
    } catch {
      return false;
    }
  }
  if (!remote) return null; // not checked
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

for (const episode of catalog.episodes) {
  if (episode.status === "coming-soon") {
    console.log(`soon    ${episode.slug}: coming soon, files not checked`);
    continue;
  }
  const files = [
    ["video", episode.video],
    ["poster", episode.poster],
    ...episode.subtitles.map((track) => [`subtitles (${track.lang})`, track.src]),
  ];
  for (const [kind, value] of files) {
    if (!value) {
      if (kind === "poster") warn(`${episode.slug}: no poster, a text tile is shown instead`);
      continue;
    }
    const url = resolveMedia(value, catalog.mediaBase);
    const found = await exists(url);
    if (found === false) {
      (strict ? fail : warn)(`${episode.slug}: ${kind} not found: ${url}`);
    } else if (found === null) {
      console.log(`skipped ${episode.slug}: ${kind} is remote (${url}); use --remote to check`);
    }
  }
}

console.log(
  `\n${catalog.episodes.length} episode(s), ${catalog.categories.length} categor${catalog.categories.length === 1 ? "y" : "ies"}, ${errors} error(s), ${warnings} warning(s)`,
);
process.exit(errors ? 1 : 0);
