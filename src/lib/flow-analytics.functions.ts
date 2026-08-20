import { createServerFn } from "@tanstack/react-start";
import { fetchExplicitAllocation, fetchPhysicalFlows } from "./entsoe.server";
import { mergeDirectionalFlowPoints } from "./flow-calculations";
import { type ZoneCode } from "./markets";

const RS_BORDERS: ZoneCode[] = ["HU", "RO", "BG", "HR", "ME", "MK"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RangeInput = { day?: string; from?: string; to?: string };

function todayBelgradeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function cleanDate(value?: string): string | undefined {
  return value && ISO_DATE_RE.test(value) ? value : undefined;
}

function expandRange(fromIn?: string, toIn?: string, dayIn?: string): string[] {
  const from = cleanDate(fromIn);
  const to = cleanDate(toIn);
  const day = cleanDate(dayIn);
  if (!from && !to && !day) return [todayBelgradeISO()];
  if (from && to) {
    const start = Date.parse(`${from}T12:00:00Z`);
    const end = Date.parse(`${to}T12:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [from];
    const days: string[] = [];
    const cappedEnd = Math.min(end, start + 365 * 86_400_000);
    for (let ts = start; ts <= cappedEnd; ts += 86_400_000) {
      days.push(new Date(ts).toISOString().slice(0, 10));
    }
    return days;
  }
  return [day ?? from ?? to ?? todayBelgradeISO()];
}

export const getFlowAnalytics = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const borders = await Promise.all(
      RS_BORDERS.map(async (neighbour) => {
        const [impParts, expParts, capImp, capExp] = await Promise.all([
          Promise.all(days.map((day) => fetchPhysicalFlows(neighbour, "RS", day))),
          Promise.all(days.map((day) => fetchPhysicalFlows("RS", neighbour, day))),
          fetchExplicitAllocation(neighbour, "RS", "daily", days[0]),
          fetchExplicitAllocation("RS", neighbour, "daily", days[0]),
        ]);

        const imported = impParts.flatMap((result) => result.data.points);
        const exported = expParts.flatMap((result) => result.data.points);
        const merged = mergeDirectionalFlowPoints(imported, exported);
        const sourceImp = impParts[0]?.source ?? "empty";
        const sourceExp = expParts[0]?.source ?? "empty";

        return {
          neighbour,
          hourly: merged.hourly,
          capacity_imp_mw: capImp.data.offered_mw,
          capacity_exp_mw: capExp.data.offered_mw,
          source_imp: sourceImp,
          source_exp: sourceExp,
          cap_source: capImp.source,
          fetched_at: impParts[0]?.fetched_at ?? expParts[0]?.fetched_at ?? new Date().toISOString(),
          coverage: {
            importIntervals: merged.observedImportIntervals,
            exportIntervals: merged.observedExportIntervals,
            matchedIntervals: merged.matchedIntervals,
            unmatchedIntervals: merged.unmatchedIntervals,
            status:
              merged.matchedIntervals === 0
                ? ("unavailable" as const)
                : merged.unmatchedIntervals > 0 || sourceImp === "empty" || sourceExp === "empty"
                  ? ("partial" as const)
                  : ("complete" as const),
          },
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
