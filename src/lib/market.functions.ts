import { createServerFn } from "@tanstack/react-start";

// Serbia bidding zone — use the same EIC the regional snapshot uses (returns data).
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
  if (!token) return { ok: false as const, reason: "missing_token", xml: "" };
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) return { ok: false as const, reason: `http_${res.status}`, xml: "" };
  return { ok: true as const, xml: await res.text() };
}

/**
 * Returns hourly SEEPEX day-ahead prices for Serbia in the given window.
 * Strategy:
 *   1. Read cached rows from `market_prices_hourly` for the window.
 *   2. If nothing cached, call ENTSO-E for the last 30 days, persist results,
 *      and return what we got.
 *   3. On any failure return an empty array so callers fall back to demo data.
 */
export const fetchMarketPrices = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Try cache first — full DB so we can overlay an entire year if available.
  const cached = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", "SEEPEX_DA")
    .order("datetime", { ascending: true })
    .limit(10000);

  const cachedPoints =
    cached.data?.map((r) => ({
      ts: new Date(r.datetime as string).toISOString(),
      price: Number(r.price_eur_mwh),
    })) ?? [];

  // Decide whether to refresh: nothing cached, OR latest cached point is >24h stale.
  const latestCachedMs = cachedPoints.length
    ? new Date(cachedPoints[cachedPoints.length - 1].ts).getTime()
    : 0;
  const stale = Date.now() - latestCachedMs > 24 * 3600_000;

  if (!stale && cachedPoints.length > 0) {
    return { ok: true, source: "cache" as const, points: cachedPoints };
  }

  // Fetch last 30 days from ENTSO-E
  const to = new Date();
  to.setUTCMinutes(0, 0, 0);
  const from = new Date(to.getTime() - 30 * 86400_000);

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
      market: "SEEPEX_DA",
      price_eur_mwh: p.value,
      source: "ENTSO-E",
    }));
    // Upsert by (datetime, market) — table has no unique constraint, so dedupe by deleting overlapping window first.
    await supabaseAdmin
      .from("market_prices_hourly")
      .delete()
      .eq("market", "SEEPEX_DA")
      .gte("datetime", from.toISOString())
      .lt("datetime", to.toISOString());
    await supabaseAdmin.from("market_prices_hourly").insert(rows);
  }

  // Merge cached + fresh (fresh wins) and return
  const map = new Map<string, number>();
  for (const c of cachedPoints) map.set(c.ts, c.price);
  for (const f of fresh) map.set(f.ts.toISOString(), f.value);
  const points = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, price]) => ({ ts, price }));

  return { ok: true, source: "entsoe" as const, points };
});
