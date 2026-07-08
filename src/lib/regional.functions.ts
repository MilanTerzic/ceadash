import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";


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

export const RS_NEIGHBOURS: ZoneCode[] = ["HU", "RO", "BG", "MK", "ME", "BA", "HR"];

const MARKET_PREFIX = "DA_";

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

// Actual generation per production type (B16=Solar, B18=Wind Offshore, B19=Wind Onshore)
async function fetchGeneration(eic: string, psrType: string, from: Date, to: Date) {
  const r = await callEntsoe({
    documentType: "A75",
    processType: "A16",
    in_Domain: eic,
    psrType,
    periodStart: fmtUtc(from),
    periodEnd: fmtUtc(to),
  });
  if (!r.ok) return [];
  return parsePoints(r.xml);
}

function toHourly(pts: { ts: Date; value: number }[]): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const p of pts) {
    const d = new Date(p.ts);
    d.setUTCMinutes(0, 0, 0);
    const k = d.toISOString();
    const a = acc.get(k) ?? { sum: 0, n: 0 };
    a.sum += p.value;
    a.n += 1;
    acc.set(k, a);
  }
  const out = new Map<string, number>();
  for (const [k, v] of acc) out.set(k, v.sum / v.n);
  return out;
}

function captureFrom(prices: Map<string, number>, gen: Map<string, number>) {
  let num = 0,
    den = 0;
  for (const [k, g] of gen) {
    const p = prices.get(k);
    if (p == null || !isFinite(g) || g <= 0) continue;
    num += p * g;
    den += g;
  }
  return den > 0 ? num / den : null;
}

// In-memory hot cache (per warm worker) — 30 min
type CacheEntry = { ts: number; data: RegionalSnapshot };
const HOT: { current?: CacheEntry } = {};
const HOT_TTL_MS = 30 * 60 * 1000;

export type ZonePrice = {
  zone: ZoneCode;
  name: string;
  avg24h: number | null;
  baseload: number | null;
  windCapture: number | null;
  solarCapture: number | null;
  windCaptureRatio: number | null;
  solarCaptureRatio: number | null;
  latest: number | null;
  latestTs: string | null;
  priceHours: number;
  negHours: number;
  points: { ts: string; price: number }[];
};


export type FlowSummary = {
  from: ZoneCode;
  to: ZoneCode;
  netMw: number;
  absMw: number;
};

export type RegionalSnapshot = {
  ok: boolean;
  generatedAt: string;
  windowFrom: string;
  windowTo: string;
  prices: ZonePrice[];
  flows: FlowSummary[];
  source: "live" | "cache" | "none";
  reason?: string;
};

type SupabaseAdmin =
  typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];


// Build snapshot from DB rows only (used as fallback / pre-warm)
async function snapshotFromCache(
  supabaseAdmin: SupabaseAdmin,
  windowFrom: Date,
  windowTo: Date,
): Promise<RegionalSnapshot> {
  const zoneList = Object.keys(ZONES) as ZoneCode[];
  const markets = zoneList.map((z) => `${MARKET_PREFIX}${z}`);

  const priceRows = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, market, price_eur_mwh")
    .in("market", markets)
    .gte("datetime", windowFrom.toISOString())
    .lt("datetime", windowTo.toISOString())
    .order("datetime", { ascending: true });

  const byZone = new Map<ZoneCode, { ts: Date; value: number }[]>();
  for (const z of zoneList) byZone.set(z, []);
  for (const r of priceRows.data ?? []) {
    const z = (r.market as string).slice(MARKET_PREFIX.length) as ZoneCode;
    if (!byZone.has(z)) continue;
    byZone.get(z)!.push({ ts: new Date(r.datetime as string), value: Number(r.price_eur_mwh) });
  }

  const cutoff = windowTo.getTime() - 24 * 3600_000;
  const prices: ZonePrice[] = zoneList.map((z) => {
    const pts = byZone.get(z)!;
    const last24 = pts.filter((p) => p.ts.getTime() >= cutoff);
    const avg24 = last24.length ? last24.reduce((s, p) => s + p.value, 0) / last24.length : null;
    // Baseload = simple arithmetic mean of ALL hourly prices in the window.
    const baseload = pts.length ? pts.reduce((s, p) => s + p.value, 0) / pts.length : null;
    const negHours = pts.reduce((n, p) => (p.value < 0 ? n + 1 : n), 0);
    const latest = pts.length ? pts[pts.length - 1] : null;
    return {
      zone: z,
      name: ZONES[z].name,
      avg24h: avg24,
      baseload,
      windCapture: null,
      solarCapture: null,
      windCaptureRatio: null,
      solarCaptureRatio: null,
      latest: latest ? latest.value : null,
      latestTs: latest ? latest.ts.toISOString() : null,
      priceHours: pts.length,
      negHours,
      points: pts.map((p) => ({ ts: p.ts.toISOString(), price: p.value })),
    };
  });


  // Flows: pull last 24h, average per neighbour (signed RS -> n)
  const flowFrom = new Date(windowTo.getTime() - 24 * 3600_000);
  const flowRows = await supabaseAdmin
    .from("cross_border_flows_hourly")
    .select("datetime, from_zone, to_zone, flow_mw")
    .gte("datetime", flowFrom.toISOString())
    .lt("datetime", windowTo.toISOString());

  const flowAcc = new Map<string, { sum: number; n: number }>();
  for (const r of flowRows.data ?? []) {
    const key = `${r.from_zone}|${r.to_zone}`;
    const acc = flowAcc.get(key) ?? { sum: 0, n: 0 };
    acc.sum += Number(r.flow_mw);
    acc.n += 1;
    flowAcc.set(key, acc);
  }
  const flows: FlowSummary[] = RS_NEIGHBOURS.map((n) => {
    const exp = flowAcc.get(`RS|${n}`);
    const imp = flowAcc.get(`${n}|RS`);
    const expAvg = exp ? exp.sum / exp.n : 0;
    const impAvg = imp ? imp.sum / imp.n : 0;
    const net = expAvg - impAvg;
    return { from: "RS" as ZoneCode, to: n, netMw: Math.round(net), absMw: Math.round(Math.abs(net)) };
  }).filter((f) => f.absMw > 0);


  const hasAnyPrice = prices.some((p) => p.avg24h != null || p.latest != null);
  return {
    ok: hasAnyPrice,
    generatedAt: new Date().toISOString(),
    windowFrom: windowFrom.toISOString(),
    windowTo: windowTo.toISOString(),
    prices: prices.sort((a, b) => (b.baseload ?? b.avg24h ?? -1) - (a.baseload ?? a.avg24h ?? -1)),
    flows: flows.sort((a, b) => b.absMw - a.absMw),
    source: hasAnyPrice ? "cache" : "none",
  };
}

