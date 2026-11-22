import type {
  BillRecord,
  SolarBillMatchMode,
  SolarDailyReading,
  SolarGenerationRecord,
} from '../types';

export const FULL_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface SolarWeekSummary {
  weekNumber: number; // 1..6
  startDay: number;
  endDay: number;
  rangeLabel: string; // '01/05/25-03/05/25'
  daysWithData: number;
  totalUnits: number;
  averageUnits: number | null; // rounded to 1 decimal, null if no data in that calendar week
}

export interface SolarMonthComputedStats {
  record: SolarGenerationRecord;
  year: number;
  month: number; // 1..12
  monthName: string;
  daysInMonth: number;
  recordedDays: number;
  totalUnits: number;
  dailyAverage: number; // rounded to 2 decimals
  estimatedProduction: number; // dailyAverage * daysInMonth
  productionPerKw: number; // rounded to 2 decimals
  maxUnits: number;
  minUnits: number;
  weeks: SolarWeekSummary[];
  importUnits: number | null;
  exportUnits: number | null;
  averageImport: number | null; // running mean (rounded integer)
  exactAverageImport: number | null;
  matchedBillMonth: string | null;
  matchedBillId: string | null;
}

export interface SolarYearTableRow {
  billingMonth: string;
  month: number;
  monthName: string;
  shortMonthName: string;
  stats: SolarMonthComputedStats | null;
}

export interface SolarYearSummary {
  year: number;
  rows: SolarYearTableRow[];
  monthsWithData: number;
  totalUnits: number;
  totalRecordedDays: number;
  dailyAverageInYear: number;
  monthlyAverageInYear: number;
  productionPerKwInYear: number;
  maxWeekCount: number; // 5 or 6
}

function roundTo(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatSolarMonthLabel(billingMonth: string): string {
  const [yStr, mStr] = billingMonth.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return billingMonth;
  }
  return `${FULL_MONTH_NAMES[m - 1]} ${y}`;
}

