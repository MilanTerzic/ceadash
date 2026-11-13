// Pure ENTSO-E time-series XML parsing. No I/O, so it is unit-tested directly.

export function stripNs(xml: string) {
  return xml.replace(/<\/?[\w:-]+:/g, (m) => m.replace(/[\w-]+:/, ""));
}

export function tagAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

export function tagOne(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

export function parseResolutionMinutes(resolution: string | null): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(resolution ?? "");
  if (!m) return 60;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + min || 60;
}

export interface EntsoeIntervalPoint {
  ts: string;
  value: number;
  durationMinutes: number;
  productionType?: string;
  mRID?: string;
  /**
   * True when the provider did not send this position because the series uses
   * curve type A03 (variable-sized blocks), where a value holds until the next
   * position. The value is the provider's, repeated per the curve definition.
   */
  repeated?: boolean;
}

/**
 * Parses every TimeSeries/Period/Point into fixed-resolution interval points.
 *
 * Curve type A01 lists every position. Curve type A03 lists a position only when the
 * value changes, so the gaps between listed positions are expanded with the preceding
 * value up to the period end. For any other curve type a missing position stays missing.
 */
export function parseTimeSeriesIntervals(xml: string): EntsoeIntervalPoint[] {
  const clean = stripNs(xml);
  const out: EntsoeIntervalPoint[] = [];
  for (const ts of tagAll(clean, "TimeSeries")) {
    const productionType = tagOne(ts, "psrType") ?? undefined;
    const mRID = tagOne(ts, "mRID") ?? undefined;
    const variableBlocks = tagOne(ts, "curveType") === "A03";
    for (const period of tagAll(ts, "Period")) {
      const start = tagOne(period, "start");
      if (!start) continue;
      const startMs = Date.parse(start);
      if (!Number.isFinite(startMs)) continue;
      const durationMinutes = parseResolutionMinutes(tagOne(period, "resolution"));
      const stepMs = durationMinutes * 60_000;
      const endMs = Date.parse(tagOne(period, "end") ?? "");
      const positions = Number.isFinite(endMs) ? Math.round((endMs - startMs) / stepMs) : null;

      const listed: Array<{ pos: number; value: number }> = [];
      for (const pt of tagAll(period, "Point")) {
        const pos = parseInt(tagOne(pt, "position") ?? "", 10);
        const valS = tagOne(pt, "price.amount") ?? tagOne(pt, "quantity") ?? tagOne(pt, "value");
        if (!Number.isFinite(pos) || valS == null) continue;
        const value = parseFloat(valS);
        if (!Number.isFinite(value)) continue;
        listed.push({ pos, value });
      }
      listed.sort((a, b) => a.pos - b.pos);

      for (let i = 0; i < listed.length; i++) {
        const { pos, value } = listed[i];
        const point = (position: number, repeated: boolean): EntsoeIntervalPoint => ({
          ts: new Date(startMs + (position - 1) * stepMs).toISOString(),
          value,
          durationMinutes,
          productionType,
          mRID,
          ...(repeated ? { repeated: true } : {}),
        });
        out.push(point(pos, false));
        if (!variableBlocks) continue;
        const nextPos =
          i + 1 < listed.length ? listed[i + 1].pos : positions ? positions + 1 : pos + 1;
        for (let fill = pos + 1; fill < nextPos; fill++) out.push(point(fill, true));
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}
