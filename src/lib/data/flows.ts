import { createServerFn } from "@tanstack/react-start";
import { fetchPhysicalFlows, fetchExplicitAllocation } from "../entsoe.server";
import { IMPORT_ROUTES, EXPORT_ROUTES, BORDERS, TECHNICAL_NTC_MW, type ZoneCode } from "../markets";
import { expandRange, RangeInput } from "./shared";

export const getFlows = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const routes = [...IMPORT_ROUTES, ...EXPORT_ROUTES];
    const results = await Promise.all(
      routes.map(async (r) => {
        const parts = await Promise.all(days.map((d) => fetchPhysicalFlows(r.from, r.to, d)));
        return {
          data: { from: r.from, to: r.to, points: parts.flatMap((p) => p.data.points) },
          source: parts[0]?.source ?? "empty",
          reason: parts[0]?.reason,
          fetched_at: parts[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );
    return { day: days[0], rows: routes.map((r, i) => ({ ...r, ...results[i] })) };
  });

// Cross-border flow analytics for Serbia. Both directions per border + capacity.
const RS_BORDERS: ZoneCode[] = ["HU", "RO", "BG", "HR", "ME", "MK"];

export const getFlowAnalytics = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const borders = await Promise.all(
      RS_BORDERS.map(async (neighbour) => {
        // import = neighbour -> RS, export = RS -> neighbour
        const impParts = await Promise.all(days.map((d) => fetchPhysicalFlows(neighbour, "RS", d)));
        const expParts = await Promise.all(days.map((d) => fetchPhysicalFlows("RS", neighbour, d)));
        const capImp = await fetchExplicitAllocation(neighbour, "RS", "daily", days[0]);
        const capExp = await fetchExplicitAllocation("RS", neighbour, "daily", days[0]);

        const impByTs = new Map<string, number>();
        const expByTs = new Map<string, number>();
        for (const r of impParts)
          for (const p of r.data.points)
            impByTs.set(p.ts, (impByTs.get(p.ts) ?? 0) + (Number.isFinite(p.mw) ? p.mw : 0));
        for (const r of expParts)
          for (const p of r.data.points)
            expByTs.set(p.ts, (expByTs.get(p.ts) ?? 0) + (Number.isFinite(p.mw) ? p.mw : 0));

        const allTs = Array.from(new Set([...impByTs.keys(), ...expByTs.keys()])).sort();
        const hourly = allTs.map((ts) => {
          const imp = impByTs.get(ts) ?? 0;
          const exp = expByTs.get(ts) ?? 0;
          return { ts, imp_mw: imp, exp_mw: exp, net_mw: imp - exp };
        });

        return {
          neighbour,
          hourly,
          capacity_imp_mw: capImp.data.offered_mw,
          capacity_exp_mw: capExp.data.offered_mw,
          source_imp: impParts[0]?.source ?? "empty",
          source_exp: expParts[0]?.source ?? "empty",
          cap_source: capImp.source,
          fetched_at: impParts[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );
    return {
      from: days[0],
      to: days[days.length - 1],
      borders,
      fetched_at: new Date().toISOString(),
    };
  });

// Cross-border capacity utilization: |physical flow| / technical NTC per direction.
export const getUtilization = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    // All directed pairs from BORDERS (already includes both directions).
    const pairs: Array<[ZoneCode, ZoneCode]> = BORDERS;
    const rows = await Promise.all(
      pairs.map(async ([from, to]) => {
        const parts = await Promise.all(days.map((d) => fetchPhysicalFlows(from, to, d)));
        const points = parts
          .flatMap((p) => p.data.points)
          .map((p) => ({ ts: p.ts, mw: Number.isFinite(p.mw) ? Math.abs(p.mw) : 0 }));
        const n = points.length;
        const sum = points.reduce((a, p) => a + p.mw, 0);
        const avg = n ? sum / n : null;
        const peak = n ? Math.max(...points.map((p) => p.mw)) : null;
        const ntc = TECHNICAL_NTC_MW[`${from}_${to}`] ?? null;
        const util_avg = avg != null && ntc ? avg / ntc : null;
        const util_peak = peak != null && ntc ? peak / ntc : null;
        return {
          from,
          to,
          label: `${from} → ${to}`,
          ntc_mw: ntc,
          avg_flow_mw: avg,
          peak_flow_mw: peak,
          utilization_avg: util_avg,
          utilization_peak: util_peak,
          hours: n,
          source: parts[0]?.source ?? "empty",
          fetched_at: parts[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );
    return { from: days[0], to: days[days.length - 1], rows };
  });
