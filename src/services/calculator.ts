import type {
  MeteringMode,
  MeterOwner,
  PhaseType,
  ProsumerCalculationResult,
  TariffTables,
  TodAdjustmentMode,
  ZoneAdjustmentBreakdown,
  ZoneKey,
} from '../types';
import { SHORT_MONTHS } from './tariffFetcher';

export interface CalculationInputs {
  billingMonth: string; // 'YYYY-MM'
  meteringMode?: MeteringMode;
  phaseType: PhaseType;
  meterOwner: MeterOwner;
  previousBank: number;
  todAdjustmentMode: TodAdjustmentMode;
  allowNegativeOwnConsumption?: boolean;
  importUnits: Record<ZoneKey, number>;
  exportUnits: Record<ZoneKey, number>;
  solarGenUnits: Record<ZoneKey, number>;
  dutyOverride?: number | null;
  surchargeOverride?: number | null;
}

export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function getFixedCharge(
  tables: TariffTables,
  phaseType: PhaseType,
  totalUnits: number
): { value: number; label: string } {
  for (const row of tables.fixedCharges) {
    if (totalUnits >= row.min && totalUnits <= row.max) {
      return {
        value: phaseType === 'three' ? row.three : row.single,
        label: row.label,
      };
    }
  }
  return { value: 0, label: 'Not found' };
}

export function getMeterRent(
  tables: TariffTables,
  phaseType: PhaseType,
  customerType: 'LT1_Prosumer' | 'Consumer',
  meterOwner: MeterOwner
): number {
  if (customerType === 'LT1_Prosumer' && meterOwner === 'prosumer') {
    return 0;
  }
  const normalizedTarget = customerType.toLowerCase();
  for (const row of tables.meterCharges) {
    if (row.label.replace(/\s+/g, '_').toLowerCase() === normalizedTarget) {
      return phaseType === 'three' ? row.three : row.single;
    }
  }
  return 0;
}

export function lookupOtherCharges(
  tables: TariffTables,
  billingMonth: string
): { duty: number; surcharge: number; fallbackUsed: boolean } {
  const [yearStr, monthStr] = billingMonth.split('-');
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStr, 10) - 1;
  const shortMonth = SHORT_MONTHS[monthIdx] ?? '';

  const exactRow = tables.otherCharges.find(
    (r) =>
      r.label.toUpperCase() === 'LT1' &&
      r.year === year &&
      r.month.toLowerCase() === shortMonth.toLowerCase()
  );

  const latestValidSurcharge = [...tables.otherCharges]
    .reverse()
    .find((r) => r.label.toUpperCase() === 'LT1' && r.surcharge !== null);

  if (exactRow) {
    if (exactRow.surcharge !== null) {
      return { duty: exactRow.duty, surcharge: exactRow.surcharge, fallbackUsed: false };
    }
    return {
      duty: exactRow.duty,
      surcharge: latestValidSurcharge?.surcharge ?? 0,
      fallbackUsed: true,
    };
  }

  return {
    duty: latestValidSurcharge?.duty ?? 10,
    surcharge: latestValidSurcharge?.surcharge ?? 0,
    fallbackUsed: true,
  };
}

export function calculateDomesticTelescopicCharge(
  tables: TariffTables,
  units: number
): { charge: number; breakdownLines: string[] } {
  let remaining = Math.max(0, units);
  let total = 0;
  let prevLimit = 0;
  const breakdownLines: string[] = [];

  for (const slab of tables.domesticTelescopic) {
    if (remaining <= 0) break;
    const slabUnits = Math.min(remaining, slab.limit - prevLimit);
    const slabCost = slabUnits * slab.rate;
    total += slabCost;
    breakdownLines.push(
      `${slabUnits.toFixed(0)} units × ₹${slab.rate.toFixed(2)} = ₹${slabCost.toFixed(2)}`
    );
    remaining -= slabUnits;
    prevLimit = slab.limit;
  }

  if (breakdownLines.length === 0) {
    breakdownLines.push('0 units billed');
  }

  return { charge: total, breakdownLines };
}

export function getTodBaseRate(tables: TariffTables, totalUnits: number): number {
  for (const row of tables.todBaseRates) {
    if (totalUnits <= row.upper) {
      return row.base;
    }
  }
  const last = tables.todBaseRates[tables.todBaseRates.length - 1];
  return last ? last.base : 9.2;
}

