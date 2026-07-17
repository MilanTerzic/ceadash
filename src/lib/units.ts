export type EnergyUnit = "MWh" | "GWh" | "TWh";

export type PowerObservation = {
  ts: string;
  mw: number | null | undefined;
  durationMinutes?: number | null;
};

export type IntegratedPowerInterval = {
  ts: string;
  mw: number;
  durationMinutes: number;
  mwh: number;
  source: "explicit" | "next_timestamp" | "inferred_final";
};

export type PowerIntegrationResult = {
  mwh: number;
  intervalsUsed: number;
  intervalsSkipped: number;
  inferredResolutionMinutes: number | null;
  missingDurationCount: number;
  duplicateTimestampCount: number;
  irregularIntervalCount: number;
  gapCount: number;
  usedDurationMinutes: number;
  expectedDurationMinutes: number | null;
  coveragePct: number | null;
  intervals: IntegratedPowerInterval[];
  warnings: string[];
};

const numberFormat = (digits: number) =>
  new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

export function formatPowerMW(valueMW: number | null | undefined) {
  if (valueMW == null || !Number.isFinite(valueMW)) return "-";
  return `${numberFormat(0).format(valueMW)} MW`;
}

export function selectEnergyUnit(
  valuesMWh: number | null | undefined | Array<number | null | undefined>,
): EnergyUnit {
  const values = Array.isArray(valuesMWh) ? valuesMWh : [valuesMWh];
  const maxAbs = values.reduce<number>((max, value) => {
    if (value == null || !Number.isFinite(value)) return max;
    return Math.max(max, Math.abs(value));
  }, 0);
  if (maxAbs >= 1_000_000) return "TWh";
  if (maxAbs >= 1_000) return "GWh";
  return "MWh";
}

export function convertMWh(valueMWh: number, targetUnit: EnergyUnit) {
  if (targetUnit === "TWh") return valueMWh / 1_000_000;
  if (targetUnit === "GWh") return valueMWh / 1_000;
  return valueMWh;
}

export function formatEnergyValueMWh(
  valueMWh: number | null | undefined,
  targetUnit = selectEnergyUnit(valueMWh),
) {
  if (valueMWh == null || !Number.isFinite(valueMWh)) return "-";
  const value = convertMWh(valueMWh, targetUnit);
  const digits = targetUnit === "TWh" ? 2 : targetUnit === "GWh" ? 1 : Math.abs(value) < 10 ? 1 : 0;
  return numberFormat(digits).format(value);
}

export function formatEnergyMWh(
  valueMWh: number | null | undefined,
  targetUnit = selectEnergyUnit(valueMWh),
) {
  if (valueMWh == null || !Number.isFinite(valueMWh)) return "-";
  return `${formatEnergyValueMWh(valueMWh, targetUnit)} ${targetUnit}`;
}

