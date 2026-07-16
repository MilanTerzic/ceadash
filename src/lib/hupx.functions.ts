import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { entsoeTokenMissingMessage, getEntsoeToken } from "@/lib/entsoe-token";

// HUPX = Hungarian day-ahead prices, sourced from ENTSO-E Transparency
// Platform for the MAVIR bidding zone (10YHU-MAVIR----U).
const HU_EIC = "10YHU-MAVIR----U";

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
      /<Point>\s*<position>(\d+)<\/position>\s*<price\.amount>([\d.\-eE+]+)<\/price\.amount>\s*<\/Point>/g;
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

function parseDayKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

async function fetchWindow(from: Date, to: Date) {
  const token = getEntsoeToken();
  if (!token) return [] as { ts: Date; value: number }[];
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  url.searchParams.set("documentType", "A44");
  url.searchParams.set("in_Domain", HU_EIC);
  url.searchParams.set("out_Domain", HU_EIC);
  url.searchParams.set("periodStart", fmtUtc(from));
  url.searchParams.set("periodEnd", fmtUtc(to));
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    return parsePoints(await res.text());
  } catch {
    return [];
  }
}

export type HupxResponse = {
  ok: boolean;
  points: { ts: string; price: number }[];
  source: "entsoe" | "none";
  reason?: string;
};

const HOT = new Map<string, { ts: number; data: HupxResponse }>();
const HOT_TTL_MS = 30 * 60 * 1000;

export const fetchHupxPrices = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ from: z.string().optional(), to: z.string().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<HupxResponse> => {
    const nowUtc = new Date();
    nowUtc.setUTCMinutes(0, 0, 0);
    const defaultFrom = new Date(nowUtc.getTime() - 30 * 24 * 3600_000);
    const fromDate =
      data.from && /^\d{4}-\d{2}-\d{2}$/.test(data.from) ? parseDayKey(data.from) : defaultFrom;
    const toDate =
      data.to && /^\d{4}-\d{2}-\d{2}$/.test(data.to)
        ? new Date(parseDayKey(data.to).getTime() + 24 * 3600_000)
        : nowUtc;

    const key = `${fromDate.toISOString()}|${toDate.toISOString()}`;
    const cached = HOT.get(key);
    if (cached && Date.now() - cached.ts < HOT_TTL_MS) return cached.data;

    if (!getEntsoeToken()) {
      return {
        ok: false,
        points: [],
        source: "none",
        reason: entsoeTokenMissingMessage(),
      };
    }

    const chunks = yearChunks(fromDate, toDate);
    const all: { ts: Date; value: number }[] = [];
    for (const c of chunks) {
      const pts = await fetchWindow(c.from, c.to);
      all.push(...pts);
    }

    // Deduplicate on ts (chunk boundaries can overlap).
    const map = new Map<string, number>();
    for (const p of all) {
      const d = new Date(p.ts);
      d.setUTCMinutes(0, 0, 0);
      map.set(d.toISOString(), p.value);
    }
    const points = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ts, price]) => ({ ts, price }));

    const out: HupxResponse = {
      ok: points.length > 0,
      points,
      source: points.length > 0 ? "entsoe" : "none",
      reason: points.length === 0 ? "No HUPX prices returned by ENTSO-E" : undefined,
    };
    HOT.set(key, { ts: Date.now(), data: out });
    return out;
  });
