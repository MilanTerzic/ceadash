import { createServerFn } from "@tanstack/react-start";

/**
 * SEEPEX Serbia day-ahead price fetcher (ENTSO-E Transparency Platform).
 *
 * Improvements over the previous version:
 *  - Fetch window is aligned to Belgrade midnight and extended to D+2 23:00 UTC
 *    so we capture tomorrow's prices once SDAC publishes (~13:00 CET).
 *  - Cache query orders DESC + LIMIT so we always have the most recent rows
 *    (the 10k cap could previously drop today's data if history grew large).
 *  - Staleness check: refresh when latest cached hour < expected latest
 *    available hour (tomorrow 23:00 Belgrade once published, otherwise today's
 *    last published hour).
 *  - Robust XML parsing: ENTSO-E uses A03 (SequentialFixedSizeBlock) curves
 *    where missing positions inherit the last known value. We expand the curve
 *    over the full Period span using the declared resolution and forward-fill.
 *  - Range upsert covers the actual fetched span (not a fixed 30-day delete).
 */

const SERBIA_ZONE = "10YCS-SERBIATSOV";
const MARKET = "DA_RS";

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

/** ISO UTC at 22:00 of the given calendar day (Belgrade midnight in CET, 23:00 in CEST).
 * We use 22:00 as a safe lower bound that always covers the Belgrade day boundary;
 * ENTSO-E returns Period blocks aligned to local market time, our parser uses the
 * declared <start> so this is just for the request envelope. */
function utcDayStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 0, 0));
  // back up one day so we span the full Belgrade day even in CET (UTC+1)
  x.setUTCDate(x.getUTCDate() - 1);
  return x;
}

type ParsedPoint = { ts: Date; value: number };

function parsePoints(xml: string): ParsedPoint[] {
  const out: ParsedPoint[] = [];
  const periodRegex = /<Period>([\s\S]*?)<\/Period>/g;
  let m: RegExpExecArray | null;
  while ((m = periodRegex.exec(xml))) {
    const block = m[1];
    const startMatch = /<start>([^<]+)<\/start>/.exec(block);
    const endMatch = /<end>([^<]+)<\/end>/.exec(block);
    const resMatch = /<resolution>([^<]+)<\/resolution>/.exec(block);
    if (!startMatch || !resMatch) continue;
    const start = new Date(startMatch[1]);
    const end = endMatch ? new Date(endMatch[1]) : null;
    const minMatch = /PT(\d+)M/.exec(resMatch[1]);
    const stepMs = minMatch ? Number(minMatch[1]) * 60_000 : 3_600_000;
    const expected = end ? Math.max(0, Math.round((+end - +start) / stepMs)) : 0;

    // Collect raw positions first.
    const raw: { position: number; value: number }[] = [];
    const pointRegex =
      /<Point>\s*<position>(\d+)<\/position>\s*<(?:price\.amount|quantity)>([\d.\-eE+]+)<\/(?:price\.amount|quantity)>\s*<\/Point>/g;
    let p: RegExpExecArray | null;
    while ((p = pointRegex.exec(block))) {
      raw.push({ position: Number(p[1]), value: Number(p[2]) });
    }
    if (!raw.length) continue;
    raw.sort((a, b) => a.position - b.position);

    // Forward-fill A03-curve gaps: position k that's missing inherits position k-1's value.
    const total = expected || raw[raw.length - 1].position;
    let cursor = 0;
    let lastValue = raw[0].value;
    for (let k = 1; k <= total; k++) {
      while (cursor < raw.length && raw[cursor].position < k) cursor++;
      if (cursor < raw.length && raw[cursor].position === k) {
        lastValue = raw[cursor].value;
      }
      out.push({
        ts: new Date(start.getTime() + (k - 1) * stepMs),
        value: lastValue,
      });
    }
  }
  return out;
}

async function callEntsoe(params: Record<string, string>) {
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (!token) return { ok: false as const, reason: "missing_token", xml: "" };
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // One transparent retry on transient 5xx / network errors.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (res.ok) return { ok: true as const, xml: await res.text() };
      if (res.status < 500 || attempt === 1) {
        return { ok: false as const, reason: `http_${res.status}`, xml: "" };
      }
    } catch (e) {
      if (attempt === 1) {
        return { ok: false as const, reason: `network_${(e as Error).message}`, xml: "" };
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false as const, reason: "exhausted", xml: "" };
}

