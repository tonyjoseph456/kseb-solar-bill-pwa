import { describe, expect, it } from 'vitest';
import type { BillRecord } from '../../types';
import {
  computeAllSolarMonthStats,
  computeSolarYearSummary,
  parseSolarInverterCsv,
} from '../solarCalculator';

const APRIL_2025_CSV = `Date,Units Produced,Total Units Produced
29-04-2025,18,39
30-04-2025,21,`;

const MAY_2025_CSV = `May-25,
Date,Units Produced
01-05-2025,18
02-05-2025,22
03-05-2025,7
04-05-2025,26
05-05-2025,18
06-05-2025,22
07-05-2025,22
08-05-2025,22
09-05-2025,26
10-05-2025,25
11-05-2025,25
12-05-2025,24
13-05-2025,20
14-05-2025,21
15-05-2025,18
16-05-2025,20
17-05-2025,12
18-05-2025,17
19-05-2025,17
20-05-2025,17
21-05-2025,20
22-05-2025,14
23-05-2025,14
24-05-2025,9
25-05-2025,7
26-05-2025,3
27-05-2025,1
28-05-2025,10
29-05-2025,8
30-05-2025,4
31-05-2025,2
Total Units,491`;

const JUNE_2025_CSV = `Jun-25,
Date,Units Produced
01-06-2025,18
02-06-2025,21
03-06-2025,17
04-06-2025,9
05-06-2025,8
06-06-2025,22
07-06-2025,18
08-06-2025,15
09-06-2025,18
10-06-2025,10
11-06-2025,10
12-06-2025,13
13-06-2025,10
14-06-2025,8
15-06-2025,9
16-06-2025,13
17-06-2025,10
18-06-2025,12
19-06-2025,10
20-06-2025,8
21-06-2025,12
22-06-2025,11
23-06-2025,16
24-06-2025,12
25-06-2025,9
26-06-2025,1
27-06-2025,15
28-06-2025,11
29-06-2025,16
30-06-2025,17
,
Total Units,379`;

function makeMockBill(billingMonth: string, totalImport: number, totalExport: number): BillRecord {
  const emptyZone = { ir: 0, fr: 0, mf: 1, units: 0 };
  return {
    id: `official_sample_${billingMonth}`,
    recordType: 'official_bill',
    billingMonth,
    billingLabel: billingMonth,
    consumerNo: '1156000000000',
    consumerName: 'SAMPLE PROSUMER',
    tariffPhase: 'three',
    meterOwner: 'prosumer',
    bankOpening: 0,
    bankClosing: 0,
    readings: {
      import: { NL: { ...emptyZone }, OP: { ...emptyZone }, PK: { ...emptyZone } },
      export: { NL: { ...emptyZone }, OP: { ...emptyZone }, PK: { ...emptyZone } },
      generation: { NL: { ...emptyZone }, OP: { ...emptyZone }, PK: { ...emptyZone } },
    },
    summary: {
      totalImport,
      totalExport,
      solarGenerated: 0,
      ownConsumption: 0,
      netImportBeforeBank: 0,
      netExport: 0,
      billedUnits: 0,
      fixedCharge: 285,
      fixedSlabLabel: '0-500',
      energyCharge: 0,
      fuelSurcharge: 0,
      electricityDuty: 0,
      meterRent: 0,
      roundOff: 0,
      unroundedTotal: 285,
      totalAmount: 285,
    },
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    syncStatus: 'synced',
  };
}

