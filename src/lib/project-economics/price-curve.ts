import type {
  ExpectedPriceCurve,
  FuturesCurveContract,
  FuturesLoadSelection,
  HourlyPricePoint,
  PriceSourceMode,
  PriceYearAssumption,
} from "./types";

const maturityRank: Record<string, number> = { month: 3, quarter: 2, year: 1 };

function monthKey(timestamp: string) {
  return timestamp.slice(0, 7);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function monthStart(month: string) {
  return `${month}-01`;
}

export function selectContractForMonth(
  contracts: FuturesCurveContract[],
  month: string,
  loadType: FuturesLoadSelection,
) {
  const date = monthStart(month);
  return (
    contracts
      .filter(
        (contract) =>
          contract.loadType === loadType &&
          contract.settlementPrice != null &&
          Number.isFinite(contract.settlementPrice) &&
          contract.deliveryStart.slice(0, 10) <= date &&
          contract.deliveryEnd.slice(0, 10) >= date,
      )
      .sort(
        (a, b) =>
          (maturityRank[b.maturityType] ?? 0) - (maturityRank[a.maturityType] ?? 0) ||
          String(b.tradingDate).localeCompare(String(a.tradingDate)),
      )[0] ?? null
  );
}

function availableContractYears(contracts: FuturesCurveContract[]) {
  return contracts
    .filter((contract) => contract.settlementPrice != null)
    .flatMap((contract) => [
      Number(contract.deliveryStart.slice(0, 4)),
      Number(contract.deliveryEnd.slice(0, 4)),
    ])
    .filter(Number.isFinite);
}

function yearMonths(year: number) {
  return Array.from({ length: 12 }, (_, month) => `${year}-${String(month + 1).padStart(2, "0")}`);
}

function targetForMonth(input: {
  mode: PriceSourceMode;
  historicalAverage: number;
  manualFallbackEurPerMWh: number | null;
  contract: FuturesCurveContract | null;
}) {
  if (input.mode === "historical") {
    return { target: input.historicalAverage, source: "historical" as const };
  }
  if (input.mode === "manual") {
    return {
      target: input.manualFallbackEurPerMWh ?? input.historicalAverage,
      source: input.manualFallbackEurPerMWh == null ? ("historical" as const) : ("manual" as const),
    };
  }
  if (input.contract?.settlementPrice != null) {
    return { target: input.contract.settlementPrice, source: "futures" as const };
  }
  if (input.manualFallbackEurPerMWh != null) {
    return { target: input.manualFallbackEurPerMWh, source: "manual" as const };
  }
  return { target: input.historicalAverage, source: "historical" as const };
}

export function buildExpectedPriceCurve(input: {
  historicalShape: HourlyPricePoint[];
  contracts: FuturesCurveContract[];
  mode: PriceSourceMode;
  loadType: FuturesLoadSelection;
  manualFallbackEurPerMWh: number | null;
  lifetimeYears: number;
  terminalEscalationPct: number;
}): ExpectedPriceCurve {
  const validHistorical = input.historicalShape.filter(
    (point) => Number.isFinite(Date.parse(point.ts)) && Number.isFinite(point.priceEurPerMWh),
  );
  if (!validHistorical.length) {
    return {
      hourly: [],
      monthly: [],
      yearly: [],
      contractsUsed: [],
      warnings: ["No valid hourly price shape is available."],
    };
  }

  const byMonth = new Map<string, HourlyPricePoint[]>();
  for (const point of validHistorical) {
    const month = monthKey(point.ts);
    byMonth.set(month, [...(byMonth.get(month) ?? []), point]);
  }

  const monthly: ExpectedPriceCurve["monthly"] = [];
  const adjustedByTimestamp = new Map<string, number>();
  const contractsUsed = new Set<string>();
  const warnings: string[] = [];

  for (const [month, points] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const historicalAverageEurPerMWh = average(points.map((point) => point.priceEurPerMWh));
    const contract =
      input.mode === "futures"
        ? selectContractForMonth(input.contracts, month, input.loadType)
        : null;
    const target = targetForMonth({
      mode: input.mode,
      historicalAverage: historicalAverageEurPerMWh,
      manualFallbackEurPerMWh: input.manualFallbackEurPerMWh,
      contract,
    });
    if (contract) contractsUsed.add(contract.contractName);
    if (input.mode === "futures" && !contract) {
      warnings.push(
        input.manualFallbackEurPerMWh == null
          ? `${month}: no matching futures settlement; historical shape retained.`
          : `${month}: no matching futures settlement; explicit manual fallback used.`,
      );
    }
    const shift = target.target - historicalAverageEurPerMWh;
    for (const point of points) {
      adjustedByTimestamp.set(
        point.ts,
        input.mode === "manual" ? target.target : point.priceEurPerMWh + shift,
      );
    }
    monthly.push({
      month,
      historicalAverageEurPerMWh,
      targetAverageEurPerMWh: target.target,
      source: target.source,
      contract: contract?.contractName ?? null,
    });
  }

  const hourly = validHistorical.map((point) => ({
    ts: point.ts,
    priceEurPerMWh: adjustedByTimestamp.get(point.ts) ?? point.priceEurPerMWh,
  }));
  const firstYear = Number(monthly[0]?.month.slice(0, 4)) || new Date().getUTCFullYear();
  const projectYears = Math.max(1, Math.round(input.lifetimeYears));
  const contractYears = availableContractYears(input.contracts);
  const lastCoveredYear = contractYears.length ? Math.max(...contractYears) : null;
  const historicalAverage = average(validHistorical.map((point) => point.priceEurPerMWh));
  const firstScenarioAverage = average(hourly.map((point) => point.priceEurPerMWh));
  const escalation = Math.max(-0.99, input.terminalEscalationPct / 100);
  const yearly: PriceYearAssumption[] = [];

  for (let offset = 0; offset < projectYears; offset++) {
    const year = firstYear + offset;
    if (offset === 0) {
      const sources = new Set(monthly.map((row) => row.source));
      yearly.push({
        year,
        averageEurPerMWh: firstScenarioAverage,
        source:
          sources.size === 1
            ? (monthly[0]?.source ?? "historical")
            : sources.has("futures")
              ? "partial-futures"
              : sources.has("manual")
                ? "manual"
                : "historical",
        contracts: monthly.flatMap((row) => (row.contract ? [row.contract] : [])),
      });
      continue;
    }

    const selected = yearMonths(year)
      .map((month) => selectContractForMonth(input.contracts, month, input.loadType))
      .filter((contract): contract is FuturesCurveContract => contract != null);
    if (selected.length > 0) {
      selected.forEach((contract) => contractsUsed.add(contract.contractName));
      yearly.push({
        year,
        averageEurPerMWh: average(selected.map((contract) => contract.settlementPrice!)),
        source: selected.length === 12 ? "futures" : "partial-futures",
        contracts: [...new Set(selected.map((contract) => contract.contractName))],
      });
      continue;
    }

    const previous = yearly[offset - 1];
    const terminalBase =
      previous?.averageEurPerMWh ??
      input.manualFallbackEurPerMWh ??
      firstScenarioAverage ??
      historicalAverage;
    yearly.push({
      year,
      averageEurPerMWh: terminalBase * (1 + escalation),
      source:
        input.mode === "manual" && lastCoveredYear == null
          ? "manual"
          : input.mode === "historical" && lastCoveredYear == null
            ? "historical"
            : "terminal",
      contracts: [],
    });
  }

  if (input.mode === "futures" && contractsUsed.size === 0) {
    warnings.unshift(
      "No verified futures settlement was available; no futures value was fabricated.",
    );
  }

  return {
    hourly,
    monthly,
    yearly,
    contractsUsed: [...contractsUsed],
    warnings: [...new Set(warnings)],
  };
}
