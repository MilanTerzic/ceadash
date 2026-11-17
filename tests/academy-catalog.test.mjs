import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "cea-academy-tests");
await mkdir(outdir, { recursive: true });
const source = await readFile(path.join(root, "src/lib/academy/catalog.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const file = path.join(outdir, "catalog.mjs");
await writeFile(file, compiled);
const lib = await import(pathToFileURL(file).href);

const categories = [
  { id: "b", order: 2, title: "Second" },
  { id: "a", order: 1, title: { en: "First", sr: "Prvo" } },
];
const episode = (slug, extra = {}) => ({
  slug,
  number: 1,
  category: "a",
  title: slug,
  description: "text",
  video: "videos/x.mp4",
  ...extra,
});

test("the shipped catalogue is valid and every entry parses", async () => {
  const raw = JSON.parse(await readFile(path.join(root, "public/academy/catalog.json"), "utf8"));
  const catalog = lib.parseCatalog(raw);
  assert.deepEqual(catalog.rejected, []);
  assert.ok(catalog.episodes.length >= 1);
  assert.equal(catalog.episodes[0].slug, "how-european-power-markets-work");
});

test("a bad episode is rejected without losing the rest", () => {
  const catalog = lib.parseCatalog({
    categories,
    episodes: [
      episode("good"),
      episode("Bad Slug"),
      episode("good"),
      episode("no-category", { category: "zzz" }),
      { slug: "no-video", category: "a", title: "t", description: "d" },
      "nonsense",
    ],
  });
  assert.deepEqual(
    catalog.episodes.map((item) => item.slug),
    ["good"],
  );
  assert.equal(catalog.rejected.length, 5);
});

test("episodes sort by category order, then number; drafts are hidden", () => {
  const catalog = lib.parseCatalog({
    categories,
    episodes: [
      episode("b1", { category: "b", number: 1 }),
      episode("a2", { number: 2 }),
      episode("a1", { number: 1 }),
      episode("hidden", { number: 3, draft: true }),
    ],
  });
  assert.deepEqual(
    catalog.episodes.map((item) => item.slug),
    ["a1", "a2", "b1"],
  );
});

test("next and previous follow library order across categories", () => {
  const catalog = lib.parseCatalog({
    categories,
    episodes: [episode("a1"), episode("b1", { category: "b" })],
  });
  assert.equal(lib.nextEpisode(catalog, "a1").slug, "b1");
  assert.equal(lib.nextEpisode(catalog, "b1"), null);
  assert.equal(lib.previousEpisode(catalog, "b1").slug, "a1");
  assert.equal(lib.previousEpisode(catalog, "a1"), null);
  assert.equal(lib.nextEpisode(catalog, "missing"), null);
  assert.equal(lib.libraryNumber(catalog, "b1"), 2);
});

test("topic links prefer tagged episodes and fall back to foundational ones", () => {
  const catalog = lib.parseCatalog({
    categories,
    episodes: [
      episode("intro", { foundational: true }),
      episode("bess", { number: 2, topics: ["battery"] }),
    ],
  });
  const direct = lib.episodesForTopics(catalog, ["battery", "intraday"]);
  assert.deepEqual(
    direct.episodes.map((item) => item.slug),
    ["bess"],
  );
  assert.equal(direct.fallback, false);
  const fallback = lib.episodesForTopics(catalog, ["futures"]);
  assert.deepEqual(
    fallback.episodes.map((item) => item.slug),
    ["intro"],
  );
  assert.equal(fallback.fallback, true);
});

test("media paths resolve against mediaBase only when relative", () => {
  const base = "https://cdn.example.com/academy/";
  assert.equal(
    lib.resolveMedia("videos/a.mp4", base),
    "https://cdn.example.com/academy/videos/a.mp4",
  );
  assert.equal(lib.resolveMedia("/academy/p.svg", base), "/academy/p.svg");
  assert.equal(
    lib.resolveMedia("https://other.example/a.mp4", base),
    "https://other.example/a.mp4",
  );
  assert.equal(lib.resolveMedia("videos/a.mp4", ""), "/videos/a.mp4");
  assert.equal(lib.resolveMedia(undefined, base), undefined);
});

test("localized text falls back to English, and durations never invent a value", () => {
  assert.equal(lib.localize({ en: "Hi", sr: "Zdravo" }, "sr"), "Zdravo");
  assert.equal(lib.localize({ en: "Hi" }, "sr"), "Hi");
  assert.equal(lib.localize("same", "sr"), "same");
  assert.equal(lib.formatDuration(undefined), null);
  assert.equal(lib.formatDuration(0), null);
  assert.equal(lib.formatDuration(125), "2:05");
  assert.equal(lib.formatDuration(3725), "1:02:05");
});

test("video mime type comes from the extension", () => {
  assert.equal(lib.videoMimeType("a/b.mp4?x=1"), "video/mp4");
  assert.equal(lib.videoMimeType("a.webm"), "video/webm");
  assert.equal(lib.videoMimeType("a.m3u8"), undefined);
});

test("coming-soon episodes need no video, are listed, and are skipped by next/previous", () => {
  const catalog = lib.parseCatalog({
    categories,
    episodes: [
      episode("one"),
      { ...episode("two", { number: 2 }), status: "coming-soon", video: undefined },
      episode("three", { number: 3 }),
    ],
  });
  assert.deepEqual(
    catalog.episodes.map((item) => item.slug),
    ["one", "two", "three"],
  );
  assert.equal(lib.isPlayable(catalog.episodes[1]), false);
  assert.equal(lib.nextEpisode(catalog, "one").slug, "three");
  assert.equal(lib.previousEpisode(catalog, "three").slug, "one");
  assert.equal(lib.nextEpisode(catalog, "two").slug, "three");
});

test("a published episode still requires a video", () => {
  const catalog = lib.parseCatalog({
    categories,
    episodes: [{ ...episode("x"), video: "" }],
  });
  assert.equal(catalog.episodes.length, 0);
  assert.match(catalog.rejected[0].reason, /video/);
});

test("topic links offer playable episodes and report announced ones separately", () => {
  const catalog = lib.parseCatalog({
    categories,
    episodes: [
      episode("intro", { foundational: true }),
      { ...episode("soon", { number: 2, topics: ["intraday"] }), status: "coming-soon" },
    ],
  });
  const match = lib.episodesForTopics(catalog, ["intraday"]);
  assert.deepEqual(
    match.episodes.map((item) => item.slug),
    ["intro"],
  );
  assert.equal(match.fallback, true);
  assert.deepEqual(
    match.upcoming.map((item) => item.slug),
    ["soon"],
  );
});

test("key points and sources are parsed; non-http sources are dropped", () => {
  const catalog = lib.parseCatalog({
    categories,
    episodes: [
      episode("a", {
        learn: ["One", { en: "Two", sr: "Dva" }, "", 5],
        sources: [
          { url: "https://www.example.org/page" },
          "https://ems.rs/x",
          "javascript:alert(1)",
          { url: "ftp://x" },
        ],
      }),
    ],
  });
  const item = catalog.episodes[0];
  assert.equal(item.learn.length, 2);
  assert.deepEqual(
    item.sources.map((source) => source.label),
    ["example.org", "ems.rs"],
  );
});

test("the shipped series lists episodes 1 to 7 in order, all playable", async () => {
  const raw = JSON.parse(await readFile(path.join(root, "public/academy/catalog.json"), "utf8"));
  const catalog = lib.parseCatalog(raw);
  assert.deepEqual(
    catalog.episodes.map((item) => item.slug),
    [
      "how-european-power-markets-work",
      "ep02-how-day-ahead-electricity-markets-work",
      "ep03-intraday-electricity-trading",
      "ep04-balancing-markets-and-imbalance-settlement",
      "ep05-ancillary-services-fcr-afrr-mfrr-explained",
      "ep06-power-futures-forwards-and-hedging",
      "ep07-cross-border-trading-and-market-coupling",
    ],
  );
  // Nothing is announced as "coming soon" in the library; every listed episode has a video.
  assert.ok(catalog.episodes.every((item) => item.status === "published" && item.video));
  assert.ok(catalog.episodes.every((item) => item.durationSeconds > 0));
});
