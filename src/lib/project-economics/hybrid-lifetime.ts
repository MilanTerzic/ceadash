export type HybridYearOneRevenueStreams = {
  renewableMerchantEur: number;
  renewablePpaEur: number;
  batteryMerchantEur: number;
  tollingEur: number;
  ancillaryEur: number;
};

export type HybridLifetimeAssumptions = {
  lifetimeYears: number;
  basePriceEurPerMWh: number;
  yearlyPricesEurPerMWh: number[];
  solarShareOfRenewableRevenue: number;
  solarDegradationPct: number;
  windDegradationPct: number;
  bessAnnualCapacityDegradationPct: number;
};

/**
 * Build lifetime hybrid revenues without linking fixed BESS capacity revenues
 * to wholesale prices or renewable degradation.
 *
 * Merchant streams scale with the wholesale-price scenario. Renewable revenue
 * additionally scales with the weighted renewable degradation factor. Battery
 * merchant revenue scales with usable battery capacity. Tolling and ancillary
 * revenues remain nominally fixed because the current assumptions model has no
 * escalation/indexation input for those contracted capacity revenues.
 */
export function buildHybridLifetimeRevenue(
  streams: HybridYearOneRevenueStreams,
  assumptions: HybridLifetimeAssumptions,
): number[] {
  const years = Math.max(1, Math.round(assumptions.lifetimeYears));
  const basePrice =
    Number.isFinite(assumptions.basePriceEurPerMWh) && assumptions.basePriceEurPerMWh !== 0
      ? assumptions.basePriceEurPerMWh
      : 1;
  const solarShare = clamp01(assumptions.solarShareOfRenewableRevenue);
  const windShare = 1 - solarShare;
  const solarRate = clampPct(assumptions.solarDegradationPct) / 100;
  const windRate = clampPct(assumptions.windDegradationPct) / 100;
  const bessRate = clampPct(assumptions.bessAnnualCapacityDegradationPct) / 100;

  return Array.from({ length: years }, (_, yearIndex) => {
    const price = assumptions.yearlyPricesEurPerMWh[yearIndex] ?? basePrice;
    const priceFactor = Number.isFinite(price) ? price / basePrice : 1;
    const solarFactor = Math.pow(1 - solarRate, yearIndex);
    const windFactor = Math.pow(1 - windRate, yearIndex);
    const renewableFactor = solarShare * solarFactor + windShare * windFactor;
    const bessFactor = Math.pow(1 - bessRate, yearIndex);

    const renewableMerchant = streams.renewableMerchantEur * priceFactor * renewableFactor;
    const renewablePpa = streams.renewablePpaEur * renewableFactor;
    const batteryMerchant = streams.batteryMerchantEur * priceFactor * bessFactor;

    return (
      renewableMerchant +
      renewablePpa +
      batteryMerchant +
      streams.tollingEur +
      streams.ancillaryEur
    );
  });
}

export function weightedRenewableDegradationFactor(args: {
  yearIndex: number;
  solarGenerationMWh: number;
  windGenerationMWh: number;
  solarDegradationPct: number;
  windDegradationPct: number;
}): number {
  const solar = Math.max(0, args.solarGenerationMWh);
  const wind = Math.max(0, args.windGenerationMWh);
  const total = solar + wind;
  if (total <= 0) return 1;
  const solarFactor = Math.pow(1 - clampPct(args.solarDegradationPct) / 100, args.yearIndex);
  const windFactor = Math.pow(1 - clampPct(args.windDegradationPct) / 100, args.yearIndex);
  return (solar * solarFactor + wind * windFactor) / total;
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
