import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchMarketPrices } from "@/lib/market.functions";
import { getEntsoeToken } from "@/lib/entsoe-token";

const SERBIA_ZONE = "10YCS-SERBIATSOV";

export type CapturePoint = {
  ts: string;
  price: number;
  solar: number;
  wind: number;
};

// Belgrade representative location for clear-sky PV proxy.
const SERBIA_LAT = 44.8;
const SERBIA_LON = 20.5;
const GENERATION_CHUNK_DAYS = 92;

/** Modelled clear-sky PV proxy for Serbia (Belgrade coordinates).
 *  Returns a non-negative shape (0..~1) per hour; used ONLY as a weighting
 *  profile for capture-price when ENTSO-E does not publish B16 solar for
 *  Serbia. Absolute scale cancels out of the Σ(price·gen)/Σ(gen) formula.
 *  This is a modelled proxy, not measured generation. */
function modelledSolarWeight(tsISO: string): number {
  const d = new Date(tsISO);
  if (Number.isNaN(d.getTime())) return 0;
  const startYear = Date.UTC(d.getUTCFullYear(), 0, 0);
  const N = Math.floor((d.getTime() - startYear) / 86_400_000);
  const decl = ((23.45 * Math.PI) / 180) * Math.sin((2 * Math.PI * (N - 81)) / 365);
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60;
  // Equation-of-time skipped; solar time ≈ UTC + lon/15.
  const solarTime = utcHours + SERBIA_LON / 15;
  const H = ((solarTime - 12) * 15 * Math.PI) / 180;
  const latR = (SERBIA_LAT * Math.PI) / 180;
  const cosZ = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(H);
  if (cosZ <= 0) return 0;
  // Simple atmospheric attenuation ~ air-mass exponent.
  return Math.pow(cosZ, 1.15);
}

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

function chunkDateRange(fromISO: string, toISO: string, maxDays = GENERATION_CHUNK_DAYS) {
  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = Date.parse(fromISO + "T00:00:00Z");
  const end = Date.parse(toISO + "T00:00:00Z");
  if (!Number.isFinite(cursor) || !Number.isFinite(end) || end < cursor) return chunks;
  while (cursor <= end) {
    const chunkEnd = Math.min(end, cursor + (maxDays - 1) * 86_400_000);
    chunks.push({
      from: new Date(cursor).toISOString().slice(0, 10),
      to: new Date(chunkEnd).toISOString().slice(0, 10),
    });
    cursor = chunkEnd + 86_400_000;
  }
  return chunks;
}

function cetOffsetHours(dayISO: string): number {
  const midnightUtc = new Date(dayISO + "T00:00:00Z");
  const part =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      timeZoneName: "shortOffset",
    })
      .formatToParts(midnightUtc)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /([+-]?\d+)/.exec(part);
  return m ? parseInt(m[1], 10) : 1;
}

function belgradeWindowStart(dayISO: string): Date {
  return new Date(Date.parse(dayISO + "T00:00:00Z") - cetOffsetHours(dayISO) * 3600_000);
}

