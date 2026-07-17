export type AssetType = "solar" | "wind" | "bess" | "hybrid";
export type PriceSourceMode = "futures" | "historical" | "manual";
export type FuturesLoadSelection = "base" | "peak";
export type NegativePriceRule = "always" | "curtail_negative" | "curtail_threshold";
export type RenewableRevenueStructure =
  "merchant" | "fixed" | "pay_as_produced" | "baseload" | "hybrid";
export type BessRevenueStructure = "merchant" | "tolling" | "hybrid";
export type HybridRevenueStructure =
  "merchant" | "renewable_ppa" | "partial_ppa" | "baseload_ppa" | "battery_tolling";
export type HybridComponents = "solar_bess" | "wind_bess" | "solar_wind_bess";

export type FinancingAssumptions = {
  discountRatePct: number;
  debtSharePct: number;
  interestRatePct: number;
  loanTenorYears: number;
};

export type PriceAssumptions = {
  mode: PriceSourceMode;
  market: string;
  loadType: FuturesLoadSelection;
  manualPriceEurPerMWh: number;
  terminalEscalationPct: number;
};

export type SolarAssumptions = FinancingAssumptions & {
  projectName: string;
  capacityMWp: number;
  gridMWac: number;
  capexEurPerKWp: number;
  fixedOpexEurPerKWYear: number;
  variableOpexEurPerMWh: number;
  degradationPct: number;
  lifetimeYears: number;
  ppaPriceEurPerMWh: number;
  revenueStructure: RenewableRevenueStructure;
  merchantSharePct: number;
  curtailmentPct: number;
  negativePriceRule: NegativePriceRule;
  curtailThresholdEurPerMWh: number;
};

export type WindAssumptions = FinancingAssumptions & {
  projectName: string;
  capacityMW: number;
  gridMW: number;
  netCapacityFactorPct: number;
  capexEurPerKW: number;
  fixedOpexEurPerKWYear: number;
  variableOpexEurPerMWh: number;
  availabilityPct: number;
  wakeElectricalLossPct: number;
  degradationPct: number;
  lifetimeYears: number;
  curtailmentPct: number;
  negativePriceRule: NegativePriceRule;
  curtailThresholdEurPerMWh: number;
  ppaPriceEurPerMWh: number;
  revenueStructure: RenewableRevenueStructure;
  merchantSharePct: number;
};

export type BessAssumptions = FinancingAssumptions & {
  projectName: string;
  powerMW: number;
  energyMWh: number;
  gridImportMW: number;
  gridExportMW: number;
  minSocPct: number;
  maxSocPct: number;
  roundTripEfficiencyPct: number;
  availabilityPct: number;
  maxCyclesPerDay: number;
  annualCapacityDegradationPct: number;
  capexEurPerKW: number;
  capexEurPerKWh: number;
  fixedOpexEurPerKWYear: number;
  variableThroughputEurPerMWh: number;
  augmentationYear: number;
  augmentationCostPct: number;
  lifetimeYears: number;
  revenueStructure: BessRevenueStructure;
  tollingEurPerMWYear: number;
  tollingSharePct: number;
  ancillaryEurPerMWYear: number;
};

export type HybridAssumptions = FinancingAssumptions & {
  projectName: string;
  components: HybridComponents;
  solar: SolarAssumptions;
  wind: WindAssumptions;
  bess: BessAssumptions;
  sharedGridExportMW: number;
  sharedGridImportMW: number;
  gridChargingAllowed: boolean;
  chargeOnlyFromRenewables: boolean;
  ppaVolumeEligibleForShifting: boolean;
  exportAboveRenewableOutput: boolean;
  curtailmentRecovery: boolean;
  revenueStructure: HybridRevenueStructure;
  ppaPriceEurPerMWh: number;
  merchantSharePct: number;
  baseloadObligationMW: number;
  lifetimeYears: number;
};

export type HourlyPricePoint = {
  ts: string;
  priceEurPerMWh: number;
};

