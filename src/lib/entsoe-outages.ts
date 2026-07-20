import { addDaysIso, assertValidDateRange, chunkDateRange } from "./fundamentals";
import type { ZoneCode } from "./markets";

export type OutageType = "planned" | "forced" | "unknown";
export type LegacyOutageType = "planned" | "forced" | "other";

export type OutageRow = {
  zone: ZoneCode;
  unit: string;
  mw: number;
  type: LegacyOutageType;
  unit_id?: string;
  production_type?: string;
  outage_type: OutageType;
  start: string;
  end: string;
  available_mw: number | null;
  normal_capacity_mw: number | null;
  unavailable_mw: number | null;
  document_id?: string;
  document_status?: string;
  revision?: number;
  business_type?: string;
  bidding_zone?: string;
  source: string;
};

const CANCELLED_DOCUMENT_STATUSES = new Set(["A09", "A13"]);

function stripNamespaces(xml: string): string {
  return xml.replace(/(<\/?)[\w-]+:/g, "$1");
}

function tagAll(xml: string, tag: string): string[] {
  const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(xml))) values.push(match[1]);
  return values;
}

function tagOne(xml: string, tag: string): string | null {
  const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = expression.exec(xml);
  if (!match) return null;
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function firstTag(xml: string, tags: string[]): string | null {
  for (const tag of tags) {
    const value = tagOne(xml, tag);
    if (value) return value;
  }
  return null;
}

function finiteCapacity(value: string | null): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseResolutionMinutes(resolution: string | null): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(resolution ?? "");
  if (!match) return 60;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[2] ? Number(match[2]) : 0;
  return hours * 60 + minutes || 60;
}

function combinedDateTime(date: string | null, time: string | null): string | null {
  if (!date || !time) return null;
  const value = `${date}T${time}`;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function outageTypeFromBusinessType(value: string | null): OutageType {
  const code = value?.trim().toUpperCase();
  if (code === "A53") return "planned";
  if (code === "A54") return "forced";
  return "unknown";
}

export function inspectEntsoeXml(xml: string): {
  kind: "data" | "no_data" | "error";
  reason?: string;
} {
  const trimmed = xml.trim();
  if (!trimmed) return { kind: "error", reason: "entsoe_empty_response" };
  const clean = stripNamespaces(trimmed);
  const isAcknowledgement =
    /<(Acknowledgement_MarketDocument|ProblemStatement_MarketDocument)\b/i.test(clean);
  if (!isAcknowledgement) return { kind: "data" };

  const code = firstTag(clean, ["code", "Reason.code"]);
  const text = firstTag(clean, ["text", "Reason.text"])?.toLowerCase() ?? "";
  if (
    code === "999" ||
    text.includes("no matching data") ||
    text.includes("no data") ||
    text.includes("not found")
  ) {
    return { kind: "no_data", reason: "entsoe_no_data" };
  }
  return {
    kind: "error",
    reason: code ? `entsoe_acknowledgement_${code}` : "entsoe_acknowledgement_error",
  };
}

function parseAvailableRows(
  timeSeries: string,
  fallbackStart: string | null,
  fallbackEnd: string | null,
  normalCapacity: number | null,
): Array<{
  start: string;
  end: string;
  available_mw: number | null;
  normal_capacity_mw: number | null;
}> {
  const periods = tagAll(timeSeries, "Available_Period");
  const rows: Array<{
    start: string;
    end: string;
    available_mw: number | null;
    normal_capacity_mw: number | null;
  }> = [];

  for (const period of periods) {
    const interval = tagOne(period, "timeInterval") ?? period;
    const periodStart = tagOne(interval, "start") ?? fallbackStart;
    const periodEnd = tagOne(interval, "end") ?? fallbackEnd;
    if (!periodStart || !periodEnd) continue;
    const periodStartMs = Date.parse(periodStart);
    const periodEndMs = Date.parse(periodEnd);
    if (!Number.isFinite(periodStartMs) || !Number.isFinite(periodEndMs)) continue;

    const durationMinutes = parseResolutionMinutes(tagOne(period, "resolution"));
    const points = tagAll(period, "Point")
      .map((point) => ({
        position: Math.max(1, Number(tagOne(point, "position") ?? 1)),
        available_mw: finiteCapacity(tagOne(point, "quantity")),
        normal_capacity_mw:
          finiteCapacity(
            firstTag(point, ["installed_Quantity.quantity", "installedQuantity.quantity"]),
          ) ?? normalCapacity,
      }))
      .filter((point) => Number.isFinite(point.position))
      .sort((a, b) => a.position - b.position);

    if (!points.length) {
      rows.push({
        start: new Date(periodStartMs).toISOString(),
        end: new Date(periodEndMs).toISOString(),
        available_mw: null,
        normal_capacity_mw: normalCapacity,
      });
      continue;
    }

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const next = points[index + 1];
      const startMs = periodStartMs + (point.position - 1) * durationMinutes * 60_000;
      const nextMs = next
        ? periodStartMs + (next.position - 1) * durationMinutes * 60_000
        : periodEndMs;
      if (nextMs <= startMs) continue;
      rows.push({
        start: new Date(startMs).toISOString(),
        end: new Date(nextMs).toISOString(),
        available_mw: point.available_mw,
        normal_capacity_mw: point.normal_capacity_mw,
      });
    }
  }

  if (!rows.length && fallbackStart && fallbackEnd) {
    const startMs = Date.parse(fallbackStart);
    const endMs = Date.parse(fallbackEnd);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      rows.push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        available_mw: null,
        normal_capacity_mw: normalCapacity,
      });
    }
  }
  return rows;
}