function belgradeWindowEnd(dayISO: string): Date {
  const afterDay = addDaysISO(dayISO, 1);
  return new Date(Date.parse(afterDay + "T00:00:00Z") - cetOffsetHours(afterDay) * 3600_000);
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
        const valS = tagOne(pt, "price.amount") ?? tagOne(pt, "quantity") ?? tagOne(pt, "value");
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

export type EntsoeReason =
  | "missing_token"
  | "no_data"
  | "bad_request"
  | "invalid_psrtype_or_domain"
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | string;

export type GenerationDiagnostics = {
  ok: boolean;
  reason?: EntsoeReason;
  apiMessage?: string;
  httpStatus?: number;
  psrType: string;
  periodStart: string;
  periodEnd: string;
  parsedPoints: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
};

function classify400(body: string): { reason: EntsoeReason; apiMessage?: string } {
  const clean = stripNs(body);
  const msg = tagOne(clean, "text") ?? tagOne(clean, "Reason") ?? tagOne(clean, "message") ?? "";
  const sanitized = msg.replace(/\s+/g, " ").trim().slice(0, 240);
  const low = sanitized.toLowerCase();
  if (!low) return { reason: "bad_request" };
  if (low.includes("no matching data") || low.includes("no data"))
    return { reason: "no_data", apiMessage: sanitized };
  if (low.includes("psrtype") || low.includes("domain") || low.includes("in_domain"))
    return { reason: "invalid_psrtype_or_domain", apiMessage: sanitized };
  if (low.includes("token") || low.includes("unauthorized"))
    return { reason: "unauthorized", apiMessage: sanitized };
  return { reason: "bad_request", apiMessage: sanitized };
}

async function entsoeRaw(
  params: Record<string, string>,
): Promise<
  | { ok: true; xml: string; httpStatus: number }
  | { ok: false; reason: EntsoeReason; apiMessage?: string; httpStatus?: number }
> {
  const token = getEntsoeToken();
  if (!token) return { ok: false, reason: "missing_token" };
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url.toString(), { headers: { Accept: "application/xml" } });
      if (res.status === 200) return { ok: true, xml: await res.text(), httpStatus: 200 };
      if (res.status === 400) {
        const body = await res.text().catch(() => "");
        const c = classify400(body);
        return { ok: false, reason: c.reason, apiMessage: c.apiMessage, httpStatus: 400 };
      }
      if (res.status === 401) return { ok: false, reason: "unauthorized", httpStatus: 401 };
      if (res.status === 429) return { ok: false, reason: "rate_limited", httpStatus: 429 };
      if (res.status < 500 || attempt === 1)
        return { ok: false, reason: `http_${res.status}`, httpStatus: res.status };
    } catch (e) {
      if (attempt === 1)
        return { ok: false, reason: "network_error", apiMessage: (e as Error).message };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false, reason: "server_error" };
}

