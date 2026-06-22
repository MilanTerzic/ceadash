import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchMarketPrices } from "@/lib/market.functions";

const SERBIA_ZONE = "10YCS-SERBIATSOV";

export type CapturePoint = {
  ts: string;
  price: number;
  solar: number;
  wind: number;
};

function ymdh(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

function todayBelgradeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysISO(dayISO: string, n: number): string {
  const d = new Date(dayISO + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function cetOffsetHours(dayISO: string): number {
  const noonUtc = new Date(dayISO + "T12:00:00Z");
  const part = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    timeZoneName: "shortOffset",
  })
    .formatToParts(noonUtc)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /([+-]?\d+)/.exec(part);
  return m ? parseInt(m[1], 10) : 1;
}

function stripNs(xml: string): string {
  return xml.replace(/<\/?[\w:-]+:/g, (m) => m.replace(/[\w-]+:/, ""));
}

function tagAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function tagOne(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function parseTimeSeriesHourly(xml: string): Array<{ ts: string; value: number }> {
  const clean = stripNs(xml);
  const out: Array<{ ts: string; value: number }> = [];
  for (const ts of tagAll(clean, "TimeSeries")) {
    for (const period of tagAll(ts, "Period")) {
      const start = tagOne(period, "start");
      if (!start) continue;
      const startMs = Date.parse(start);
      const endStr = tagOne(period, "end");
      const resolution = tagOne(period, "resolution") ?? "PT60M";
      const stepMin = /PT(\d+)M/.exec(resolution)
        ? parseInt(/PT(\d+)M/.exec(resolution)![1], 10)
        : 60;
      const stepMs = stepMin * 60_000;

      const raw: { position: number; value: number }[] = [];
      for (const pt of tagAll(period, "Point")) {
        const pos = parseInt(tagOne(pt, "position") ?? "1", 10);
        const valS =
          tagOne(pt, "price.amount") ??
          tagOne(pt, "quantity") ??
          tagOne(pt, "value");
        if (valS == null) continue;
        const value = parseFloat(valS);
        if (!Number.isFinite(value)) continue;
        raw.push({ position: pos, value });
      }
      if (!raw.length) continue;
      raw.sort((a, b) => a.position - b.position);

      const expected = endStr
        ? Math.max(0, Math.round((Date.parse(endStr) - startMs) / stepMs))
        : raw[raw.length - 1].position;
      let cursor = 0;
      let lastValue = raw[0].value;
      for (let k = 1; k <= expected; k++) {
        while (cursor < raw.length && raw[cursor].position < k) cursor++;
        if (cursor < raw.length && raw[cursor].position === k) {
          lastValue = raw[cursor].value;
        }
        out.push({
          ts: new Date(startMs + (k - 1) * stepMs).toISOString(),
          value: lastValue,
        });
      }
    }
  }

  const byTs = new Map<string, number>();
  for (const r of out) byTs.set(r.ts, r.value);
  return [...byTs.entries()]
    .map(([ts, value]) => ({ ts, value }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

async function entsoeRaw(params: Record<string, string>): Promise<
  { ok: true; xml: string } | { ok: false; reason: string }
> {
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (!token) return { ok: false, reason: "missing_token" };
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url.toString(), { headers: { Accept: "application/xml" } });
      if (res.status === 200) return { ok: true, xml: await res.text() };
      if (res.status === 400) return { ok: false, reason: "no_data" };
      if (res.status === 401) return { ok: false, reason: "unauthorized" };
      if (res.status === 429) return { ok: false, reason: "rate_limited" };
      if (res.status < 500 || attempt === 1) return { ok: false, reason: `http_${res.status}` };
    } catch (e) {
      if (attempt === 1) return { ok: false, reason: `network_${(e as Error).message}` };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false, reason: "exhausted" };
}

async function fetchGenerationRange(
  psrType: string,
  fromISO: string,
  toISO: string,
): Promise<{ ok: boolean; reason?: string; points: Array<{ ts: string; value: number }> }> {
  const offsetFrom = cetOffsetHours(fromISO);
  const offsetTo = cetOffsetHours(toISO);
  const start = new Date(Date.parse(fromISO + "T00:00:00Z") - offsetFrom * 3600_000);
  const end = new Date(Date.parse(toISO + "T00:00:00Z") + (24 - offsetTo) * 3600_000);
  const r = await entsoeRaw({
    documentType: "A75",
    processType: "A16",
    in_Domain: SERBIA_ZONE,
    psrType,
    periodStart: ymdh(start),
    periodEnd: ymdh(end),
  });
  if (!r.ok) return { ok: false, reason: r.reason, points: [] };
  const startMs = start.getTime();
  const endMs = end.getTime();
  const points = parseTimeSeriesHourly(r.xml).filter((p) => {
    const t = Date.parse(p.ts);
    return t >= startMs && t < endMs;
  });
  return { ok: true, points };
}

function belgradeDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function toHourly(points: Array<{ ts: string; value: number }>): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
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

export const fetchCaptureSeries = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    const today = todayBelgradeISO();
    const fromISO = data.from && /^\d{4}-\d{2}-\d{2}$/.test(data.from) ? data.from : addDaysISO(today, -30);
    const toISO = data.to && /^\d{4}-\d{2}-\d{2}$/.test(data.to) ? data.to : addDaysISO(today, 1);

    const market = await fetchMarketPrices({ data: { from: fromISO } });
    const marketPoints = (market.points ?? []).filter((p) => {
      const day = belgradeDayOf(p.ts);
      return day >= fromISO && day <= toISO;
    });
    if (!marketPoints.length) {
      return {
        ok: false,
        source: "none" as const,
        reason: "no_market_data",
        windowFrom: fromISO,
        windowTo: toISO,
        points: [] as CapturePoint[],
      };
    }

    const [solarR, windOnR, windOffR] = await Promise.all([
      fetchGenerationRange("B16", fromISO, toISO),
      fetchGenerationRange("B19", fromISO, toISO),
      fetchGenerationRange("B18", fromISO, toISO),
    ]);

    const solarH = toHourly(solarR.points);
    const windH = toHourly([...windOnR.points, ...windOffR.points]);

    const points: CapturePoint[] = marketPoints.map((p) => ({
      ts: p.ts,
      price: p.price,
      solar: solarH.get(p.ts) ?? 0,
      wind: windH.get(p.ts) ?? 0,
    }));

    const solarHours = points.filter((p) => p.solar > 0).length;
    const windHours = points.filter((p) => p.wind > 0).length;
    const matchedHours = points.filter((p) => p.solar > 0 || p.wind > 0).length;

    return {
      ok: matchedHours > 0,
      source: (market.source ?? "cache") as "entsoe" | "cache",
      reason:
        matchedHours > 0
          ? undefined
          : solarR.reason ?? windOnR.reason ?? windOffR.reason ?? "no_generation_data",
      windowFrom: fromISO,
      windowTo: toISO,
      points,
      solarHours,
      windHours,
      matchedHours,
      totalHours: points.length,
      generationSource: "ENTSO-E A75" as const,
    };
  });