describe('Solar Inverter CSV Parser & Analytics Calculator', () => {
  it('parses April, May, and June 2025 CSV formats accurately', () => {
    const [apr] = parseSolarInverterCsv(APRIL_2025_CSV, '04-2025.csv');
    const [may] = parseSolarInverterCsv(MAY_2025_CSV, '05-2025.csv');
    const [jun] = parseSolarInverterCsv(JUNE_2025_CSV, '06-2025.csv');

    expect(apr.billingMonth).toBe('2025-04');
    expect(apr.dailyReadings).toHaveLength(2);
    expect(apr.dailyReadings.reduce((s, r) => s + r.units, 0)).toBe(39);

    expect(may.billingMonth).toBe('2025-05');
    expect(may.dailyReadings).toHaveLength(31);
    expect(may.dailyReadings.reduce((s, r) => s + r.units, 0)).toBe(491);

    expect(jun.billingMonth).toBe('2025-06');
    expect(jun.dailyReadings).toHaveLength(30);
    expect(jun.dailyReadings.reduce((s, r) => s + r.units, 0)).toBe(379);
  });

  it('matches May & June 2025 monthly KPIs, Sun-Sat weekly averages, and running average import', () => {
    const apr = parseSolarInverterCsv(APRIL_2025_CSV, '04-2025.csv')[0];
    const may = parseSolarInverterCsv(MAY_2025_CSV, '05-2025.csv')[0];
    const jun = parseSolarInverterCsv(JUNE_2025_CSV, '06-2025.csv')[0];

    // KSEB 06/2025 bill (dated 01-06-2025) carries May consumption; 07/2025 bill carries June
    const bills = [makeMockBill('2025-06', 328, 427), makeMockBill('2025-07', 361, 332)];

    const allStats = computeAllSolarMonthStats([jun, may, apr], bills, 5, 'next_month');
    expect(allStats).toHaveLength(3);

    const [aprStats, mayStats, junStats] = allStats;

    // April partial month (29-30 Apr -> Week 5)
    expect(aprStats.totalUnits).toBe(39);
    expect(aprStats.dailyAverage).toBe(19.5);
    expect(aprStats.estimatedProduction).toBe(585);
    expect(aprStats.productionPerKw).toBe(3.9);
    expect(aprStats.weeks.slice(0, 4).every((w) => w.averageUnits === null)).toBe(true);
    expect(aprStats.weeks[4].averageUnits).toBe(19.5);
    expect(aprStats.averageImport).toBeNull();

    // May 2025 exact match with reference image
    expect(mayStats.totalUnits).toBe(491);
    expect(mayStats.dailyAverage).toBe(15.84);
    expect(mayStats.estimatedProduction).toBe(491.04);
    expect(mayStats.maxUnits).toBe(26);
    expect(mayStats.minUnits).toBe(1);
    expect(mayStats.productionPerKw).toBe(3.17);
    expect(mayStats.weeks.map((w) => w.rangeLabel)).toEqual([
      '01/05/25-03/05/25',
      '04/05/25-10/05/25',
      '11/05/25-17/05/25',
      '18/05/25-24/05/25',
      '25/05/25-31/05/25',
    ]);
    expect(mayStats.weeks.map((w) => w.averageUnits)).toEqual([15.7, 23, 20, 15.4, 5]);
    expect(mayStats.importUnits).toBe(328);
    expect(mayStats.exportUnits).toBe(427);
    expect(mayStats.averageImport).toBe(328);

    // June 2025 exact match with reference image
    expect(junStats.totalUnits).toBe(379);
    expect(junStats.dailyAverage).toBe(12.63);
    expect(junStats.estimatedProduction).toBe(378.9);
    expect(junStats.maxUnits).toBe(22);
    expect(junStats.minUnits).toBe(1);
    expect(junStats.productionPerKw).toBe(2.53);
    expect(junStats.weeks.map((w) => w.rangeLabel)).toEqual([
      '01/06/25-07/06/25',
      '08/06/25-14/06/25',
      '15/06/25-21/06/25',
      '22/06/25-28/06/25',
      '29/06/25-30/06/25',
    ]);
    expect(junStats.weeks.map((w) => w.averageUnits)).toEqual([16.1, 12, 10.6, 10.7, 16.5]);
    expect(junStats.importUnits).toBe(361);
    expect(junStats.exportUnits).toBe(332);
    expect(junStats.exactAverageImport).toBe(344.5);
    expect(junStats.averageImport).toBe(345);
  });

  it('builds yearly summary table starting from April in initial year and full 12 months afterward', () => {
    const apr = parseSolarInverterCsv(APRIL_2025_CSV, '04-2025.csv')[0];
    const may = parseSolarInverterCsv(MAY_2025_CSV, '05-2025.csv')[0];
    const jun = parseSolarInverterCsv(JUNE_2025_CSV, '06-2025.csv')[0];
    const allStats = computeAllSolarMonthStats([apr, may, jun], [], 5);

    const y2025 = computeSolarYearSummary(2025, allStats, 5);
    expect(y2025.rows).toHaveLength(9); // April .. December
    expect(y2025.rows[0].monthName).toBe('April');
    expect(y2025.rows[8].monthName).toBe('December');
    expect(y2025.monthsWithData).toBe(3);
    expect(y2025.totalUnits).toBe(909);
    expect(y2025.totalRecordedDays).toBe(63);
    expect(y2025.dailyAverageInYear).toBe(14.43);
    expect(y2025.monthlyAverageInYear).toBe(303);
    expect(y2025.productionPerKwInYear).toBe(2.89);
    expect(y2025.maxWeekCount).toBe(5);

    const y2026 = computeSolarYearSummary(2026, allStats, 5);
    expect(y2026.rows).toHaveLength(12); // Jan .. Dec
    expect(y2026.rows[0].monthName).toBe('January');
  });
});
