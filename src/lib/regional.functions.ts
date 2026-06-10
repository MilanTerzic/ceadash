import { createServerFn } from "@tanstack/react-start";

export type ZoneCode =
  | "RS" | "HU" | "RO" | "BG" | "MK" | "AL" | "ME" | "BA" | "HR" | "SI" | "GR" | "IT";

export const ZONES: Record<ZoneCode, { name: string; eic: string; lat: number; lng: number }> = {
  RS: { name: "Serbia", eic: "10YCS-SERBIATSOV", lat: 44.0, lng: 20.9 },
  HU: { name: "Hungary", eic: "10YHU-MAVIR----U", lat: 47.2, lng: 19.5 },
  RO: { name: "Romania", eic: "10YRO-TEL------P", lat: 45.9, lng: 25.0 },
  BG: { name: "Bulgaria", eic: "10YCA-BULGARIA-R", lat: 42.7, lng: 25.5 },
  MK: { name: "North Macedonia", eic: "10YMK-MEPSO----8", lat: 41.6, lng: 21.7 },
  AL: { name: "Albania", eic: "10YAL-KESH-----5", lat: 41.0, lng: 20.0 },
  ME: { name: "Montenegro", eic: "10YCS-CG-TSO---S", lat: 42.7, lng: 19.4 },
  BA: { name: "Bosnia & Herzegovina", eic: "10YBA-JPCC-----D", lat: 43.9, lng: 17.7 },
  HR: { name: "Croatia", eic: "10YHR-HEP------M", lat: 45.5, lng: 16.0 },
  SI: { name: "Slovenia", eic: "10YSI-ELES-----O", lat: 46.1, lng: 14.8 },
  GR: { name: "Greece", eic: "10YGR-HTSO-----Y", lat: 39.0, lng: 22.5 },
  IT: { name: "Italy (North)", eic: "10Y1001A1001A73I", lat: 45.5, lng: 9.2 },
};

// Serbia's transmission neighbours (for power flows)
export const RS_NEIGHBOURS: ZoneCode[] = ["HU", "RO", "BG", "MK", "ME", "BA", "HR"];

function fmtUtc(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

function parsePoints(xml: string): { ts: Date; value: number }[] {
  const out: { ts: Date; value: number }[] = [];
  const periodRegex = /<Period>([\s\S]*?)<\/Period>/g;
  let m: RegExpExecArray | null;
  while ((m = periodRegex.exec(xml))) {
    const block = m[1];
    const startMatch = /<start>([^<]+)<\/start>/.exec(block);
    const resMatch = /<resolution>([^<]+)<\/resolution>/.exec(block);
    if (!startMatch || !resMatch) continue;
    const start = new Date(startMatch[1]);
    const minMatch = /PT(\d+)M/.exec(resMatch[1]);
    const stepMs = minMatch ? Number(minMatch[1]) * 60_000 : 3_600_000;
    const pointRegex =
      /<Point>\s*<position>(\d+)<\/position>\s*<(?:price\.amount|quantity)>([\d.\-eE+]+)<\/(?:price\.amount|quantity)>\s*<\/Point>/g;
    let p: RegExpExecArray | null;
    while ((p = pointRegex.exec(block))) {
      out.push({
        ts: new Date(start.getTime() + (Number(p[1]) - 1) * stepMs),
        value: Number(p[2]),
      });
    }
  }
  return out;
}

async function callEntsoe(params: Record<string, string>) {
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (!token) return { ok: false as const, xml: "" };
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return { ok: false as const, xml: "" };
    return { ok: true as const, xml: await res.text() };
  } catch {
    return { ok: false as const, xml: "" };
  }
}

async function fetchDayAheadPrice(eic: string, from: Date, to: Date) {
  const r = await callEntsoe({
    documentType: "A44",
    in_Domain: eic,
    out_Domain: eic,
    periodStart: fmtUtc(from),
    periodEnd: fmtUtc(to),
  });
  if (!r.ok) return [];
  return parsePoints(r.xml);
}