function parsedPoints(points: PowerObservation[]) {
  return points
    .map((point, originalIndex) => ({
      ...point,
      originalIndex,
      timeMs: Date.parse(point.ts),
    }))
    .filter((point) => Number.isFinite(point.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs || a.originalIndex - b.originalIndex);
}

function modalResolutionMinutes(durations: number[]) {
  if (!durations.length) return null;
  const counts = new Map<number, number>();
  for (const duration of durations) counts.set(duration, (counts.get(duration) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function validDurationMinutes(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 24 * 60;
}

export function integratePowerSeries(points: PowerObservation[]): PowerIntegrationResult {
  const sorted = parsedPoints(points);
  const unique: typeof sorted = [];
  let duplicateTimestampCount = 0;
  let previousTs: string | null = null;
  for (const point of sorted) {
    if (point.ts === previousTs) {
      duplicateTimestampCount++;
      continue;
    }
    unique.push(point);
    previousTs = point.ts;
  }

  const timestampDiffs = unique
    .slice(0, -1)
    .map((point, index) => Math.round((unique[index + 1].timeMs - point.timeMs) / 60_000))
    .filter((duration) => duration > 0 && Number.isFinite(duration));
  const explicitDurations = unique
    .map((point) => point.durationMinutes)
    .filter((duration): duration is number => validDurationMinutes(duration));
  const inferredResolutionMinutes =
    modalResolutionMinutes(explicitDurations) ?? modalResolutionMinutes(timestampDiffs);
  const gapThresholdMinutes =
    inferredResolutionMinutes == null ? Number.POSITIVE_INFINITY : inferredResolutionMinutes * 1.5;

  let mwh = 0;
  let intervalsSkipped = duplicateTimestampCount;
  let missingDurationCount = 0;
  let irregularIntervalCount = 0;
  let gapCount = 0;
  let usedDurationMinutes = 0;
  let expectedDurationMinutes = 0;
  const intervals: IntegratedPowerInterval[] = [];
  const warnings: string[] = [];

  const regularSeries =
    duplicateTimestampCount === 0 &&
    inferredResolutionMinutes != null &&
    timestampDiffs.length > 0 &&
    timestampDiffs.every((duration) => duration === inferredResolutionMinutes);

  for (let index = 0; index < unique.length; index++) {
    const point = unique[index];
    const mw = Number(point.mw);
    if (!Number.isFinite(mw)) {
      intervalsSkipped++;
      continue;
    }

    let durationMinutes: number | null = null;
    let source: IntegratedPowerInterval["source"] = "explicit";
    if (validDurationMinutes(point.durationMinutes)) {
      durationMinutes = point.durationMinutes;
      source = "explicit";
    } else {
      const next = unique[index + 1];
      if (next) {
        const nextDuration = Math.round((next.timeMs - point.timeMs) / 60_000);
        if (nextDuration > 0 && Number.isFinite(nextDuration)) {
          expectedDurationMinutes += nextDuration;
          if (nextDuration > gapThresholdMinutes) {
            intervalsSkipped++;
            gapCount++;
            continue;
          }
          if (inferredResolutionMinutes != null && nextDuration !== inferredResolutionMinutes) {
            irregularIntervalCount++;
          }
          durationMinutes = nextDuration;
          source = "next_timestamp";
        }
      } else if (regularSeries && inferredResolutionMinutes != null) {
        durationMinutes = inferredResolutionMinutes;
        source = "inferred_final";
        expectedDurationMinutes += durationMinutes;
      }
    }

    if (durationMinutes == null) {
      intervalsSkipped++;
      missingDurationCount++;
      if (inferredResolutionMinutes != null) expectedDurationMinutes += inferredResolutionMinutes;
      continue;
    }

    if (source === "explicit") expectedDurationMinutes += durationMinutes;
    const intervalMWh = mw * (durationMinutes / 60);
    mwh += intervalMWh;
    usedDurationMinutes += durationMinutes;
    intervals.push({ ts: point.ts, mw, durationMinutes, mwh: intervalMWh, source });
  }

  if (duplicateTimestampCount > 0)
    warnings.push(`${duplicateTimestampCount} duplicate timestamp(s) skipped.`);
  if (gapCount > 0) warnings.push(`${gapCount} large gap interval(s) skipped.`);
  if (missingDurationCount > 0)
    warnings.push(`${missingDurationCount} interval(s) without reliable duration skipped.`);
  if (irregularIntervalCount > 0)
    warnings.push(
      `${irregularIntervalCount} irregular interval(s) integrated using timestamp duration.`,
    );

  return {
    mwh,
    intervalsUsed: intervals.length,
    intervalsSkipped,
    inferredResolutionMinutes,
    missingDurationCount,
    duplicateTimestampCount,
    irregularIntervalCount,
    gapCount,
    usedDurationMinutes,
    expectedDurationMinutes: expectedDurationMinutes > 0 ? expectedDurationMinutes : null,
    coveragePct:
      expectedDurationMinutes > 0 ? (usedDurationMinutes / expectedDurationMinutes) * 100 : null,
    intervals,
    warnings,
  };
}
