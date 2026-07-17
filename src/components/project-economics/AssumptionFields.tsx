import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLang } from "@/lib/i18n";
import type {
  BessAssumptions,
  FinancingAssumptions,
  HybridAssumptions,
  RenewableRevenueStructure,
  SolarAssumptions,
  WindAssumptions,
} from "@/lib/project-economics/types";

type NumericRow<T> = {
  key: keyof T;
  label: string;
  unit: string;
  min?: number;
  max?: number;
};

export function FieldGroup({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t border-border/60 pt-4 first:border-0 first:pt-0">
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function NumberField({
  label,
  value,
  unit,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(118px,150px)] items-center gap-3">
      <Label className="text-xs leading-snug">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step="any"
          className="pr-16 text-right"
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-xs leading-snug">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumericFields<T extends object>({
  value,
  rows,
  patch,
}: {
  value: T;
  rows: NumericRow<T>[];
  patch: (next: Partial<T>) => void;
}) {
  return rows.map((row) => (
    <NumberField
      key={String(row.key)}
      label={row.label}
      value={Number(value[row.key])}
      unit={row.unit}
      min={row.min}
      max={row.max}
      onChange={(next) => patch({ [row.key]: next } as Partial<T>)}
    />
  ));
}

export function FinancingFields<T extends FinancingAssumptions>({
  value,
  onChange,
}: {
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useLang();
  const patch = (next: Partial<T>) => onChange({ ...value, ...next });
  return (
    <FieldGroup title={t("Financing", "Finansiranje")}>
      <NumericFields
        value={value}
        patch={patch}
        rows={[
          {
            key: "discountRatePct",
            label: t("Discount rate", "Diskontna stopa"),
            unit: "%",
            min: 0,
            max: 100,
          },
          { key: "debtSharePct", label: t("Debt share", "Udeo duga"), unit: "%", min: 0, max: 100 },
          {
            key: "interestRatePct",
            label: t("Interest rate", "Kamatna stopa"),
            unit: "%",
            min: 0,
            max: 100,
          },
          {
            key: "loanTenorYears",
            label: t("Loan tenor", "Rok otplate"),
            unit: t("years", "god."),
            min: 0,
          },
        ]}
      />
    </FieldGroup>
  );
}

const renewableOptions = (t: (en: string, sr: string) => string) => [
  { value: "merchant", label: t("Merchant", "Merchant") },
  { value: "fixed", label: t("Fixed PPA", "Fiksni PPA") },
  { value: "pay_as_produced", label: t("Pay-as-produced PPA", "Pay-as-produced PPA") },
  { value: "baseload", label: t("Baseload PPA", "Baseload PPA") },
  { value: "hybrid", label: t("Hybrid PPA plus merchant", "Hibridni PPA plus merchant") },
];

function RenewableCommercial<T extends SolarAssumptions | WindAssumptions>({
  value,
  onChange,
}: {
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useLang();
  const patch = (next: Partial<T>) => onChange({ ...value, ...next });
  return (
    <FieldGroup title={t("Revenue structure", "Struktura prihoda")}>
      <SelectField
        label={t("Commercial structure", "Komercijalna struktura")}
        value={value.revenueStructure}
        options={renewableOptions(t)}
        onChange={(revenueStructure) =>
          patch({ revenueStructure: revenueStructure as RenewableRevenueStructure } as Partial<T>)
        }
      />
      <NumericFields
        value={value}
        patch={patch}
        rows={[
          { key: "ppaPriceEurPerMWh", label: t("PPA price", "PPA cena"), unit: "EUR/MWh" },
          {
            key: "merchantSharePct",
            label: t("Merchant share", "Merchant udeo"),
            unit: "%",
            min: 0,
            max: 100,
          },
        ]}
      />
    </FieldGroup>
  );
}

function NegativePriceFields<T extends SolarAssumptions | WindAssumptions>({
  value,
  onChange,
}: {
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useLang();
  return (
    <FieldGroup title={t("Negative-price rule", "Pravilo negativnih cena")}>
      <SelectField
        label={t("Dispatch rule", "Pravilo rada")}
        value={value.negativePriceRule}
        options={[
          { value: "always", label: t("Always produce", "Uvek proizvodi") },
          { value: "curtail_negative", label: t("Curtail below zero", "Ogranicenje ispod nule") },
          {
            value: "curtail_threshold",
            label: t("Curtail below threshold", "Ogranicenje ispod praga"),
          },
        ]}
        onChange={(negativePriceRule) => onChange({ ...value, negativePriceRule } as T)}
      />
      <NumberField
        label={t("Curtailment threshold", "Prag ogranicenja")}
        value={value.curtailThresholdEurPerMWh}
        unit="EUR/MWh"
        onChange={(curtailThresholdEurPerMWh) => onChange({ ...value, curtailThresholdEurPerMWh })}
      />
    </FieldGroup>
  );
}

export function SolarFields({
  value,
  onChange,
}: {
  value: SolarAssumptions;
  onChange: (value: SolarAssumptions) => void;
}) {
  const { t } = useLang();
  const patch = (next: Partial<SolarAssumptions>) => onChange({ ...value, ...next });
  return (
    <>
      <TextField
        label={t("Project name", "Naziv projekta")}
        value={value.projectName}
        onChange={(projectName) => patch({ projectName })}
      />
      <FieldGroup title={t("Solar plant", "Solarna elektrana")}>
        <NumericFields
          value={value}
          patch={patch}
          rows={[
            {
              key: "capacityMWp",
              label: t("Installed DC capacity", "Instalisana DC snaga"),
              unit: "MWp",
              min: 0,
            },
            {
              key: "gridMWac",
              label: t("Grid connection", "Prikljucna snaga"),
              unit: "MWac",
              min: 0,
            },
            { key: "capexEurPerKWp", label: "CAPEX", unit: "EUR/kWp", min: 0 },
            {
              key: "fixedOpexEurPerKWYear",
              label: t("Fixed OPEX", "Fiksni OPEX"),
              unit: "EUR/kW/yr",
              min: 0,
            },
            {
              key: "variableOpexEurPerMWh",
              label: t("Variable OPEX", "Varijabilni OPEX"),
              unit: "EUR/MWh",
              min: 0,
            },
            {
              key: "degradationPct",
              label: t("Degradation", "Degradacija"),
              unit: "%/yr",
              min: 0,
              max: 100,
            },
            {
              key: "curtailmentPct",
              label: t("Curtailment", "Ogranicenje"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "lifetimeYears",
              label: t("Project lifetime", "Vek projekta"),
              unit: t("years", "god."),
              min: 1,
            },
          ]}
        />
        <NumberField
          label={t("DC/AC ratio", "DC/AC odnos")}
          value={value.gridMWac > 0 ? value.capacityMWp / value.gridMWac : 0}
          unit="x"
          min={0}
          onChange={(ratio) =>
            patch({ capacityMWp: Math.max(0, ratio) * Math.max(0, value.gridMWac) })
          }
        />
      </FieldGroup>
      <RenewableCommercial value={value} onChange={onChange} />
      <NegativePriceFields value={value} onChange={onChange} />
      <FinancingFields value={value} onChange={onChange} />
    </>
  );
}

export function WindFields({
  value,
  onChange,
}: {
  value: WindAssumptions;
  onChange: (value: WindAssumptions) => void;
}) {
  const { t } = useLang();
  const patch = (next: Partial<WindAssumptions>) => onChange({ ...value, ...next });
  return (
    <>
      <TextField
        label={t("Project name", "Naziv projekta")}
        value={value.projectName}
        onChange={(projectName) => patch({ projectName })}
      />
      <FieldGroup title={t("Wind plant", "Vetroelektrana")}>
        <NumericFields
          value={value}
          patch={patch}
          rows={[
            {
              key: "capacityMW",
              label: t("Installed capacity", "Instalisana snaga"),
              unit: "MW",
              min: 0,
            },
            { key: "gridMW", label: t("Grid connection", "Prikljucna snaga"), unit: "MW", min: 0 },
            {
              key: "netCapacityFactorPct",
              label: t("Expected net capacity factor", "Ocekivani neto CF"),
              unit: "%",
              min: 0,
              max: 100,
            },
            { key: "capexEurPerKW", label: "CAPEX", unit: "EUR/kW", min: 0 },
            {
              key: "fixedOpexEurPerKWYear",
              label: t("Fixed OPEX", "Fiksni OPEX"),
              unit: "EUR/kW/yr",
              min: 0,
            },
            {
              key: "variableOpexEurPerMWh",
              label: t("Variable OPEX", "Varijabilni OPEX"),
              unit: "EUR/MWh",
              min: 0,
            },
            {
              key: "availabilityPct",
              label: t("Availability", "Raspolozivost"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "wakeElectricalLossPct",
              label: t("Wake/electrical losses", "Wake/elektricni gubici"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "degradationPct",
              label: t("Degradation", "Degradacija"),
              unit: "%/yr",
              min: 0,
              max: 100,
            },
            {
              key: "curtailmentPct",
              label: t("Curtailment", "Ogranicenje"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "lifetimeYears",
              label: t("Project lifetime", "Vek projekta"),
              unit: t("years", "god."),
              min: 1,
            },
          ]}
        />
      </FieldGroup>
      <RenewableCommercial value={value} onChange={onChange} />
      <NegativePriceFields value={value} onChange={onChange} />
      <FinancingFields value={value} onChange={onChange} />
    </>
  );
}

export function BessFields({
  value,
  onChange,
}: {
  value: BessAssumptions;
  onChange: (value: BessAssumptions) => void;
}) {
  const { t } = useLang();
  const patch = (next: Partial<BessAssumptions>) => onChange({ ...value, ...next });
  return (
    <>
      <TextField
        label={t("Project name", "Naziv projekta")}
        value={value.projectName}
        onChange={(projectName) => patch({ projectName })}
      />
      <FieldGroup title={t("Battery system", "Baterijski sistem")}>
        <NumericFields
          value={value}
          patch={patch}
          rows={[
            {
              key: "powerMW",
              label: t("Charge/discharge power", "Snaga punjenja/praznjenja"),
              unit: "MW",
              min: 0,
            },
            {
              key: "energyMWh",
              label: t("Usable energy capacity", "Korisni energetski kapacitet"),
              unit: "MWh",
              min: 0,
            },
            {
              key: "gridImportMW",
              label: t("Grid import limit", "Limit uvoza"),
              unit: "MW",
              min: 0,
            },
            {
              key: "gridExportMW",
              label: t("Grid export limit", "Limit izvoza"),
              unit: "MW",
              min: 0,
            },
            {
              key: "minSocPct",
              label: t("Minimum SOC", "Minimalni SOC"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "maxSocPct",
              label: t("Maximum SOC", "Maksimalni SOC"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "roundTripEfficiencyPct",
              label: t("Round-trip efficiency", "Round-trip efikasnost"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "availabilityPct",
              label: t("Availability", "Raspolozivost"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "maxCyclesPerDay",
              label: t("Maximum equivalent cycles", "Maksimalni ciklusi"),
              unit: "cycles/day",
              min: 0,
            },
            {
              key: "annualCapacityDegradationPct",
              label: t("Capacity degradation", "Degradacija kapaciteta"),
              unit: "%/yr",
              min: 0,
              max: 100,
            },
            {
              key: "capexEurPerKW",
              label: t("Power CAPEX", "CAPEX snage"),
              unit: "EUR/kW",
              min: 0,
            },
            {
              key: "capexEurPerKWh",
              label: t("Energy CAPEX", "CAPEX energije"),
              unit: "EUR/kWh",
              min: 0,
            },
            {
              key: "fixedOpexEurPerKWYear",
              label: t("Fixed OPEX", "Fiksni OPEX"),
              unit: "EUR/kW/yr",
              min: 0,
            },
            {
              key: "variableThroughputEurPerMWh",
              label: t("Variable throughput cost", "Trosak protoka"),
              unit: "EUR/MWh",
              min: 0,
            },
            {
              key: "augmentationYear",
              label: t("Augmentation year", "Godina augmentacije"),
              unit: t("year", "god."),
              min: 0,
            },
            {
              key: "augmentationCostPct",
              label: t("Augmentation cost", "Trosak augmentacije"),
              unit: "% CAPEX",
              min: 0,
            },
            {
              key: "lifetimeYears",
              label: t("Project lifetime", "Vek projekta"),
              unit: t("years", "god."),
              min: 1,
            },
          ]}
        />
        <NumberField
          label={t("Duration", "Trajanje")}
          value={value.powerMW > 0 ? value.energyMWh / value.powerMW : 0}
          unit="h"
          min={0}
          onChange={(duration) =>
            patch({ energyMWh: Math.max(0, duration) * Math.max(0, value.powerMW) })
          }
        />
      </FieldGroup>
      <FieldGroup title={t("Revenue structure", "Struktura prihoda")}>
        <SelectField
          label={t("Commercial structure", "Komercijalna struktura")}
          value={value.revenueStructure}
          options={[
            { value: "merchant", label: t("Merchant arbitrage", "Merchant arbitraza") },
            {
              value: "tolling",
              label: t("Fixed tolling / availability", "Fiksni tolling / raspolozivost"),
            },
            { value: "hybrid", label: t("Hybrid tolling plus merchant", "Tolling plus merchant") },
          ]}
          onChange={(revenueStructure) =>
            patch({ revenueStructure: revenueStructure as BessAssumptions["revenueStructure"] })
          }
        />
        <NumericFields
          value={value}
          patch={patch}
          rows={[
            {
              key: "tollingEurPerMWYear",
              label: t("Tolling payment", "Tolling naknada"),
              unit: "EUR/MW/yr",
              min: 0,
            },
            {
              key: "tollingSharePct",
              label: t("Tolling share", "Tolling udeo"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "ancillaryEurPerMWYear",
              label: t(
                "Manual ancillary-services assumption",
                "Rucna pretpostavka pomocnih usluga",
              ),
              unit: "EUR/MW/yr",
              min: 0,
            },
          ]}
        />
      </FieldGroup>
      <FinancingFields value={value} onChange={onChange} />
    </>
  );
}

export function HybridFields({
  value,
  onChange,
}: {
  value: HybridAssumptions;
  onChange: (value: HybridAssumptions) => void;
}) {
  const { t } = useLang();
  const patch = (next: Partial<HybridAssumptions>) => onChange({ ...value, ...next });
  return (
    <>
      <TextField
        label={t("Project name", "Naziv projekta")}
        value={value.projectName}
        onChange={(projectName) => patch({ projectName })}
      />
      <FieldGroup title={t("Hybrid configuration", "Hibridna konfiguracija")}>
        <SelectField
          label={t("Components", "Komponente")}
          value={value.components}
          options={[
            { value: "solar_bess", label: "Solar + BESS" },
            { value: "wind_bess", label: "Wind + BESS" },
            { value: "solar_wind_bess", label: "Solar + Wind + BESS" },
          ]}
          onChange={(components) =>
            patch({ components: components as HybridAssumptions["components"] })
          }
        />
        <NumericFields
          value={value}
          patch={patch}
          rows={[
            {
              key: "sharedGridExportMW",
              label: t("Shared grid export limit", "Zajednicki limit izvoza"),
              unit: "MW",
              min: 0,
            },
            {
              key: "sharedGridImportMW",
              label: t("Shared grid import limit", "Zajednicki limit uvoza"),
              unit: "MW",
              min: 0,
            },
            {
              key: "lifetimeYears",
              label: t("Project lifetime", "Vek projekta"),
              unit: t("years", "god."),
              min: 1,
            },
          ]}
        />
      </FieldGroup>
      <FieldGroup title={t("Component sizing", "Dimenzionisanje komponenti")}>
        <NumberField
          label={t("Solar capacity", "Snaga solara")}
          value={value.solar.capacityMWp}
          unit="MWp"
          min={0}
          onChange={(capacityMWp) => patch({ solar: { ...value.solar, capacityMWp } })}
        />
        <NumberField
          label={t("Solar CAPEX", "CAPEX solara")}
          value={value.solar.capexEurPerKWp}
          unit="EUR/kWp"
          min={0}
          onChange={(capexEurPerKWp) => patch({ solar: { ...value.solar, capexEurPerKWp } })}
        />
        <NumberField
          label={t("Wind capacity", "Snaga vetra")}
          value={value.wind.capacityMW}
          unit="MW"
          min={0}
          onChange={(capacityMW) => patch({ wind: { ...value.wind, capacityMW } })}
        />
        <NumberField
          label={t("Wind net capacity factor", "Neto CF vetra")}
          value={value.wind.netCapacityFactorPct}
          unit="%"
          min={0}
          max={100}
          onChange={(netCapacityFactorPct) =>
            patch({ wind: { ...value.wind, netCapacityFactorPct } })
          }
        />
        <NumberField
          label={t("Wind CAPEX", "CAPEX vetra")}
          value={value.wind.capexEurPerKW}
          unit="EUR/kW"
          min={0}
          onChange={(capexEurPerKW) => patch({ wind: { ...value.wind, capexEurPerKW } })}
        />
        <NumberField
          label={t("BESS power", "BESS snaga")}
          value={value.bess.powerMW}
          unit="MW"
          min={0}
          onChange={(powerMW) => patch({ bess: { ...value.bess, powerMW } })}
        />
        <NumberField
          label={t("BESS energy", "BESS energija")}
          value={value.bess.energyMWh}
          unit="MWh"
          min={0}
          onChange={(energyMWh) => patch({ bess: { ...value.bess, energyMWh } })}
        />
        <NumberField
          label={t("BESS round-trip efficiency", "BESS round-trip efikasnost")}
          value={value.bess.roundTripEfficiencyPct}
          unit="%"
          min={0}
          max={100}
          onChange={(roundTripEfficiencyPct) =>
            patch({ bess: { ...value.bess, roundTripEfficiencyPct } })
          }
        />
      </FieldGroup>
      <FieldGroup title={t("Dispatch priorities", "Prioriteti dispeciranja")}>
        <ToggleField
          label={t("Grid charging allowed", "Punjenje iz mreze dozvoljeno")}
          checked={value.gridChargingAllowed}
          onChange={(gridChargingAllowed) => patch({ gridChargingAllowed })}
        />
        <ToggleField
          label={t("Charge only from renewables", "Punjenje samo iz OIE")}
          checked={value.chargeOnlyFromRenewables}
          onChange={(chargeOnlyFromRenewables) => patch({ chargeOnlyFromRenewables })}
        />
        <ToggleField
          label={t("PPA volume eligible for shifting", "PPA kolicina podobna za pomeranje")}
          checked={value.ppaVolumeEligibleForShifting}
          onChange={(ppaVolumeEligibleForShifting) => patch({ ppaVolumeEligibleForShifting })}
        />
        <ToggleField
          label={t("Allow export above renewable output", "Izvoz iznad OIE proizvodnje")}
          checked={value.exportAboveRenewableOutput}
          onChange={(exportAboveRenewableOutput) => patch({ exportAboveRenewableOutput })}
        />
        <ToggleField
          label={t("Recover clipped energy", "Povrati odsecenu energiju")}
          checked={value.curtailmentRecovery}
          onChange={(curtailmentRecovery) => patch({ curtailmentRecovery })}
        />
      </FieldGroup>
      <FieldGroup title={t("Revenue structure", "Struktura prihoda")}>
        <SelectField
          label={t("Commercial structure", "Komercijalna struktura")}
          value={value.revenueStructure}
          options={[
            { value: "merchant", label: t("Full merchant", "Potpuni merchant") },
            {
              value: "renewable_ppa",
              label: t(
                "Renewable pay-as-produced PPA plus merchant BESS",
                "OIE PAP PPA plus merchant BESS",
              ),
            },
            {
              value: "partial_ppa",
              label: t("Partial PPA plus merchant", "Delimicni PPA plus merchant"),
            },
            {
              value: "baseload_ppa",
              label: t(
                "Baseload PPA with merchant deviations",
                "Baseload PPA sa merchant odstupanjima",
              ),
            },
            {
              value: "battery_tolling",
              label: t(
                "Battery tolling plus merchant renewables",
                "BESS tolling plus merchant OIE",
              ),
            },
          ]}
          onChange={(revenueStructure) =>
            patch({ revenueStructure: revenueStructure as HybridAssumptions["revenueStructure"] })
          }
        />
        <NumericFields
          value={value}
          patch={patch}
          rows={[
            { key: "ppaPriceEurPerMWh", label: t("PPA price", "PPA cena"), unit: "EUR/MWh" },
            {
              key: "merchantSharePct",
              label: t("Merchant share", "Merchant udeo"),
              unit: "%",
              min: 0,
              max: 100,
            },
            {
              key: "baseloadObligationMW",
              label: t("Baseload obligation", "Baseload obaveza"),
              unit: "MW",
              min: 0,
            },
          ]}
        />
      </FieldGroup>
      <FinancingFields value={value} onChange={onChange} />
    </>
  );
}
