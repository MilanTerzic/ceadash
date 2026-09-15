import { createServerFn } from "@tanstack/react-start";
import { readCanonicalCapacity, readCanonicalFlows } from "./canonical-market-data.server";
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

/** Cross-border analytics from persisted observations only. */
export const getFlowAnalytics = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const fromDay = days[0];
    const toDay = days[days.length - 1];

    const borders = await Promise.all(
      RS_BORDERS.map(async (neighbour) => {
        const [imp, exp, capImp, capExp] = await Promise.all([
          readCanonicalFlows(neighbour, "RS", fromDay, toDay),
          readCanonicalFlows("RS", neighbour, fromDay, toDay),
          readCanonicalCapacity(neighbour, "RS", "daily", fromDay),
          readCanonicalCapacity("RS", neighbour, "daily", fromDay),
        ]);

        const merged = mergeDirectionalFlowPoints(imp.points, exp.points);
        const partialDirection = imp.source === "empty" || exp.source === "empty";
        const fetchedAt = [imp.fetched_at, exp.fetched_at, capImp?.fetched_at, capExp?.fetched_at]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? new Date().toISOString();

        return {
          neighbour,
          hourly: merged.hourly,
          capacity_imp_mw: capImp?.offered_mw ?? null,
          capacity_exp_mw: capExp?.offered_mw ?? null,
          source_imp: imp.source,
          source_exp: exp.source,
          cap_source: capImp || capExp ? "cache" : "empty",
          fetched_at: fetchedAt,
          coverage: {
            importIntervals: merged.observedImportIntervals,
            exportIntervals: merged.observedExportIntervals,
            matchedIntervals: merged.matchedIntervals,
            unmatchedIntervals: merged.unmatchedIntervals,
            status:
              merged.matchedIntervals === 0
                ? ("unavailable" as const)
                : merged.unmatchedIntervals > 0 || partialDirection
                  ? ("partial" as const)
                  : ("complete" as const),
          },
        };
      }),
    );

    return {
      from: fromDay,
      to: toDay,
      borders,
      fetched_at:
        borders
          .map((border) => border.fetched_at)
          .filter(Boolean)
          .sort()
          .at(-1) ?? new Date().toISOString(),
    };
  });
