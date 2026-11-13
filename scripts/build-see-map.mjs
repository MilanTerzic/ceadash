// Builds src/lib/see/see-map.generated.json from Natural Earth (world-atlas, public domain).
// Run: node scripts/build-see-map.mjs
// The app ships only the projected SVG paths, so d3-geo/topojson are build-time only.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { geoConicConformal, geoPath } from "d3-geo";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"));

const WIDTH = 1200;
const HEIGHT = 800;
// Lon/lat window: northern Italy to the Black Sea, Peloponnese to the Tatras. Wider than
// the core region so the map fills a landscape panel.
const WINDOW = {
  type: "Feature",
  geometry: {
    type: "MultiPoint",
    coordinates: [
      [9.2, 36.2],
      [32.8, 36.2],
      [7.6, 49.4],
      [34.4, 49.4],
      [21, 49.7],
      [21, 35.9],
    ],
  },
};

// ISO 3166-1 numeric -> alpha-2 for every country that can appear in the window.
const ISO = {
  "008": "AL",
  "040": "AT",
  "070": "BA",
  100: "BG",
  191: "HR",
  203: "CZ",
  276: "DE",
  300: "GR",
  348: "HU",
  380: "IT",
  498: "MD",
  499: "ME",
  807: "MK",
  616: "PL",
  642: "RO",
  688: "RS",
  703: "SK",
  705: "SI",
  792: "TR",
  804: "UA",
  756: "CH",
  438: "LI",
  674: "SM",
  112: "BY",
  470: "MT",
  788: "TN",
  434: "LY",
  250: "FR",
  643: "RU",
  492: "MC",
  "012": "DZ",
  196: "CY",
};

// Node anchors (lon, lat): where a market's marker sits. Chosen inside the territory,
// near the load centre, and nudged so neighbouring markers do not collide.
const ANCHORS = {
  RS: [20.9, 44.1],
  BA: [17.8, 44.2],
  ME: [19.25, 42.75],
  MK: [21.7, 41.6],
  AL: [20.0, 41.1],
  XK: [20.9, 42.6],
  HR: [15.9, 45.6],
  SI: [14.6, 46.1],
  BG: [25.2, 42.7],
  RO: [25.0, 45.9],
  GR: [22.2, 39.5],
  HU: [19.4, 47.1],
  AT: [14.3, 47.5],
  IT_NORD: [12.3, 45.7],
  IT_CSUD: [13.9, 42.3],
  IT_SUD: [17.2, 40.6],
  TR: [27.6, 41.3],
  SK: [19.0, 48.7],
  UA: [24.0, 48.6],
  MD: [28.6, 47.2],
};

const projection = geoConicConformal()
  .parallels([39, 47])
  .rotate([-21, 0])
  .fitExtent(
    [
      [0, 0],
      [WIDTH, HEIGHT],
    ],
    WINDOW,
  );
projection.clipExtent([
  [-2, -2],
  [WIDTH + 2, HEIGHT + 2],
]);
const path = geoPath(projection).digits(1);

const countries = [];
for (const f of feature(topo, topo.objects.countries).features) {
  const code = f.properties.name === "Kosovo" ? "XK" : ISO[f.id];
  if (!code) continue;
  const d = path(f);
  if (!d) continue;
  countries.push({ code, name: f.properties.name, d });
}
countries.sort((a, b) => a.code.localeCompare(b.code));

const anchors = Object.fromEntries(
  Object.entries(ANCHORS).map(([code, lonLat]) => {
    const [x, y] = projection(lonLat);
    return [code, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }];
  }),
);

const out = {
  source: "Natural Earth 1:50m admin-0 via world-atlas (public domain)",
  projection: "Conic conformal, parallels 39N/47N, central meridian 21E",
  width: WIDTH,
  height: HEIGHT,
  countries,
  anchors,
};
const target = new URL("../src/lib/see/see-map.generated.json", import.meta.url);
writeFileSync(target, JSON.stringify(out) + "\n");
console.log(`wrote ${countries.length} countries, ${JSON.stringify(out).length} bytes`);
console.log(countries.map((c) => `${c.code}:${c.d.length}`).join(" "));