export function parseOutageRows(
  xml: string,
  zone: ZoneCode,
  requestedFrom: string,
  requestedTo: string,
): OutageRow[] {
  assertValidDateRange(requestedFrom, requestedTo);
  const envelope = inspectEntsoeXml(xml);
  if (envelope.kind !== "data") return [];

  const clean = stripNamespaces(xml);
  const documentId = tagOne(clean, "mRID") ?? undefined;
  const revisionValue = Number(tagOne(clean, "revisionNumber"));
  const revision = Number.isInteger(revisionValue) ? revisionValue : undefined;
  const documentStatus =
    firstTag(tagOne(clean, "docStatus") ?? "", ["value", "docStatus.value"]) ?? "A05";
  const documentType = tagOne(clean, "type") ?? "unknown";
  const documentSource = `ENTSO-E ${documentType}`;
  const requestStartMs = Date.parse(`${requestedFrom}T00:00:00Z`);
  const requestEndMs = Date.parse(`${addDaysIso(requestedTo, 1)}T00:00:00Z`);
  const rows: OutageRow[] = [];

  for (const timeSeries of tagAll(clean, "TimeSeries")) {
    const businessType = tagOne(timeSeries, "businessType");
    const outageType = outageTypeFromBusinessType(businessType);
    const productionResourceId = firstTag(timeSeries, [
      "production_RegisteredResource.pSRType.powerSystemResources.mRID",
      "production_RegisteredResource.mRID",
      "registeredResource.mRID",
    ]);
    const unitName =
      firstTag(timeSeries, [
        "production_RegisteredResource.pSRType.powerSystemResources.name",
        "production_RegisteredResource.name",
        "registeredResource.name",
      ]) ??
      productionResourceId ??
      "Unknown unit";
    const productionType = firstTag(timeSeries, [
      "production_RegisteredResource.pSRType.psrType",
      "MktPSRType.psrType",
      "psrType",
    ]);
    const biddingZone = firstTag(timeSeries, [
      "biddingZone_Domain.mRID",
      "BiddingZone_Domain.mRID",
    ]);
    const fallbackStart =
      combinedDateTime(
        tagOne(timeSeries, "start_DateAndOrTime.date"),
        tagOne(timeSeries, "start_DateAndOrTime.time"),
      ) ?? tagOne(tagOne(clean, "unavailability_Time_Period.timeInterval") ?? "", "start");
    const fallbackEnd =
      combinedDateTime(
        tagOne(timeSeries, "end_DateAndOrTime.date"),
        tagOne(timeSeries, "end_DateAndOrTime.time"),
      ) ?? tagOne(tagOne(clean, "unavailability_Time_Period.timeInterval") ?? "", "end");
    const normalCapacity = finiteCapacity(
      firstTag(timeSeries, [
        "production_RegisteredResource.pSRType.powerSystemResources.nominalP",
        "production_RegisteredResource.nominalP",
        "registeredResource.nominalP",
        "nominalP",
      ]),
    );

    for (const period of parseAvailableRows(
      timeSeries,
      fallbackStart,
      fallbackEnd,
      normalCapacity,
    )) {
      const startMs = Date.parse(period.start);
      const endMs = Date.parse(period.end);
      if (endMs <= requestStartMs || startMs >= requestEndMs) continue;
      const unavailableMw =
        period.available_mw != null && period.normal_capacity_mw != null
          ? Math.max(period.normal_capacity_mw - period.available_mw, 0)
          : null;
      const legacyType: LegacyOutageType = outageType === "unknown" ? "other" : outageType;
      rows.push({
        zone,
        unit: unitName,
        mw: unavailableMw ?? 0,
        type: legacyType,
        unit_id: productionResourceId ?? undefined,
        production_type: productionType ?? undefined,
        outage_type: outageType,
        start: period.start,
        end: period.end,
        available_mw: period.available_mw,
        normal_capacity_mw: period.normal_capacity_mw,
        unavailable_mw: unavailableMw,
        document_id: documentId,
        document_status: documentStatus,
        revision,
        business_type: businessType ?? undefined,
        bidding_zone: biddingZone ?? undefined,
        source: documentSource,
      });
    }
  }
  return rows;
}

function outageIdentity(row: OutageRow): string {
  return [
    row.zone,
    row.document_id ?? "",
    row.unit_id ?? row.unit,
    row.outage_type,
    row.start,
    row.end,
  ].join("|");
}

export function dedupeOutageRevisions(rows: OutageRow[]): OutageRow[] {
  const latest = new Map<string, OutageRow>();
  for (const row of rows) {
    const key = outageIdentity(row);
    const existing = latest.get(key);
    const existingRevision = existing?.revision ?? 0;
    const rowRevision = row.revision ?? 0;
    if (!existing || rowRevision > existingRevision || rowRevision === existingRevision) {
      latest.set(key, row);
    }
  }
  return [...latest.values()]
    .filter((row) => !CANCELLED_DOCUMENT_STATUSES.has(row.document_status ?? ""))
    .sort((a, b) => {
      const unavailable = (b.unavailable_mw ?? -1) - (a.unavailable_mw ?? -1);
      return unavailable !== 0 ? unavailable : a.start.localeCompare(b.start);
    });
}

export function chunkOutageRange(from: string, to: string): Array<{ from: string; to: string }> {
  return chunkDateRange(from, to, 31);
}
