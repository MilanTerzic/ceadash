import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

test("every POST TanStack server function is admin-guarded or rate-limited", async () => {
  const files = await walk(root);
  const unguarded = [];
  let postCount = 0;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const re = /createServerFn\(\{\s*method:\s*["']POST["']\s*\}\)/g;
    let match;
    while ((match = re.exec(source))) {
      postCount += 1;
      // Inspect the server-function definition through the next declaration or EOF.
      const start = match.index;
      const nextExport = source.indexOf("\nexport const ", start + match[0].length);
      const block = source.slice(start, nextExport === -1 ? source.length : nextExport);
      if (!block.includes("requireAdminWriteToken(") && !block.includes("enforceAdminRateLimit(")) {
        unguarded.push(path.relative(root, file));
      }
    }
  }

  assert.ok(postCount > 0, "expected at least one POST server function to audit");
  assert.deepEqual(
    unguarded,
    [],
    `POST server functions without requireAdminWriteToken/enforceAdminRateLimit guard: ${unguarded.join(", ")}`,
  );
});