export type FuturesCurveContract = {
  contractName: string;
  loadType: FuturesLoadSelection;
  maturityType: "month" | "quarter" | "year" | string;
  deliveryStart: string;
  deliveryEnd: string;
  settlementPrice: number | null;
  tradingDate: string | null;
  status?: string;
};

export type PriceYearAssumption = {
  year: number;
  averageEurPerMWh: number;
  source: "futures" | "partial-futures" | "manual" | "historical" | "terminal";
  contracts: string[];
};

export type ExpectedPriceCurve = {
  hourly: HourlyPricePoint[];
  monthly: Array<{
    month: string;
    historicalAverageEurPerMWh: number;
    targetAverageEurPerMWh: number;
    source: PriceYearAssumption["source"];
    contract: string | null;
  }>;
  yearly: PriceYearAssumption[];
  contractsUsed: string[];
  warnings: string[];
};

export type FinancialResults = {
  totalCapexEur: number;
  annualRevenueEur: number[];
  annualOpexEur: number[];
  annualEbitdaEur: number[];
  cashflowsEur: number[];
  projectIrr: number | null;
  npvEur: number;
  paybackYears: number | null;
  dscrMin: number | null;
  lcoeEurPerMWh: number | null;
};

export type MonthlyValue = { month: number; value: number };

export type RenewableResults = FinancialResults & {
  annualGenerationMWh: number;
  capacityFactor: number;
  capturePriceEurPerMWh: number | null;
  captureRate: number | null;
  merchantRevenueEur: number;
  ppaRevenueEur: number;
  blendedPriceEurPerMWh: number | null;
  curtailedGenerationMWh: number;
  negativePriceGenerationMWh: number;
  breakEvenPpaEurPerMWh: number | null;
  monthlyGenerationMWh: MonthlyValue[];
  monthlyRevenueEur: MonthlyValue[];
  hourlyGenerationMWh: number[];
};

export type BessDispatchPoint = {
  ts: string;
  priceEurPerMWh: number;
  chargingMW: number;
  dischargingMW: number;
  socMWh: number;
  chargingCostEur: number;
  dischargeRevenueEur: number;
  netMarginEur: number;
};

export type BessResults = FinancialResults & {
  durationHours: number;
  annualChargedMWh: number;
  annualDischargedMWh: number;
  equivalentFullCycles: number;
  averageChargingPriceEurPerMWh: number | null;
  averageDischargingPriceEurPerMWh: number | null;
  capturedSpreadEurPerMWh: number | null;
  grossArbitrageRevenueEur: number;
  tollingRevenueEur: number;
  ancillaryRevenueEur: number;
  variableCostsEur: number;
  netOperatingRevenueEur: number;
  lcosEurPerMWh: number | null;
  annualUsableCapacityMWh: number[];
  dispatch: BessDispatchPoint[];
};

export type HybridResults = FinancialResults & {
  solarGenerationMWh: number;
  windGenerationMWh: number;
  totalRenewableGenerationMWh: number;
  directRenewableExportMWh: number;
  bessChargingFromRenewablesMWh: number;
  bessChargingFromGridMWh: number;
  bessDischargeMWh: number;
  recoveredClippedEnergyMWh: number;
  remainingCurtailmentMWh: number;
  gridImportMWh: number;
  gridExportMWh: number;
  renewableChargingShare: number | null;
  capturePriceBeforeStorageEurPerMWh: number | null;
  capturePriceAfterStorageEurPerMWh: number | null;
  capturePriceUpliftEurPerMWh: number | null;
  merchantRevenueEur: number;
  ppaRevenueEur: number;
  batteryRevenueEur: number;
  monthlyEnergyMWh: Array<{
    month: number;
    renewableExport: number;
    batteryCharge: number;
    batteryDischarge: number;
  }>;
  monthlyRevenueEur: MonthlyValue[];
  dispatch: Array<{
    ts: string;
    renewableMW: number;
    directExportMW: number;
    batteryChargeMW: number;
    batteryDischargeMW: number;
    gridImportMW: number;
    gridExportMW: number;
    socMWh: number;
  }>;
};