export function nextYearMonth(ym: string): string {
  const [yStr, mStr] = ym.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ym;
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

function parseFlexibleDate(raw: string): { year: number; month: number; day: number } | null {
  const cleaned = raw.replace(/^["']|["']$/g, '').trim();
  let year = 0;
  let month = 0;
  let day = 0;

  let m = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    day = parseInt(m[1], 10);
    month = parseInt(m[2], 10);
    year = parseInt(m[3], 10);
  } else {
    m = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!m) return null;
    year = parseInt(m[1], 10);
    month = parseInt(m[2], 10);
    day = parseInt(m[3], 10);
  }

  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/**
 * Parses a solar inverter CSV containing daily Date + Units Produced rows.
 * Handles April-style headers (`Date,Units Produced,Total Units Produced`),
 * May/June-style headers (`May-25,` + `Date,Units Produced` + `Total Units,XXX`),
 * trailing empty rows/columns, and both DD-MM-YYYY and YYYY-MM-DD dates.
 */
export function parseSolarInverterCsv(
  csvText: string,
  filename = 'solar-generation.csv'
): SolarGenerationRecord[] {
  const text = csvText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);

  const grouped = new Map<string, Map<string, SolarDailyReading>>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cols = trimmed.split(',').map((c) => c.replace(/^["']|["']$/g, '').trim());
    if (cols.length < 2) continue;

    const parsedDate = parseFlexibleDate(cols[0]);
    if (!parsedDate) continue;

    const unitsNum = parseFloat(cols[1].replace(/,/g, ''));
    if (!Number.isFinite(unitsNum) || unitsNum < 0) continue;

    const billingMonth = `${parsedDate.year}-${pad2(parsedDate.month)}`;
    const isoDate = `${billingMonth}-${pad2(parsedDate.day)}`;

    let monthMap = grouped.get(billingMonth);
    if (!monthMap) {
      monthMap = new Map<string, SolarDailyReading>();
      grouped.set(billingMonth, monthMap);
    }
    monthMap.set(isoDate, {
      date: isoDate,
      day: parsedDate.day,
      units: roundTo(unitsNum, 2),
    });
  }

  if (grouped.size === 0) {
    throw new Error(
      `No valid daily Date & Units Produced rows found in "${filename}". Expected rows like DD-MM-YYYY,units.`
    );
  }

  const nowIso = new Date().toISOString();
  const records: SolarGenerationRecord[] = [];
  const sortedMonths = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

  for (const billingMonth of sortedMonths) {
    const readings = Array.from(grouped.get(billingMonth)!.values()).sort(
      (a, b) => a.day - b.day
    );
    records.push({
      id: `solar_${billingMonth}`,
      billingMonth,
      billingLabel: formatSolarMonthLabel(billingMonth),
      sourceFilename: filename,
      dailyReadings: readings,
      createdAt: nowIso,
      updatedAt: nowIso,
      syncStatus: 'pending',
    });
  }

  return records;
}

/**
 * Splits a calendar month into Sunday-to-Saturday weeks matching KSEB/spreadsheet reporting.
 */
export function computeMonthWeeks(
  year: number,
  month: number,
  dailyReadings: SolarDailyReading[]
): SolarWeekSummary[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const byDay = new Map<number, number>();
  for (const r of dailyReadings) {
    byDay.set(r.day, r.units);
  }

  const yy = String(year).slice(-2);
  const mm = pad2(month);
  const weeks: SolarWeekSummary[] = [];

  let weekNumber = 1;
  let startDay = 1;

  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(year, month - 1, day).getDay(); // 0 = Sun .. 6 = Sat
    if (dow === 6 || day === daysInMonth) {
      let sum = 0;
      let count = 0;
      for (let d = startDay; d <= day; d++) {
        const val = byDay.get(d);
        if (val !== undefined) {
          sum += val;
          count++;
        }
      }
      weeks.push({
        weekNumber,
        startDay,
        endDay: day,
        rangeLabel: `${pad2(startDay)}/${mm}/${yy}-${pad2(day)}/${mm}/${yy}`,
        daysWithData: count,
        totalUnits: roundTo(sum, 2),
        averageUnits: count > 0 ? roundTo(sum / count, 1) : null,
      });
      weekNumber++;
      startDay = day + 1;
    }
  }

  return weeks;
}

function findMatchingBillRecord(
  billRecords: BillRecord[],
  targetMonth: string
): BillRecord | null {
  const matches = billRecords.filter((b) => !b.deleted && b.billingMonth === targetMonth);
  if (matches.length === 0) return null;
  const official = matches.find((b) => b.recordType === 'official_bill');
  return official ?? matches[0];
}

/**
 * Computes full monthly statistics for all uploaded solar records in chronological order
 * (so running Average Import accumulates monotonically across months).
 */
export function computeAllSolarMonthStats(
  solarRecords: SolarGenerationRecord[],
  billRecords: BillRecord[],
  plantCapacityKw = 5,
  matchMode: SolarBillMatchMode = 'next_month'
): SolarMonthComputedStats[] {
  const kw = plantCapacityKw > 0 ? plantCapacityKw : 5;
  const sorted = [...solarRecords]
    .filter((r) => !r.deleted)
    .sort((a, b) => a.billingMonth.localeCompare(b.billingMonth));

  let runningImportSum = 0;
  let runningImportMonths = 0;

  return sorted.map((record) => {
    const [yStr, mStr] = record.billingMonth.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    const readings = [...record.dailyReadings].sort((a, b) => a.day - b.day);
    const recordedDays = readings.length;
    const totalUnits = roundTo(
      readings.reduce((acc, r) => acc + r.units, 0),
      2
    );
    const dailyAverage = recordedDays > 0 ? roundTo(totalUnits / recordedDays, 2) : 0;
    const estimatedProduction = roundTo(dailyAverage * daysInMonth, 2);
    const productionPerKw = recordedDays > 0 ? roundTo(totalUnits / recordedDays / kw, 2) : 0;
    const maxUnits = recordedDays > 0 ? Math.max(...readings.map((r) => r.units)) : 0;
    const minUnits = recordedDays > 0 ? Math.min(...readings.map((r) => r.units)) : 0;
    const weeks = computeMonthWeeks(year, month, readings);

    const targetBillMonth =
      matchMode === 'next_month' ? nextYearMonth(record.billingMonth) : record.billingMonth;
    const matchedBill = findMatchingBillRecord(billRecords, targetBillMonth);

    const importUnits =
      record.importOverride !== undefined && Number.isFinite(record.importOverride)
        ? record.importOverride
        : matchedBill
        ? matchedBill.summary.totalImport
        : null;
    const exportUnits =
      record.exportOverride !== undefined && Number.isFinite(record.exportOverride)
        ? record.exportOverride
        : matchedBill
        ? matchedBill.summary.totalExport
        : null;

    if (importUnits !== null) {
      runningImportSum += importUnits;
      runningImportMonths++;
    }

    const exactAverageImport =
      runningImportMonths > 0 ? roundTo(runningImportSum / runningImportMonths, 2) : null;
    const averageImport =
      exactAverageImport !== null ? Math.round(exactAverageImport) : null;

    return {
      record,
      year,
      month,
      monthName: FULL_MONTH_NAMES[month - 1] ?? record.billingLabel,
      daysInMonth,
      recordedDays,
      totalUnits,
      dailyAverage,
      estimatedProduction,
      productionPerKw,
      maxUnits,
      minUnits,
      weeks,
      importUnits,
      exportUnits,
      averageImport,
      exactAverageImport,
      matchedBillMonth: matchedBill ? matchedBill.billingMonth : null,
      matchedBillId: matchedBill ? matchedBill.id : null,
    };
  });
}

export function computeSolarYearSummary(
  year: number,
  allStats: SolarMonthComputedStats[],
  plantCapacityKw = 5
): SolarYearSummary {
  const kw = plantCapacityKw > 0 ? plantCapacityKw : 5;
  const earliestOverall = allStats[0]?.record.billingMonth;
  const startMonth =
    earliestOverall && parseInt(earliestOverall.slice(0, 4), 10) === year
      ? Math.max(1, parseInt(earliestOverall.slice(5, 7), 10))
      : 1;

  const statsByMonth = new Map<number, SolarMonthComputedStats>();
  for (const st of allStats) {
    if (st.year === year) {
      statsByMonth.set(st.month, st);
    }
  }

  const rows: SolarYearTableRow[] = [];
  for (let m = startMonth; m <= 12; m++) {
    const ym = `${year}-${pad2(m)}`;
    rows.push({
      billingMonth: ym,
      month: m,
      monthName: FULL_MONTH_NAMES[m - 1],
      shortMonthName: SHORT_MONTH_NAMES[m - 1],
      stats: statsByMonth.get(m) ?? null,
    });
  }

  const activeStats = rows.map((r) => r.stats).filter((s): s is SolarMonthComputedStats => s !== null);
  const monthsWithData = activeStats.length;
  const totalUnits = roundTo(
    activeStats.reduce((acc, s) => acc + s.totalUnits, 0),
    2
  );
  const totalRecordedDays = activeStats.reduce((acc, s) => acc + s.recordedDays, 0);
  const dailyAverageInYear =
    totalRecordedDays > 0 ? roundTo(totalUnits / totalRecordedDays, 2) : 0;
  const monthlyAverageInYear =
    monthsWithData > 0 ? roundTo(totalUnits / monthsWithData, 2) : 0;
  const productionPerKwInYear =
    dailyAverageInYear > 0 ? roundTo(dailyAverageInYear / kw, 2) : 0;

  const hasWeek6 = activeStats.some((s) => (s.weeks[5]?.daysWithData ?? 0) > 0);
  const maxWeekCount = hasWeek6 ? 6 : 5;

  return {
    year,
    rows,
    monthsWithData,
    totalUnits,
    totalRecordedDays,
    dailyAverageInYear,
    monthlyAverageInYear,
    productionPerKwInYear,
    maxWeekCount,
  };
}
