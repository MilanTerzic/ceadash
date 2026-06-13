import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Minimal ENTSO-E Transparency Platform client.
// Docs: https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html
// Returns demo-marker objects if token missing or response empty so the UI can degrade gracefully.

// Correct EIC for the Serbia bidding zone on ENTSO-E (the previous "10YCS-SERBIA-T"
// was not recognised by the Transparency API and returned empty payloads).
const SERBIA_BIDDING_ZONE = "10YCS-SERBIATSOV";

function fmtUtc(d: Date) {
  // YYYYMMDDHHMM
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

async function callEntsoe(params: Record<string, string>) {
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (!token) return { ok: false as const, reason: "missing_token", xml: "" };
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) return { ok: false as const, reason: `http_${res.status}`, xml: "" };
  const xml = await res.text();
  return { ok: true as const, xml };
}

// Lightweight XML parser sufficient for ENTSO-E TimeSeries Point arrays.
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
    const resStr = resMatch[1]; // e.g. PT60M
    const minMatch = /PT(\d+)M/.exec(resStr);
    const stepMs = minMatch ? Number(minMatch[1]) * 60_000 : 3_600_000;
    const pointRegex = /<Point>\s*<position>(\d+)<\/position>\s*<(?:price\.amount|quantity)>([\d.\-eE+]+)<\/(?:price\.amount|quantity)>\s*<\/Point>/g;
    let p: RegExpExecArray | null;
    while ((p = pointRegex.exec(block))) {
      const position = Number(p[1]);
      const value = Number(p[2]);
      out.push({ ts: new Date(start.getTime() + (position - 1) * stepMs), value });
    }
  }
  return out;
}

export const fetchDayAheadPrices = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        from: z.string(),
        to: z.string(),
        zone: z.string().default(SERBIA_BIDDING_ZONE),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const r = await callEntsoe({
      documentType: "A44",
      in_Domain: data.zone,
      out_Domain: data.zone,
      periodStart: fmtUtc(new Date(data.from)),
      periodEnd: fmtUtc(new Date(data.to)),
    });
    if (!r.ok) return { ok: false, reason: r.reason, points: [] as { ts: string; price: number }[] };
    const pts = parsePoints(r.xml).map((p) => ({ ts: p.ts.toISOString(), price: p.value }));
    return { ok: true, points: pts };
  });

export const fetchActualGeneration = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        from: z.string(),
        to: z.string(),
        psrType: z.string().default("B16"), // B16 = Solar, B19 = Wind onshore
        zone: z.string().default(SERBIA_BIDDING_ZONE),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const r = await callEntsoe({
      documentType: "A75",
      processType: "A16",
      in_Domain: data.zone,
      psrType: data.psrType,
      periodStart: fmtUtc(new Date(data.from)),
      periodEnd: fmtUtc(new Date(data.to)),
    });
    if (!r.ok) return { ok: false, reason: r.reason, points: [] as { ts: string; mwh: number }[] };
    return {
      ok: true,
      points: parsePoints(r.xml).map((p) => ({ ts: p.ts.toISOString(), mwh: p.value })),
    };
  });
