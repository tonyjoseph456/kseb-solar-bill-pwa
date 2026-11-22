export type ZoneKey = 'NL' | 'OP' | 'PK';
export type TodAdjustmentMode = 'anwarbio' | 'kseb';
export type MeteringMode = 'tod' | 'cumulative';
export type PhaseType = 'single' | 'three';
export type MeterOwner = 'prosumer' | 'kseb';
export type RecordType = 'official_bill' | 'meter_estimate';
export type SyncStatus = 'local' | 'pending' | 'synced';

export interface FixedChargeRow {
  min: number;
  max: number;
  label: string;
  single: number;
  three: number;
}

export interface MeterChargeRow {
  label: string;
  single: number;
  three: number;
}

export interface OtherChargeRow {
  year: number;
  month: string;
  label: string;
  duty: number;
  surcharge: number | null;
}

export interface TelescopicSlabRow {
  limit: number;
  rate: number;
}

export interface NonTelescopicSlabRow {
  upper: number;
  rate: number;
}

export interface TodBaseRateRow {
  upper: number;
  base: number;
}

export interface TariffTables {
  fixedCharges: FixedChargeRow[];
  meterCharges: MeterChargeRow[];
  otherCharges: OtherChargeRow[];
  domesticTelescopic: TelescopicSlabRow[];
  domesticNonTelescopic: NonTelescopicSlabRow[];
  todMultipliers: {
    nl: number;
    op: number;
    pk: number;
  };
  todBaseRates: TodBaseRateRow[];
  constants: {
    nonTelStartUnit: number;
    prosTodStartUnit: number;
    conTodStartUnit: number;
  };
  fetchedAt: string;
  source: 'github-raw' | 'github-pages' | 'cache' | 'bundled-fallback';
  sourceUrls: string[];
}

export interface ZoneMeterReading {
  ir: number;
  fr: number;
  mf: number;
  units: number;
}

export interface ZoneTriplet {
  NL: ZoneMeterReading;
  OP: ZoneMeterReading;
  PK: ZoneMeterReading;
}

export interface MeterSnapshotReadings {
  import: ZoneTriplet;
  export: ZoneTriplet;
  generation: ZoneTriplet;
}

export interface BillSummary {
  totalImport: number;
  totalExport: number;
  solarGenerated: number;
  ownConsumption: number;
  netImportBeforeBank: number;
  netExport: number;
  billedUnits: number;
  fixedCharge: number;
  fixedSlabLabel: string;
  energyCharge: number;
  fuelSurcharge: number;
  electricityDuty: number;
  meterRent: number;
  roundOff: number;
  unroundedTotal: number;
  totalAmount: number;
  netPayable?: number;
  consumerEquivalentTotal?: number;
  solarSavings?: number;
}

export interface BillRecord {
  id: string;
  recordType: RecordType;
  billingMonth: string; // YYYY-MM e.g. '2026-11'
  billingLabel: string; // MM/YYYY e.g. '11/2026'
  consumerNo: string;
  consumerName: string;
  billNo?: string;
  billDate?: string;
  dueDate?: string;
  section?: string;
  meterNumber?: string;
  tariffPhase: PhaseType;
  meterOwner: MeterOwner;
  connectedLoadWatts?: number;
  plantCapacityKw?: number;
  bankOpening: number;
  bankClosing: number;
  readings: MeterSnapshotReadings;
  summary: BillSummary;
  meteringMode?: MeteringMode;
  todAdjustmentMode?: TodAdjustmentMode;
  dutyRateUsed?: number;
  surchargeRateUsed?: number;
  tariffSource?: string;
  pdfFilename?: string;
  pdfStoragePath?: string;
  hasLocalPdf?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  deleted?: boolean;
}

export interface ZoneAdjustmentBreakdown {
  actualImport: Record<ZoneKey, number>;
  netImportAfterExport: Record<ZoneKey, number>;
  adjustedImportAfterBank: Record<ZoneKey, number>;
  updatedBank: number;
}

export interface ProsumerCalculationResult {
  meteringMode: MeteringMode;
  mode: TodAdjustmentMode;
  billingMethod: 'telescopic' | 'non-telescopic-tod' | 'non-telescopic';
  importUnits: number;
  exportUnits: number;
  solarGenerated: number;
  ownConsumption: number;
  totalUnitsForFixed: number;
  netImportBeforeBank: number;
  netExport: number;
  billedUnits: number;
  previousBank: number;
  updatedBank: number;
  zoneBreakdown: ZoneAdjustmentBreakdown;
  fixedCharge: number;
  fixedSlabLabel: string;
  meterCharge: number;
  energyCharge: number;
  energyBreakdownLines: string[];
  todBaseRate: number | null;
  todRatesApplied: { nl: number; op: number; pk: number };
  dutyPercent: number;
  dutyAmount: number;
  surchargeRate: number;
  surchargeFallbackUsed: boolean;
  surchargeAmount: number;
  unroundedTotal: number;
  roundOff: number;
  roundedTotal: number;
  consumerComparison: {
    consumerUnits: number;
    billingMethod: 'telescopic' | 'non-telescopic-tod' | 'non-telescopic';
    fixedCharge: number;
    meterCharge: number;
    energyCharge: number;
    dutyAmount: number;
    surchargeAmount: number;
    unroundedTotal: number;
    roundedTotal: number;
    savings: number;
  };
}

export type SolarBillMatchMode = 'next_month' | 'same_month';

export interface AppSettings {
  todAdjustmentMode: TodAdjustmentMode;
  allowNegativeOwnConsumption: boolean;
  defaultPhase: PhaseType;
  defaultMeterOwner: MeterOwner;
  consumerNo: string;
  consumerName: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  autoSyncOnOpen: boolean;
  uploadPdfToCloud: boolean;
  activeBaselineId?: string; // optional override of which bill's FR auto-fills Previous
  solarPlantCapacityKw?: number; // default 5 kW
  solarBillMatchMode?: SolarBillMatchMode; // default 'next_month' (KSEB Bill 01-(M+1) covers Month M)
  updatedAt: string;
}

export interface SolarDailyReading {
  date: string; // 'YYYY-MM-DD'
  day: number; // 1..31
  units: number;
}

export interface SolarGenerationRecord {
  id: string; // e.g. 'solar_2025-05'
  billingMonth: string; // 'YYYY-MM'
  billingLabel: string; // 'May 2025'
  sourceFilename: string;
  dailyReadings: SolarDailyReading[];
  importOverride?: number;
  exportOverride?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  deleted?: boolean;
}

export interface CurrentReadingsDraft {
  billingMonth: string; // YYYY-MM
  meteringMode?: MeteringMode;
  importCurr: { NL: string; OP: string; PK: string };
  exportCurr: { NL: string; OP: string; PK: string };
  genCurr: { NL: string; OP: string; PK: string };
  importPrevOverride?: { NL?: string; OP?: string; PK?: string };
  exportPrevOverride?: { NL?: string; OP?: string; PK?: string };
  genPrevOverride?: { NL?: string; OP?: string; PK?: string };
  bankOpeningOverride?: string;
  dutyOverride?: string;
  surchargeOverride?: string;
}