async function fetchPhysicalFlow(fromEic: string, toEic: string, from: Date, to: Date) {
  const r = await callEntsoe({
    documentType: "A11",
    in_Domain: toEic,
    out_Domain: fromEic,
    periodStart: fmtUtc(from),
    periodEnd: fmtUtc(to),
  });
  if (!r.ok) return [];
  return parsePoints(r.xml);
}

type CacheEntry = { ts: number; data: RegionalSnapshot };
const CACHE: { current?: CacheEntry } = {};
const TTL_MS = 60 * 60 * 1000;

export type ZonePrice = {
  zone: ZoneCode;
  name: string;
  avg24h: number | null;
  latest: number | null;
  latestTs: string | null;
  points: { ts: string; price: number }[];
};

export type FlowSummary = {
  from: ZoneCode;
  to: ZoneCode;
  netMw: number; // positive = from -> to, negative = to -> from
  absMw: number;
};

export type RegionalSnapshot = {
  ok: boolean;
  generatedAt: string;
  windowFrom: string;
  windowTo: string;
  prices: ZonePrice[];
  flows: FlowSummary[];
  reason?: string;
};

export const fetchRegionalSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<RegionalSnapshot> => {
    const now = Date.now();
    if (CACHE.current && now - CACHE.current.ts < TTL_MS) return CACHE.current.data;

    const to = new Date();
    to.setUTCMinutes(0, 0, 0);
    // Day-ahead is published ~12:00 CET for next day; pull 48h window so we always have data.
    const from = new Date(to.getTime() - 48 * 3600_000);

    if (!process.env.ENTSOE_SECURITY_TOKEN) {
      const empty: RegionalSnapshot = {
        ok: false,
        generatedAt: new Date().toISOString(),
        windowFrom: from.toISOString(),
        windowTo: to.toISOString(),
        prices: [],
        flows: [],
        reason: "missing_token",
      };
      return empty;
    }

    // Prices — all zones in parallel
    const zoneList = Object.keys(ZONES) as ZoneCode[];
    const priceResults = await Promise.all(
      zoneList.map(async (z) => {
        const pts = await fetchDayAheadPrice(ZONES[z].eic, from, to);
        const sorted = pts.sort((a, b) => a.ts.getTime() - b.ts.getTime());
        const last24 = sorted.filter((p) => p.ts.getTime() >= to.getTime() - 24 * 3600_000);
        const avg = last24.length
          ? last24.reduce((s, p) => s + p.value, 0) / last24.length
          : null;
        const latest = sorted.length ? sorted[sorted.length - 1] : null;
        const out: ZonePrice = {
          zone: z,
          name: ZONES[z].name,
          avg24h: avg,
          latest: latest ? latest.value : null,
          latestTs: latest ? latest.ts.toISOString() : null,
          points: sorted.map((p) => ({ ts: p.ts.toISOString(), price: p.value })),
        };
        return out;
      }),
    );

    // Flows — Serbia to each neighbour, both directions
    const flowResults: FlowSummary[] = [];
    const flowFrom = new Date(to.getTime() - 24 * 3600_000);
    await Promise.all(
      RS_NEIGHBOURS.map(async (n) => {
        const [exp, imp] = await Promise.all([
          fetchPhysicalFlow(ZONES.RS.eic, ZONES[n].eic, flowFrom, to),
          fetchPhysicalFlow(ZONES[n].eic, ZONES.RS.eic, flowFrom, to),
        ]);
        const avg = (arr: { value: number }[]) =>
          arr.length ? arr.reduce((s, p) => s + p.value, 0) / arr.length : 0;
        const net = avg(exp) - avg(imp); // positive: RS exports to n
        flowResults.push({
          from: "RS",
          to: n,
          netMw: Math.round(net),
          absMw: Math.round(Math.abs(net)),
        });
      }),
    );

    const snapshot: RegionalSnapshot = {
      ok: true,
      generatedAt: new Date().toISOString(),
      windowFrom: from.toISOString(),
      windowTo: to.toISOString(),
      prices: priceResults.sort((a, b) => (b.avg24h ?? -1) - (a.avg24h ?? -1)),
      flows: flowResults.sort((a, b) => b.absMw - a.absMw),
    };

    CACHE.current = { ts: now, data: snapshot };
    return snapshot;
  },
);