export function getDomesticNonTelescopicRate(tables: TariffTables, totalUnits: number): number {
  for (const row of tables.domesticNonTelescopic) {
    if (totalUnits <= row.upper) {
      return row.rate;
    }
  }
  const last = tables.domesticNonTelescopic[tables.domesticNonTelescopic.length - 1];
  return last ? last.rate : 9.2;
}

function calculateDomesticNonTelescopicCharge(
  tables: TariffTables,
  units: number
): { charge: number; rate: number; breakdownLines: string[] } {
  const rate = getDomesticNonTelescopicRate(tables, units);
  const charge = round2(units * rate);
  return {
    charge,
    rate,
    breakdownLines: [
      `Non-Telescopic (Cumulative): ${units.toFixed(0)} units × ₹${rate.toFixed(2)} = ₹${charge.toFixed(2)}`,
    ],
  };
}

/**
 * Zone-wise export & bank adjustment:
 * - 'anwarbio': Same-zone first, then surplus export & bank offset in NL -> OP -> PK order
 *   (matches anwarbio/kseb-bill-calculator getNetImportTOD)
 * - 'kseb': Same-zone first, then surplus export & bank offset in PK -> NL -> OP order
 *   (matches KSEB OrumaNET Consumption Adjustment Report priority)
 */
export function adjustTodZones(
  importUnits: Record<ZoneKey, number>,
  exportUnits: Record<ZoneKey, number>,
  previousBank: number,
  mode: TodAdjustmentMode
): ZoneAdjustmentBreakdown {
  const actualImport: Record<ZoneKey, number> = {
    NL: Math.max(0, importUnits.NL - exportUnits.NL),
    OP: Math.max(0, importUnits.OP - exportUnits.OP),
    PK: Math.max(0, importUnits.PK - exportUnits.PK),
  };

  const extraExport: Record<ZoneKey, number> = {
    NL: Math.max(0, exportUnits.NL - importUnits.NL),
    OP: Math.max(0, exportUnits.OP - importUnits.OP),
    PK: Math.max(0, exportUnits.PK - importUnits.PK),
  };

  let remainingExport = extraExport.NL + extraExport.OP + extraExport.PK;

  const order: ZoneKey[] = mode === 'kseb' ? ['PK', 'NL', 'OP'] : ['NL', 'OP', 'PK'];

  const netImportAfterExport: Record<ZoneKey, number> = { ...actualImport };
  for (const zone of order) {
    if (remainingExport <= 0) break;
    const used = Math.min(netImportAfterExport[zone], remainingExport);
    netImportAfterExport[zone] -= used;
    remainingExport -= used;
  }

  const adjustedImportAfterBank: Record<ZoneKey, number> = { ...netImportAfterExport };
  let currentBank = Math.max(0, previousBank);
  for (const zone of order) {
    if (currentBank <= 0) break;
    const used = Math.min(adjustedImportAfterBank[zone], currentBank);
    adjustedImportAfterBank[zone] -= used;
    currentBank -= used;
  }

  if (remainingExport > 0) {
    currentBank += remainingExport;
  }

  return {
    actualImport,
    netImportAfterExport,
    adjustedImportAfterBank,
    updatedBank: currentBank,
  };
}

function calculateTodEnergy(
  tables: TariffTables,
  zones: { nl: number; op: number; pk: number },
  totalNetUnits: number,
  thresholdUnits: number
): {
  charge: number;
  baseRate: number;
  appliedRates: { nl: number; op: number; pk: number };
  breakdownLines: string[];
} {
  const appliedRates =
    totalNetUnits <= thresholdUnits
      ? { nl: 1, op: 1, pk: 1 }
      : { ...tables.todMultipliers };

  const baseRate = getTodBaseRate(tables, totalNetUnits);
  const chargeNL = zones.nl * baseRate * appliedRates.nl;
  const chargeOP = zones.op * baseRate * appliedRates.op;
  const chargePK = zones.pk * baseRate * appliedRates.pk;
  const charge = chargeNL + chargeOP + chargePK;

  const breakdownLines: string[] = [];
  if (zones.nl > 0) {
    breakdownLines.push(
      `NL: ${zones.nl} × ₹${baseRate.toFixed(2)} × ${appliedRates.nl} = ₹${chargeNL.toFixed(2)}`
    );
  }
  if (zones.op > 0) {
    breakdownLines.push(
      `OP: ${zones.op} × ₹${baseRate.toFixed(2)} × ${appliedRates.op} = ₹${chargeOP.toFixed(2)}`
    );
  }
  if (zones.pk > 0) {
    breakdownLines.push(
      `PK: ${zones.pk} × ₹${baseRate.toFixed(2)} × ${appliedRates.pk} = ₹${chargePK.toFixed(2)}`
    );
  }
  if (breakdownLines.length === 0) {
    breakdownLines.push('0 units billed');
  }

  return { charge, baseRate, appliedRates, breakdownLines };
}

