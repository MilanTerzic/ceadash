import { createServerFn } from "@tanstack/react-start";
import { fetchPhysicalFlows, fetchLoadGenRange } from "../entsoe.server";
import { BORDERS, ZONES, type ZoneCode } from "../markets";
import {
  addDaysISO,
  belgradeDayBoundaryUtc,
  expandRange,
  RangeInput,
  requestedRange,
  allSettledBounded,
} from "./shared";

const WB6_ZONES: ZoneCode[] = ["AL", "BA", "XK", "ME", "MK", "RS"];
type Wb6FlowRow = {
  datetime: string;
  from_zone: string;
  to_zone: string;
  flow_mw: number | string | null;
};

export const getWb6Balance = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const fromUtc = belgradeDayBoundaryUtc(days[0]);
    const toUtc = belgradeDayBoundaryUtc(addDaysISO(days[days.length - 1], 1));
    const expectedHours = Math.max(1, Math.round((toUtc.getTime() - fromUtc.getTime()) / 3600_000));
    const fetchedAt = new Date().toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const response = await supabaseAdmin
      .from("cross_border_flows_hourly")
      .select("datetime, from_zone, to_zone, flow_mw")
      .gte("datetime", fromUtc.toISOString())
      .lt("datetime", toUtc.toISOString())
      .order("datetime", { ascending: true })
      .limit(50_000);

    if (response.error) {
      return {
        from: days[0],
        to: days[days.length - 1],
        timezone: "Europe/Belgrade",
        fetched_at: fetchedAt,
        status: "unavailable" as const,
        reason: response.error.message,
        expectedHours,
        rows: 0,
        countries: [],
        hourly: [],
        counterparties: [],
        topImporter: null,
        topExporter: null,
        topNetImporter: null,
        topNetExporter: null,
        totals: {
          importsMwh: 0,
          exportsMwh: 0,
          netMwh: 0,
          internalExchangeMwh: 0,
          externalExchangeMwh: 0,
          intraWb6Share: null,
        },
      };
    }

    let usedLiveFallback = false;
    let rawRows = ((response.data ?? []) as Wb6FlowRow[]).filter((row) => {
      const from = row.from_zone as ZoneCode;
      const to = row.to_zone as ZoneCode;
      return WB6_ZONES.includes(from) || WB6_ZONES.includes(to);
    });
    if (!rawRows.length && days.length <= 7) {
      const pairs = BORDERS.filter(
        ([from, to]) => WB6_ZONES.includes(from) || WB6_ZONES.includes(to),
      );
      const tasks = pairs.flatMap(([from, to]) =>
        days.map(
          (day) => async () =>
            fetchPhysicalFlows(from, to, day).then((result) =>
              result.data.points.map((point) => ({
                datetime: point.ts,
                from_zone: from,
                to_zone: to,
                flow_mw: point.mw,
              })),
            ),
        ),
      );
      const fallback = await allSettledBounded(tasks, 4);
      rawRows = fallback.flatMap((result): Wb6FlowRow[] =>
        result.status === "fulfilled"
          ? result.value.map((row) => ({
              datetime: row.datetime,
              from_zone: row.from_zone,
              to_zone: row.to_zone,
              flow_mw: row.flow_mw,
            }))
          : [],
      );
      usedLiveFallback = rawRows.length > 0;
    }

    const countryAcc = new Map<
      ZoneCode,
      {
        importsMwh: number;
        exportsMwh: number;
        internalImportsMwh: number;
        internalExportsMwh: number;
        externalImportsMwh: number;
        externalExportsMwh: number;
        rowCount: number;
        timestamps: Set<string>;
      }
    >();
    const hourlyAcc = new Map<string, Record<ZoneCode, number>>();
    const counterpartyAcc = new Map<
      string,
      {
        country: ZoneCode;
        counterparty: string;
        importsMwh: number;
        exportsMwh: number;
        netMwh: number;
      }
    >();

    const ensureCountry = (code: ZoneCode) => {
      let acc = countryAcc.get(code);
      if (!acc) {
        acc = {
          importsMwh: 0,
          exportsMwh: 0,
          internalImportsMwh: 0,
          internalExportsMwh: 0,
          externalImportsMwh: 0,
          externalExportsMwh: 0,
          rowCount: 0,
          timestamps: new Set<string>(),
        };
        countryAcc.set(code, acc);
      }
      return acc;
    };
    for (const zone of WB6_ZONES) ensureCountry(zone);

    const hourlyRow = (ts: string) => {
      let row = hourlyAcc.get(ts);
      if (!row) {
        row = Object.fromEntries(WB6_ZONES.map((zone) => [zone, 0])) as Record<ZoneCode, number>;
        hourlyAcc.set(ts, row);
      }
      return row;
    };

    const addCounterparty = (
      country: ZoneCode,
      counterparty: string,
      field: "importsMwh" | "exportsMwh",
      value: number,
    ) => {
      const key = `${country}|${counterparty}`;
      const acc = counterpartyAcc.get(key) ?? {
        country,
        counterparty,
        importsMwh: 0,
        exportsMwh: 0,
        netMwh: 0,
      };
      acc[field] += value;
      acc.netMwh = acc.importsMwh - acc.exportsMwh;
      counterpartyAcc.set(key, acc);
    };

    for (const raw of rawRows) {
      const fromRaw = raw.from_zone as ZoneCode;
      const toRaw = raw.to_zone as ZoneCode;
      const parsed = Number(raw.flow_mw);
      if (!Number.isFinite(parsed) || fromRaw === toRaw) continue;

      const reverse = parsed < 0;
      const from = reverse ? toRaw : fromRaw;
      const to = reverse ? fromRaw : toRaw;
      const flow = Math.abs(parsed);
      const fromIsWb6 = WB6_ZONES.includes(from);
      const toIsWb6 = WB6_ZONES.includes(to);
      if (!fromIsWb6 && !toIsWb6) continue;

      const ts = raw.datetime;
      const row = hourlyRow(ts);
      if (fromIsWb6) {
        const acc = ensureCountry(from);
        acc.exportsMwh += flow;
        acc.rowCount += 1;
        acc.timestamps.add(ts);
        row[from] -= flow;
        if (toIsWb6) acc.internalExportsMwh += flow;
        else acc.externalExportsMwh += flow;
        addCounterparty(from, to, "exportsMwh", flow);
      }
      if (toIsWb6) {
        const acc = ensureCountry(to);
        acc.importsMwh += flow;
        acc.rowCount += 1;
        acc.timestamps.add(ts);
        row[to] += flow;
        if (fromIsWb6) acc.internalImportsMwh += flow;
        else acc.externalImportsMwh += flow;
        addCounterparty(to, from, "importsMwh", flow);
      }
    }

    const countries = WB6_ZONES.map((code) => {
      const acc = ensureCountry(code);
      const importsMwh = Math.round(acc.importsMwh);
      const exportsMwh = Math.round(acc.exportsMwh);
      const netMwh = importsMwh - exportsMwh;
      const hoursWithData = acc.timestamps.size;
      const coveragePct = expectedHours ? (hoursWithData / expectedHours) * 100 : 0;
      const totalExchange = importsMwh + exportsMwh;
      return {
        code,
        name: ZONES[code].name,
        importsMwh,
        exportsMwh,
        netMwh,
        internalImportsMwh: Math.round(acc.internalImportsMwh),
        internalExportsMwh: Math.round(acc.internalExportsMwh),
        externalImportsMwh: Math.round(acc.externalImportsMwh),
        externalExportsMwh: Math.round(acc.externalExportsMwh),
        totalExchangeMwh: totalExchange,
        coverageHours: hoursWithData,
        expectedHours,
        coveragePct,
        rowCount: acc.rowCount,
        status:
          hoursWithData === 0
            ? ("unavailable" as const)
            : coveragePct >= 80
              ? usedLiveFallback
                ? ("live" as const)
                : ("cache" as const)
              : ("partial" as const),
      };
    });

    const hourly = Array.from(hourlyAcc.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ts, values]) => ({
        ts,
        ...Object.fromEntries(WB6_ZONES.map((zone) => [zone, Math.round(values[zone] ?? 0)])),
      }));

    const topImporter = [...countries].sort((a, b) => b.importsMwh - a.importsMwh)[0] ?? null;
    const topExporter = [...countries].sort((a, b) => b.exportsMwh - a.exportsMwh)[0] ?? null;
    const topNetImporter = [...countries].sort((a, b) => b.netMwh - a.netMwh)[0] ?? null;
    const topNetExporter = [...countries].sort((a, b) => a.netMwh - b.netMwh)[0] ?? null;
    const internalExchangeMwh =
      countries.reduce((sum, country) => sum + country.internalImportsMwh, 0) +
      countries.reduce((sum, country) => sum + country.internalExportsMwh, 0);
    const externalExchangeMwh =
      countries.reduce((sum, country) => sum + country.externalImportsMwh, 0) +
      countries.reduce((sum, country) => sum + country.externalExportsMwh, 0);
    const totalExchange = internalExchangeMwh + externalExchangeMwh;
    const withRows = countries.filter((country) => country.coverageHours > 0).length;
    const status =
      rawRows.length === 0
        ? "unavailable"
        : withRows === WB6_ZONES.length
          ? usedLiveFallback
            ? "live"
            : "cache"
          : "partial";

    return {
      from: days[0],
      to: days[days.length - 1],
      timezone: "Europe/Belgrade",
      fetched_at: fetchedAt,
      status,
      reason:
        status === "unavailable"
          ? "No cached WB6 physical-flow rows are available for the selected period."
          : usedLiveFallback
            ? "No cached WB6 rows were found, so a bounded live ENTSO-E refresh was used for the selected short range."
            : status === "partial"
              ? "Some WB6 countries have no cached physical-flow rows in the selected period."
              : null,
      expectedHours,
      rows: rawRows.length,
      countries,
      hourly,
      counterparties: Array.from(counterpartyAcc.values())
        .map((row) => ({
          ...row,
          importsMwh: Math.round(row.importsMwh),
          exportsMwh: Math.round(row.exportsMwh),
          netMwh: Math.round(row.netMwh),
          counterpartyName: ZONES[row.counterparty as ZoneCode]?.name ?? row.counterparty,
        }))
        .sort((a, b) => Math.abs(b.netMwh) - Math.abs(a.netMwh))
        .slice(0, 12),
      topImporter,
      topExporter,
      topNetImporter,
      topNetExporter,
      totals: {
        importsMwh: countries.reduce((sum, country) => sum + country.importsMwh, 0),
        exportsMwh: countries.reduce((sum, country) => sum + country.exportsMwh, 0),
        netMwh: countries.reduce((sum, country) => sum + country.netMwh, 0),
        internalExchangeMwh: Math.round(internalExchangeMwh),
        externalExchangeMwh: Math.round(externalExchangeMwh),
        intraWb6Share: totalExchange ? (internalExchangeMwh / totalExchange) * 100 : null,
      },
    };
  });

export const getBalance = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const { from, to } = requestedRange(data);
    const result = await fetchLoadGenRange("RS", from, to, false, Boolean(data?.force));
    return {
      day: from,
      from,
      to,
      points: result.data,
      source: result.source,
      status: result.status,
      reason: result.reason,
      fetched_at: result.fetched_at,
      last_success_at: result.last_success_at,
      stale: result.stale,
      load: result.load,
      generation: result.generation,
    };
  });