async function fetchGenerationRange(
  psrType: string,
  fromISO: string,
  toISO: string,
): Promise<{
  ok: boolean;
  reason?: EntsoeReason;
  points: Array<{ ts: string; value: number }>;
  diagnostics: GenerationDiagnostics;
}> {
  const chunks = chunkDateRange(fromISO, toISO);
  if (chunks.length > 1) {
    const points: Array<{ ts: string; value: number }> = [];
    const failures: Array<{ reason?: EntsoeReason; apiMessage?: string; httpStatus?: number }> = [];
    for (const chunk of chunks) {
      const result = await fetchGenerationRange(psrType, chunk.from, chunk.to);
      if (result.points.length) {
        points.push(...result.points);
      } else if (!result.ok) {
        failures.push({
          reason: result.reason,
          apiMessage: result.diagnostics.apiMessage,
          httpStatus: result.diagnostics.httpStatus,
        });
      }
    }
    const byTs = new Map<string, number>();
    for (const point of points) {
      if (Number.isFinite(point.value) && !Number.isNaN(Date.parse(point.ts))) {
        byTs.set(new Date(point.ts).toISOString(), point.value);
      }
    }
    const merged = [...byTs.entries()]
      .map(([ts, value]) => ({ ts, value }))
      .sort((a, b) => a.ts.localeCompare(b.ts));
    const firstFailure = failures.find((failure) => failure.reason && failure.reason !== "no_data");
    const reason =
      merged.length > 0
        ? failures.length
          ? ("partial_generation_data" as EntsoeReason)
          : undefined
        : (firstFailure?.reason ?? failures[0]?.reason ?? "no_data");
    const apiMessage =
      firstFailure?.apiMessage ??
      (failures.length && !merged.length
        ? `${failures.length}/${chunks.length} generation chunks returned no data`
        : undefined);
    return {
      ok: merged.length > 0,
      reason,
      points: merged,
      diagnostics: {
        ok: merged.length > 0,
        reason,
        apiMessage,
        httpStatus: firstFailure?.httpStatus ?? failures[0]?.httpStatus,
        psrType,
        periodStart: ymdh(belgradeWindowStart(fromISO)),
        periodEnd: ymdh(belgradeWindowEnd(toISO)),
        parsedPoints: merged.length,
        firstTimestamp: merged[0]?.ts ?? null,
        lastTimestamp: merged[merged.length - 1]?.ts ?? null,
      },
    };
  }

  const start = belgradeWindowStart(fromISO);
  const end = belgradeWindowEnd(toISO);
  const periodStart = ymdh(start);
  const periodEnd = ymdh(end);
  const r = await entsoeRaw({
    documentType: "A75",
    processType: "A16",
    in_Domain: SERBIA_ZONE,
    psrType,
    periodStart,
    periodEnd,
  });
  if (!r.ok) {
    return {
      ok: false,
      reason: r.reason,
      points: [],
      diagnostics: {
        ok: false,
        reason: r.reason,
        apiMessage: r.apiMessage,
        httpStatus: r.httpStatus,
        psrType,
        periodStart,
        periodEnd,
        parsedPoints: 0,
        firstTimestamp: null,
        lastTimestamp: null,
      },
    };
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  const points = parseTimeSeriesHourly(r.xml).filter((p) => {
    const t = Date.parse(p.ts);
    return t >= startMs && t < endMs;
  });
  return {
    ok: true,
    points,
    diagnostics: {
      ok: true,
      httpStatus: r.httpStatus,
      psrType,
      periodStart,
      periodEnd,
      parsedPoints: points.length,
      firstTimestamp: points[0]?.ts ?? null,
      lastTimestamp: points[points.length - 1]?.ts ?? null,
    },
  };
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
    const fromISO =
      data.from && /^\d{4}-\d{2}-\d{2}$/.test(data.from) ? data.from : addDaysISO(today, -30);
    const toISO = data.to && /^\d{4}-\d{2}-\d{2}$/.test(data.to) ? data.to : addDaysISO(today, 1);

    const market = await fetchMarketPrices({ data: { from: fromISO, to: toISO } });
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
    const windOnH = toHourly(windOnR.points);
    const windOffH = toHourly(windOffR.points);
    const windH = toHourly([...windOnR.points, ...windOffR.points]);

    // If ENTSO-E does not publish Serbia B16 solar, fall back to a modelled
    // clear-sky PV shape so capture-price weighting is possible. This is
    // labelled as "modelled" in the response so the UI can flag it.
    const solarSource: "entsoe" | "modelled" | "none" = solarH.size > 0 ? "entsoe" : "modelled";

    const points: CapturePoint[] = marketPoints.map((p) => ({
      ts: p.ts,
      price: p.price,
      solar: solarSource === "entsoe" ? (solarH.get(p.ts) ?? 0) : modelledSolarWeight(p.ts),
      wind: windH.get(p.ts) ?? 0,
    }));

    const priceTsSet = new Set(marketPoints.map((p) => p.ts));
    const matchedSolarHours = [...solarH.keys()].filter((k) => priceTsSet.has(k)).length;
    const matchedWindOnHours = [...windOnH.keys()].filter((k) => priceTsSet.has(k)).length;
    const matchedWindOffHours = [...windOffH.keys()].filter((k) => priceTsSet.has(k)).length;

    const solarHours = points.filter((p) => p.solar > 0).length;
    const windHours = points.filter((p) => p.wind > 0).length;
    const matchedHours = points.filter((p) => p.solar > 0 || p.wind > 0).length;

    const firstPriceTs = marketPoints[0]?.ts ?? null;
    const lastPriceTs = marketPoints[marketPoints.length - 1]?.ts ?? null;

    return {
      ok: matchedHours > 0,
      source: (market.source ?? "cache") as "entsoe" | "cache",
      reason:
        matchedHours > 0
          ? undefined
          : (solarR.reason ?? windOnR.reason ?? windOffR.reason ?? "no_generation_data"),
      windowFrom: fromISO,
      windowTo: toISO,
      points,
      solarHours,
      windHours,
      matchedHours,
      totalHours: points.length,
      generationSource: "ENTSO-E A75" as const,
      solarSource,
      priceHours: marketPoints.length,
      firstPriceTs,
      lastPriceTs,
      diagnostics: {
        solar: { ...solarR.diagnostics, matchedHours: matchedSolarHours },
        windOnshore: { ...windOnR.diagnostics, matchedHours: matchedWindOnHours },
        windOffshore: { ...windOffR.diagnostics, matchedHours: matchedWindOffHours },
        priceHours: marketPoints.length,
        firstPriceTs,
        lastPriceTs,
        solarSource,
      },
    };
  });

export const __captureInternals = {
  chunkDateRange,
  belgradeWindowStart,
  belgradeWindowEnd,
  ymdh,
};