export function calculateProsumerBill(
  tables: TariffTables,
  inputs: CalculationInputs
): ProsumerCalculationResult {
  const meteringMode: MeteringMode = inputs.meteringMode ?? 'tod';
  const importUnits = inputs.importUnits.NL + inputs.importUnits.OP + inputs.importUnits.PK;
  const exportUnits = inputs.exportUnits.NL + inputs.exportUnits.OP + inputs.exportUnits.PK;
  const solarGenerated =
    inputs.solarGenUnits.NL + inputs.solarGenUnits.OP + inputs.solarGenUnits.PK;
  const rawOwnConsumption = solarGenerated - exportUnits;
  const ownConsumption = inputs.allowNegativeOwnConsumption
    ? rawOwnConsumption
    : Math.max(0, rawOwnConsumption);
  const totalUnitsForFixed = Math.max(0, importUnits + ownConsumption);

  const prevBank = Math.max(0, inputs.previousBank);
  const zoneBreakdown: ZoneAdjustmentBreakdown =
    meteringMode === 'cumulative'
      ? {
          actualImport: { NL: Math.max(0, importUnits - exportUnits), OP: 0, PK: 0 },
          netImportAfterExport: { NL: Math.max(0, importUnits - exportUnits), OP: 0, PK: 0 },
          adjustedImportAfterBank: {
            NL: Math.max(0, importUnits - exportUnits - prevBank),
            OP: 0,
            PK: 0,
          },
          updatedBank: Math.max(0, prevBank + exportUnits - importUnits),
        }
      : adjustTodZones(
          inputs.importUnits,
          inputs.exportUnits,
          inputs.previousBank,
          inputs.todAdjustmentMode
        );

  const netImportBeforeBank =
    zoneBreakdown.netImportAfterExport.NL +
    zoneBreakdown.netImportAfterExport.OP +
    zoneBreakdown.netImportAfterExport.PK;

  const billedUnits =
    zoneBreakdown.adjustedImportAfterBank.NL +
    zoneBreakdown.adjustedImportAfterBank.OP +
    zoneBreakdown.adjustedImportAfterBank.PK;

  const netExport = Math.max(0, exportUnits - importUnits);

  const fixedInfo = getFixedCharge(tables, inputs.phaseType, totalUnitsForFixed);
  const meterCharge = getMeterRent(tables, inputs.phaseType, 'LT1_Prosumer', inputs.meterOwner);

  const otherCharges = lookupOtherCharges(tables, inputs.billingMonth);
  const dutyPercent =
    inputs.dutyOverride !== undefined && inputs.dutyOverride !== null
      ? inputs.dutyOverride
      : otherCharges.duty;
  const surchargeRate =
    inputs.surchargeOverride !== undefined && inputs.surchargeOverride !== null
      ? inputs.surchargeOverride
      : otherCharges.surcharge;
  const surchargeFallbackUsed =
    (inputs.surchargeOverride === undefined || inputs.surchargeOverride === null) &&
    otherCharges.fallbackUsed;

  const nonTelStart = tables.constants.nonTelStartUnit;
  const isTelescopic = billedUnits <= nonTelStart;
  const prosumerBillingMethod: ProsumerCalculationResult['billingMethod'] = isTelescopic
    ? 'telescopic'
    : meteringMode === 'cumulative'
      ? 'non-telescopic'
      : 'non-telescopic-tod';

  let energyCharge = 0;
  let energyBreakdownLines: string[] = [];
  let todBaseRate: number | null = null;
  let todRatesApplied = { nl: 1, op: 1, pk: 1 };

  if (isTelescopic) {
    const tel = calculateDomesticTelescopicCharge(tables, billedUnits);
    energyCharge = tel.charge;
    energyBreakdownLines = tel.breakdownLines;
  } else if (meteringMode === 'cumulative') {
    const nonTel = calculateDomesticNonTelescopicCharge(tables, billedUnits);
    energyCharge = nonTel.charge;
    energyBreakdownLines = nonTel.breakdownLines;
  } else {
    const tod = calculateTodEnergy(
      tables,
      {
        nl: zoneBreakdown.adjustedImportAfterBank.NL,
        op: zoneBreakdown.adjustedImportAfterBank.OP,
        pk: zoneBreakdown.adjustedImportAfterBank.PK,
      },
      billedUnits,
      tables.constants.prosTodStartUnit
    );
    energyCharge = tod.charge;
    energyBreakdownLines = tod.breakdownLines;
    todBaseRate = tod.baseRate;
    todRatesApplied = tod.appliedRates;
  }

  const dutyAmount = round2((energyCharge * dutyPercent) / 100);
  const surchargeAmount = round2(surchargeRate * billedUnits);
  const unroundedTotal = round2(
    energyCharge + fixedInfo.value + meterCharge + dutyAmount + surchargeAmount
  );
  const roundedTotal = Math.round(unroundedTotal);
  const roundOff = round2(roundedTotal - unroundedTotal);

  // Consumer Equivalent Comparison (mirrors anwarbio consumer section)
  const consumerUnits = totalUnitsForFixed;
  const consumerTelescopic = consumerUnits <= nonTelStart;
  const consumerBillingMethod: ProsumerCalculationResult['billingMethod'] = consumerTelescopic
    ? 'telescopic'
    : meteringMode === 'cumulative'
      ? 'non-telescopic'
      : 'non-telescopic-tod';
  const consumerFixed = fixedInfo.value;
  const consumerMeter = getMeterRent(tables, inputs.phaseType, 'Consumer', 'kseb');
  let consumerEnergy = 0;
  if (consumerTelescopic) {
    consumerEnergy = calculateDomesticTelescopicCharge(tables, consumerUnits).charge;
  } else if (meteringMode === 'cumulative') {
    consumerEnergy = calculateDomesticNonTelescopicCharge(tables, consumerUnits).charge;
  } else {
    consumerEnergy = calculateTodEnergy(
      tables,
      {
        nl: Math.max(0, inputs.importUnits.NL + ownConsumption),
        op: inputs.importUnits.OP,
        pk: inputs.importUnits.PK,
      },
      consumerUnits,
      tables.constants.conTodStartUnit
    ).charge;
  }
  const consumerDuty = round2((consumerEnergy * dutyPercent) / 100);
  const consumerSurcharge = round2(surchargeRate * consumerUnits);
  const consumerUnrounded = round2(
    consumerEnergy + consumerFixed + consumerMeter + consumerDuty + consumerSurcharge
  );
  const consumerRounded = Math.round(consumerUnrounded);
  const savings = round2(consumerUnrounded - unroundedTotal);

  return {
    meteringMode,
    mode: inputs.todAdjustmentMode,
    billingMethod: prosumerBillingMethod,
    importUnits,
    exportUnits,
    solarGenerated,
    ownConsumption,
    totalUnitsForFixed,
    netImportBeforeBank,
    netExport,
    billedUnits,
    previousBank: inputs.previousBank,
    updatedBank: zoneBreakdown.updatedBank,
    zoneBreakdown,
    fixedCharge: fixedInfo.value,
    fixedSlabLabel: fixedInfo.label,
    meterCharge,
    energyCharge: round2(energyCharge),
    energyBreakdownLines,
    todBaseRate,
    todRatesApplied,
    dutyPercent,
    dutyAmount,
    surchargeRate,
    surchargeFallbackUsed,
    surchargeAmount,
    unroundedTotal,
    roundOff,
    roundedTotal,
    consumerComparison: {
      consumerUnits,
      billingMethod: consumerBillingMethod,
      fixedCharge: consumerFixed,
      meterCharge: consumerMeter,
      energyCharge: round2(consumerEnergy),
      dutyAmount: consumerDuty,
      surchargeAmount: consumerSurcharge,
      unroundedTotal: consumerUnrounded,
      roundedTotal: consumerRounded,
      savings,
    },
  };
}
