export type FlowPoint = { ts: string; mw: number };

export function mergeDirectionalFlowPoints(importPoints: FlowPoint[], exportPoints: FlowPoint[]) {
  const impByTs = new Map<string, number>();
  const expByTs = new Map<string, number>();

  for (const point of importPoints) {
    if (!Number.isFinite(point.mw)) continue;
    impByTs.set(point.ts, (impByTs.get(point.ts) ?? 0) + point.mw);
  }
  for (const point of exportPoints) {
    if (!Number.isFinite(point.mw)) continue;
    expByTs.set(point.ts, (expByTs.get(point.ts) ?? 0) + point.mw);
  }

  const allTimestamps = Array.from(new Set([...impByTs.keys(), ...expByTs.keys()])).sort();
  const hourly = allTimestamps.flatMap((ts) => {
    const imp = impByTs.get(ts);
    const exp = expByTs.get(ts);
    // Missing is unknown. It must never be silently converted to a measured 0 MW.
    if (imp == null || exp == null) return [];
    return [{ ts, imp_mw: imp, exp_mw: exp, net_mw: imp - exp }];
  });

  return {
    hourly,
    observedImportIntervals: impByTs.size,
    observedExportIntervals: expByTs.size,
    matchedIntervals: hourly.length,
    unmatchedIntervals: allTimestamps.length - hourly.length,
  };
}
