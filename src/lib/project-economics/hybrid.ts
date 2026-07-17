import { dailySignalSets } from "./bess";
import { calculateFinancialResults, clamp } from "./finance";
import { scaleWindProfileToCapacityFactor } from "./wind";
import type { ExpectedPriceCurve, HybridAssumptions, HybridResults } from "./types";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function runHybridEconomics(input: {
  assumptions: HybridAssumptions;
  solarProfilePerMW: number[];
  windProfile: number[];
  priceCurve: ExpectedPriceCurve;
}): HybridResults {
  const assumptions = input.assumptions;
  const hasSolar =
    assumptions.components === "solar_bess" || assumptions.components === "solar_wind_bess";
  const hasWind =
    assumptions.components === "wind_bess" || assumptions.components === "solar_wind_bess";
  const n = Math.min(
    input.priceCurve.hourly.length,
    hasSolar ? input.solarProfilePerMW.length : Number.POSITIVE_INFINITY,
    hasWind ? input.windProfile.length : Number.POSITIVE_INFINITY,
  );
  const solarCurtailment = 1 - clamp(assumptions.solar.curtailmentPct, 0, 100) / 100;
  const windAvailability = clamp(assumptions.wind.availabilityPct, 0, 100) / 100;
  const windLoss = 1 - clamp(assumptions.wind.wakeElectricalLossPct, 0, 100) / 100;
  const windOperatingFactor = windAvailability * windLoss;
  const grossWindTarget =
    windOperatingFactor > 0
      ? clamp(assumptions.wind.netCapacityFactorPct / 100 / windOperatingFactor, 0, 1)
      : 0;
  const windProfile = scaleWindProfileToCapacityFactor(
    input.windProfile.slice(0, n),
    grossWindTarget,
  ).map((value) => value * windOperatingFactor);
  const renewableMWh = Array.from({ length: n }, (_, index) => {
    const solar =
      (hasSolar ? Math.max(0, input.solarProfilePerMW[index] ?? 0) : 0) *
      Math.max(0, assumptions.solar.capacityMWp) *
      solarCurtailment;
    const wind =
      (hasWind ? Math.max(0, windProfile[index] ?? 0) : 0) *
      Math.max(0, assumptions.wind.capacityMW) *
      (1 - clamp(assumptions.wind.curtailmentPct, 0, 100) / 100);
    return { solar, wind, total: solar + wind };
  });

  const bess = assumptions.bess;
  const usableEnergyMWh = Math.max(0, bess.energyMWh);
  const powerMW = Math.max(0, bess.powerMW) * (clamp(bess.availabilityPct, 0, 100) / 100);
  const minSocMWh = usableEnergyMWh * (clamp(bess.minSocPct, 0, 100) / 100);
  const maxSocMWh = usableEnergyMWh * (clamp(bess.maxSocPct, 0, 100) / 100);
  const oneWayEfficiency = Math.sqrt(clamp(bess.roundTripEfficiencyPct, 0.01, 100) / 100);
  const sharedExportMW = Math.max(0, assumptions.sharedGridExportMW);
  const sharedImportMW = Math.max(0, assumptions.sharedGridImportMW);
  const durationHours = bess.powerMW > 0 ? usableEnergyMWh / bess.powerMW : 0;
  const maxCycles = clamp(bess.maxCyclesPerDay, 0, 10);
  let socMWh = minSocMWh;
  const dispatch: HybridResults["dispatch"] = [];

  let directRenewableExportMWh = 0;
  let bessChargingFromRenewablesMWh = 0;
  let bessChargingFromGridMWh = 0;
  let bessDischargeMWh = 0;
  let recoveredClippedEnergyMWh = 0;
  let remainingCurtailmentMWh = 0;
  let gridImportMWh = 0;
  let gridExportMWh = 0;
  let merchantRevenueEur = 0;
  let ppaRevenueEur = 0;
  let batteryRevenueEur = 0;
  let beforeStorageRevenue = 0;
  let afterStorageRevenue = 0;
  const monthlyEnergyMWh = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    renewableExport: 0,
    batteryCharge: 0,
    batteryDischarge: 0,
  }));
  const monthlyRevenueEur = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    value: 0,
  }));

  for (let dayStart = 0; dayStart < n; dayStart += 24) {
    const dayPrices = input.priceCurve.hourly
      .slice(dayStart, dayStart + 24)
      .map((point) => point.priceEurPerMWh);
    const signals = dailySignalSets(dayPrices, durationHours, maxCycles);
    let dailyChargedMWh = 0;
    let dailyDischargedMWh = 0;
    const dailyLimitMWh = usableEnergyMWh * maxCycles;

    for (let localHour = 0; localHour < dayPrices.length; localHour++) {
      const index = dayStart + localHour;
      const pricePoint = input.priceCurve.hourly[index];
      const renewable = renewableMWh[index];
      const directExportMW = Math.min(renewable.total, sharedExportMW);
      const clippedMW = Math.max(0, renewable.total - directExportMW);
      let batteryChargeMW = 0;
      let renewableChargeMW = 0;
      let gridChargeMW = 0;
      let batteryDischargeMW = 0;
      const chargeHeadroomMW = Math.max(0, (maxSocMWh - socMWh) / oneWayEfficiency);

      if (assumptions.curtailmentRecovery && clippedMW > 0 && dailyChargedMWh < dailyLimitMWh) {
        renewableChargeMW = Math.min(
          clippedMW,
          powerMW,
          chargeHeadroomMW,
          dailyLimitMWh - dailyChargedMWh,
        );
        batteryChargeMW = renewableChargeMW;
      } else if (
        assumptions.gridChargingAllowed &&
        !assumptions.chargeOnlyFromRenewables &&
        signals.charge.has(localHour) &&
        dailyChargedMWh < dailyLimitMWh
      ) {
        gridChargeMW = Math.min(
          powerMW,
          sharedImportMW,
          Math.max(0, bess.gridImportMW),
          chargeHeadroomMW,
          dailyLimitMWh - dailyChargedMWh,
        );
        batteryChargeMW = gridChargeMW;
      } else if (signals.discharge.has(localHour) && dailyDischargedMWh < dailyLimitMWh) {
        let exportHeadroomMW = Math.max(0, sharedExportMW - directExportMW);
        if (!assumptions.exportAboveRenewableOutput) {
          exportHeadroomMW = Math.min(
            exportHeadroomMW,
            Math.max(0, renewable.total - directExportMW),
          );
        }
        const availableOutputMWh = Math.max(0, (socMWh - minSocMWh) * oneWayEfficiency);
        batteryDischargeMW = Math.min(
          powerMW,
          Math.max(0, bess.gridExportMW),
          exportHeadroomMW,
          availableOutputMWh,
          dailyLimitMWh - dailyDischargedMWh,
        );
      }

      if (batteryChargeMW > 0) {
        socMWh += batteryChargeMW * oneWayEfficiency;
        dailyChargedMWh += batteryChargeMW;
      } else if (batteryDischargeMW > 0) {
        socMWh -= batteryDischargeMW / oneWayEfficiency;
        dailyDischargedMWh += batteryDischargeMW;
      }
      socMWh = clamp(socMWh, minSocMWh, maxSocMWh);

      const exportedMWh = directExportMW + batteryDischargeMW;
      const remainingClippedMWh = Math.max(0, clippedMW - renewableChargeMW);
      directRenewableExportMWh += directExportMW;
      bessChargingFromRenewablesMWh += renewableChargeMW;
      bessChargingFromGridMWh += gridChargeMW;
      bessDischargeMWh += batteryDischargeMW;
      recoveredClippedEnergyMWh += renewableChargeMW;
      remainingCurtailmentMWh += remainingClippedMWh;
      gridImportMWh += gridChargeMW;
      gridExportMWh += exportedMWh;
      beforeStorageRevenue += directExportMW * pricePoint.priceEurPerMWh;

      let hourMerchantRevenue = 0;
      let hourPpaRevenue = 0;
      let hourBatteryRevenue = batteryDischargeMW * pricePoint.priceEurPerMWh;
      const gridChargeCost = gridChargeMW * pricePoint.priceEurPerMWh;
      if (assumptions.revenueStructure === "merchant") {
        hourMerchantRevenue = directExportMW * pricePoint.priceEurPerMWh;
        hourBatteryRevenue -= gridChargeCost;
      } else if (assumptions.revenueStructure === "renewable_ppa") {
        hourPpaRevenue = directExportMW * assumptions.ppaPriceEurPerMWh;
        hourBatteryRevenue -= gridChargeCost;
      } else if (assumptions.revenueStructure === "partial_ppa") {
        const merchantShare = clamp(assumptions.merchantSharePct, 0, 100) / 100;
        hourPpaRevenue = directExportMW * (1 - merchantShare) * assumptions.ppaPriceEurPerMWh;
        hourMerchantRevenue = directExportMW * merchantShare * pricePoint.priceEurPerMWh;
        if (assumptions.ppaVolumeEligibleForShifting && renewableChargeMW > 0) {
          hourPpaRevenue +=
            batteryDischargeMW * (1 - merchantShare) * assumptions.ppaPriceEurPerMWh;
          hourBatteryRevenue *= merchantShare;
        }
        hourBatteryRevenue -= gridChargeCost;
      } else if (assumptions.revenueStructure === "baseload_ppa") {
        const obligationMWh = Math.max(0, assumptions.baseloadObligationMW);
        hourPpaRevenue = obligationMWh * assumptions.ppaPriceEurPerMWh;
        hourMerchantRevenue = (directExportMW - obligationMWh) * pricePoint.priceEurPerMWh;
        hourBatteryRevenue -= gridChargeCost;
      } else {
        hourMerchantRevenue = directExportMW * pricePoint.priceEurPerMWh;
        hourBatteryRevenue = 0;
      }
      merchantRevenueEur += hourMerchantRevenue;
      ppaRevenueEur += hourPpaRevenue;
      batteryRevenueEur += hourBatteryRevenue;
      afterStorageRevenue += hourMerchantRevenue + hourPpaRevenue + hourBatteryRevenue;
      const month = new Date(pricePoint.ts).getUTCMonth();
      monthlyEnergyMWh[month].renewableExport += directExportMW;
      monthlyEnergyMWh[month].batteryCharge += batteryChargeMW;
      monthlyEnergyMWh[month].batteryDischarge += batteryDischargeMW;
      monthlyRevenueEur[month].value += hourMerchantRevenue + hourPpaRevenue + hourBatteryRevenue;
      dispatch.push({
        ts: pricePoint.ts,
        renewableMW: renewable.total,
        directExportMW,
        batteryChargeMW,
        batteryDischargeMW,
        gridImportMW: gridChargeMW,
        gridExportMW: exportedMWh,
        socMWh,
      });
    }
  }

  if (assumptions.revenueStructure === "battery_tolling") {
    batteryRevenueEur = Math.max(0, bess.tollingEurPerMWYear) * Math.max(0, bess.powerMW);
    afterStorageRevenue += batteryRevenueEur;
  }
  const ancillaryRevenueEur = Math.max(0, bess.ancillaryEurPerMWYear) * Math.max(0, bess.powerMW);
  batteryRevenueEur += ancillaryRevenueEur;
  afterStorageRevenue += ancillaryRevenueEur;

  const solarGenerationMWh = sum(renewableMWh.map((point) => point.solar));
  const windGenerationMWh = sum(renewableMWh.map((point) => point.wind));
  const totalRenewableGenerationMWh = solarGenerationMWh + windGenerationMWh;
  const solarCapex = hasSolar
    ? Math.max(0, assumptions.solar.capexEurPerKWp) *
      Math.max(0, assumptions.solar.capacityMWp) *
      1_000
    : 0;
  const windCapex = hasWind
    ? Math.max(0, assumptions.wind.capexEurPerKW) * Math.max(0, assumptions.wind.capacityMW) * 1_000
    : 0;
  const bessCapex =
    Math.max(0, bess.capexEurPerKW) * Math.max(0, bess.powerMW) * 1_000 +
    Math.max(0, bess.capexEurPerKWh) * Math.max(0, bess.energyMWh) * 1_000;
  const totalCapexEur = solarCapex + windCapex + bessCapex;
  const lifetimeYears = Math.max(1, Math.round(assumptions.lifetimeYears));
  const basePrice =
    sum(input.priceCurve.hourly.slice(0, n).map((point) => point.priceEurPerMWh)) /
      Math.max(1, n) || 1;
  const annualRevenueEur = Array.from({ length: lifetimeYears }, (_, yearIndex) => {
    const renewableDegradation = Math.pow(
      1 -
        Math.max(
          hasSolar ? clamp(assumptions.solar.degradationPct, 0, 100) : 0,
          hasWind ? clamp(assumptions.wind.degradationPct, 0, 100) : 0,
        ) /
          100,
      yearIndex,
    );
    const price = input.priceCurve.yearly[yearIndex]?.averageEurPerMWh ?? basePrice;
    const merchantAndBattery = (merchantRevenueEur + batteryRevenueEur) * (price / basePrice);
    return ppaRevenueEur * renewableDegradation + merchantAndBattery * renewableDegradation;
  });
  const annualGeneration = Array.from({ length: lifetimeYears }, (_, yearIndex) => {
    const degradation = Math.pow(0.995, yearIndex);
    return totalRenewableGenerationMWh * degradation + bessDischargeMWh;
  });
  const annualOpexEur = Array.from({ length: lifetimeYears }, (_, yearIndex) => {
    const fixedSolar = hasSolar
      ? Math.max(0, assumptions.solar.fixedOpexEurPerKWYear) *
        Math.max(0, assumptions.solar.capacityMWp) *
        1_000
      : 0;
    const fixedWind = hasWind
      ? Math.max(0, assumptions.wind.fixedOpexEurPerKWYear) *
        Math.max(0, assumptions.wind.capacityMW) *
        1_000
      : 0;
    const fixedBess = Math.max(0, bess.fixedOpexEurPerKWYear) * Math.max(0, bess.powerMW) * 1_000;
    const variable =
      solarGenerationMWh * (hasSolar ? Math.max(0, assumptions.solar.variableOpexEurPerMWh) : 0) +
      windGenerationMWh * (hasWind ? Math.max(0, assumptions.wind.variableOpexEurPerMWh) : 0) +
      bessDischargeMWh * Math.max(0, bess.variableThroughputEurPerMWh);
    const augmentation =
      bess.augmentationYear > 0 && yearIndex + 1 === Math.round(bess.augmentationYear)
        ? bessCapex * (clamp(bess.augmentationCostPct, 0, 100) / 100)
        : 0;
    return fixedSolar + fixedWind + fixedBess + variable + augmentation;
  });
  const financial = calculateFinancialResults({
    totalCapexEur,
    annualRevenueEur,
    annualOpexEur,
    annualGenerationMWh: annualGeneration,
    financing: assumptions,
  });
  const captureBefore =
    directRenewableExportMWh > 0 ? beforeStorageRevenue / directRenewableExportMWh : null;
  const captureAfter = gridExportMWh > 0 ? afterStorageRevenue / gridExportMWh : null;

  return {
    ...financial,
    solarGenerationMWh,
    windGenerationMWh,
    totalRenewableGenerationMWh,
    directRenewableExportMWh,
    bessChargingFromRenewablesMWh,
    bessChargingFromGridMWh,
    bessDischargeMWh,
    recoveredClippedEnergyMWh,
    remainingCurtailmentMWh,
    gridImportMWh,
    gridExportMWh,
    renewableChargingShare:
      bessChargingFromRenewablesMWh + bessChargingFromGridMWh > 0
        ? bessChargingFromRenewablesMWh / (bessChargingFromRenewablesMWh + bessChargingFromGridMWh)
        : null,
    capturePriceBeforeStorageEurPerMWh: captureBefore,
    capturePriceAfterStorageEurPerMWh: captureAfter,
    capturePriceUpliftEurPerMWh:
      captureBefore != null && captureAfter != null ? captureAfter - captureBefore : null,
    merchantRevenueEur,
    ppaRevenueEur,
    batteryRevenueEur,
    monthlyEnergyMWh,
    monthlyRevenueEur,
    dispatch,
  };
}