function parseDayKey(k: string): Date {
  // Interpret YYYY-MM-DD as a UTC midnight. Windowing is UTC-based and matches
  // how market_prices_hourly rows are stored.
  const [y, m, d] = k.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function yearChunks(from: Date, to: Date): { from: Date; to: Date }[] {
  const chunks: { from: Date; to: Date }[] = [];
  let cursor = new Date(from);
  while (cursor < to) {
    const next = new Date(cursor);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    const end = next < to ? next : to;
    chunks.push({ from: new Date(cursor), to: end });
    cursor = end;
  }
  return chunks;
}

// Per-warm-worker cache keyed by requested window.
type CacheKey = string;
const HOT_MAP = new Map<CacheKey, { ts: number; data: RegionalSnapshot }>();

export const fetchRegionalSnapshot = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<RegionalSnapshot> => {
    const now = Date.now();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Requested window (UTC). If unspecified, fall back to last 30 days.
    const nowUtc = new Date();
    nowUtc.setUTCMinutes(0, 0, 0);
    const defaultFrom = new Date(nowUtc.getTime() - 30 * 24 * 3600_000);
    const fromDate =
      data.from && /^\d{4}-\d{2}-\d{2}$/.test(data.from)
        ? parseDayKey(data.from)
        : defaultFrom;
    const rawTo =
      data.to && /^\d{4}-\d{2}-\d{2}$/.test(data.to)
        ? new Date(parseDayKey(data.to).getTime() + 24 * 3600_000)
        : nowUtc;
    const toDate = rawTo <= fromDate ? new Date(fromDate.getTime() + 24 * 3600_000) : rawTo;

    const cacheKey: CacheKey = `${fromDate.toISOString()}|${toDate.toISOString()}`;
    const cached = HOT_MAP.get(cacheKey);
    if (cached && now - cached.ts < HOT_TTL_MS) return cached.data;

    const hasToken = Boolean(process.env.ENTSOE_SECURITY_TOKEN);
    let liveAny = false;

    // Refresh recent DA prices from ENTSO-E for the "latest" column and SDAC
    // publication. Historical prices already sit in market_prices_hourly.
    if (hasToken) {
      const zoneList = Object.keys(ZONES) as ZoneCode[];
      const refreshFrom = new Date(nowUtc.getTime() - 48 * 3600_000);
      const priceResults = await Promise.all(
        zoneList.map(async (z) => ({
          z,
          pts: await fetchDayAheadPrice(ZONES[z].eic, refreshFrom, nowUtc),
        })),
      );
      const priceRows: {
        datetime: string;
        market: string;
        price_eur_mwh: number;
        source: string;
      }[] = [];
      for (const { z, pts } of priceResults) {
        if (pts.length) liveAny = true;
        for (const p of pts) {
          priceRows.push({
            datetime: p.ts.toISOString(),
            market: `${MARKET_PREFIX}${z}`,
            price_eur_mwh: p.value,
            source: "ENTSO-E",
          });
        }
      }
      if (priceRows.length) {
        await supabaseAdmin
          .from("market_prices_hourly")
          .upsert(priceRows, { onConflict: "datetime,market" });
      }

      // Cross-border flows: keep 24h window — flow map is a "now" indicator.
      const flowFrom = new Date(nowUtc.getTime() - 24 * 3600_000);
      const flowResults = await Promise.all(
        RS_NEIGHBOURS.flatMap((n) => [
          fetchPhysicalFlow(ZONES.RS.eic, ZONES[n].eic, flowFrom, nowUtc).then((pts) => ({
            from: "RS" as ZoneCode,
            to: n,
            pts,
          })),
          fetchPhysicalFlow(ZONES[n].eic, ZONES.RS.eic, flowFrom, nowUtc).then((pts) => ({
            from: n,
            to: "RS" as ZoneCode,
            pts,
          })),
        ]),
      );
      const flowRows: {
        datetime: string;
        from_zone: string;
        to_zone: string;
        flow_mw: number;
        source: string;
      }[] = [];
      for (const { from: fz, to: tz, pts } of flowResults) {
        if (pts.length) liveAny = true;
        for (const p of pts) {
          flowRows.push({
            datetime: p.ts.toISOString(),
            from_zone: fz,
            to_zone: tz,
            flow_mw: p.value,
            source: "ENTSO-E",
          });
        }
      }
      if (flowRows.length) {
        await supabaseAdmin
          .from("cross_border_flows_hourly")
          .upsert(flowRows, { onConflict: "datetime,from_zone,to_zone" });
      }
    }

    // Pull the cached window (which includes anything we just refreshed) and
    // compute period baseload / negatives / latest per zone.
    const snap = await snapshotFromCache(supabaseAdmin, fromDate, toDate);

    // Capture prices per zone — fetch generation across the FULL requested
    // window (chunked ≤ 1 year per ENTSO-E limit) and weight against the
    // cached hourly prices in the same window.
    const captureByZone = new Map<
      ZoneCode,
      { wind: number | null; solar: number | null; windRatio: number | null; solarRatio: number | null }
    >();
    if (hasToken) {
      // Build price hourly maps per zone from the cached snapshot.
      const priceHByZone = new Map<ZoneCode, Map<string, number>>();
      for (const p of snap.prices) {
        const m = new Map<string, number>();
        for (const pt of p.points) {
          const d = new Date(pt.ts);
          d.setUTCMinutes(0, 0, 0);
          m.set(d.toISOString(), pt.price);
        }
        priceHByZone.set(p.zone, m);
      }

      const chunks = yearChunks(fromDate, toDate);
      const zoneList = Object.keys(ZONES) as ZoneCode[];
      const capResults = await Promise.all(
        zoneList.map(async (z) => {
          const solarAll: { ts: Date; value: number }[] = [];
          const windAll: { ts: Date; value: number }[] = [];
          for (const c of chunks) {
            const [solarP, windOn, windOff] = await Promise.all([
              fetchGeneration(ZONES[z].eic, "B16", c.from, c.to),
              fetchGeneration(ZONES[z].eic, "B19", c.from, c.to),
              fetchGeneration(ZONES[z].eic, "B18", c.from, c.to),
            ]);
            solarAll.push(...solarP);
            windAll.push(...windOn, ...windOff);
          }
          const priceH = priceHByZone.get(z) ?? new Map<string, number>();
          const solarH = toHourly(solarAll);
          const windH = toHourly(windAll);
          const baseload = priceH.size
            ? Array.from(priceH.values()).reduce((a, b) => a + b, 0) / priceH.size
            : null;
          const wc = captureFrom(priceH, windH);
          const sc = captureFrom(priceH, solarH);
          return {
            z,
            wind: wc,
            solar: sc,
            windRatio: wc != null && baseload ? wc / baseload : null,
            solarRatio: sc != null && baseload ? sc / baseload : null,
          };
        }),
      );
      for (const r of capResults) {
        captureByZone.set(r.z, {
          wind: r.wind,
          solar: r.solar,
          windRatio: r.windRatio,
          solarRatio: r.solarRatio,
        });
      }
    }

    if (liveAny) snap.source = "live";
    if (!hasToken && !snap.ok) snap.reason = "missing_token";

    for (const p of snap.prices) {
      const c = captureByZone.get(p.zone);
      if (c) {
        p.windCapture = c.wind;
        p.solarCapture = c.solar;
        p.windCaptureRatio = c.windRatio;
        p.solarCaptureRatio = c.solarRatio;
      }
    }

    HOT_MAP.set(cacheKey, { ts: now, data: snap });
    return snap;
  });