/** Compute the latest DA hour we *expect* to be published right now.
 * SDAC publishes D+1 around 13:00 CET. Before that, latest is today's 23:00 Belgrade. */
function expectedLatestHourMs(now: Date): number {
  const utcHour = now.getUTCHours();
  const cetIsDst = (() => {
    // Rough DST check: Mar last Sun → Oct last Sun. ENTSO-E publication time
    // is 13:00 LOCAL CET/CEST = 12:00 UTC (CEST) or 12:00 UTC (CET).
    const m = now.getUTCMonth();
    return m >= 3 && m <= 9;
  })();
  const publishedUtcHour = cetIsDst ? 11 : 12; // 13:00 local
  const beyondPublication = utcHour >= publishedUtcHour;
  // Latest available hour: end of tomorrow (Belgrade) if published, else end of today.
  const base = new Date(now);
  base.setUTCDate(base.getUTCDate() + (beyondPublication ? 1 : 0));
  // 23:00 Belgrade ≈ 22:00 UTC (CEST) or 22:00 UTC (CET) — both give 22 UTC.
  base.setUTCHours(22, 0, 0, 0);
  return base.getTime();
}

export const fetchMarketPrices = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Pull most recent cached rows (desc + limit) and reverse for ascending order.
  const cached = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .order("datetime", { ascending: false })
    .limit(20000);

  const cachedPoints =
    (cached.data ?? [])
      .map((r) => ({
        ts: new Date(r.datetime as string).toISOString(),
        price: Number(r.price_eur_mwh),
      }))
      .reverse();

  const now = new Date();
  const expectedLatest = expectedLatestHourMs(now);
  const latestCachedMs = cachedPoints.length
    ? new Date(cachedPoints[cachedPoints.length - 1].ts).getTime()
    : 0;
  const stale = latestCachedMs < expectedLatest;

  if (!stale && cachedPoints.length > 0) {
    return { ok: true, source: "cache" as const, points: cachedPoints };
  }

  // Refresh window: last 14 days through end of tomorrow Belgrade.
  // Fetching tomorrow lets us pick up SDAC results as soon as they're published.
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 2);
  to.setUTCHours(0, 0, 0, 0); // safe upper bound that covers Belgrade D+1 23:00
  const from = utcDayStart(new Date(now.getTime() - 14 * 86400_000));

  const r = await callEntsoe({
    documentType: "A44",
    in_Domain: SERBIA_ZONE,
    out_Domain: SERBIA_ZONE,
    periodStart: fmtUtc(from),
    periodEnd: fmtUtc(to),
  });

  if (!r.ok) {
    return {
      ok: cachedPoints.length > 0,
      source: cachedPoints.length ? ("cache" as const) : ("none" as const),
      reason: r.reason,
      points: cachedPoints,
    };
  }

  const fresh = parsePoints(r.xml);
  if (fresh.length > 0) {
    const rows = fresh.map((p) => ({
      datetime: p.ts.toISOString(),
      market: MARKET,
      price_eur_mwh: p.value,
      source: "ENTSO-E",
    }));
    const minTs = fresh[0].ts.toISOString();
    const maxTs = fresh[fresh.length - 1].ts.toISOString();
    // Replace overlapping window then insert fresh rows.
    await supabaseAdmin
      .from("market_prices_hourly")
      .delete()
      .eq("market", MARKET)
      .gte("datetime", minTs)
      .lte("datetime", maxTs);
    await supabaseAdmin.from("market_prices_hourly").insert(rows);
  }

  // Merge cached + fresh (fresh wins on collision).
  const map = new Map<string, number>();
  for (const c of cachedPoints) map.set(c.ts, c.price);
  for (const f of fresh) map.set(f.ts.toISOString(), f.value);
  const points = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, price]) => ({ ts, price }));

  return {
    ok: true,
    source: fresh.length > 0 ? ("entsoe" as const) : ("cache" as const),
    points,
  };
});
