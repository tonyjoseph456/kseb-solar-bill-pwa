import { describe, expect, it } from 'vitest';
import { calculateProsumerBill } from '../calculator';
import { parseKsebBillPages } from '../pdfParser';
import { BUNDLED_FALLBACK_TARIFFS } from '../tariffFetcher';

const SAMPLE_BILL_PAGES = [
  `KERALA STATE ELECTRICITY BOARD LIMITED
DEMAND CUM DISCONNECTION NOTICE
Section [0000]-Electrical Section Sample Section Phone# 04000 000000 Customer Care 1912
Consumer# 1156000000000 Reg. Mob# 900xxxx000 Regular CC Bill(PostPaid)
Name & Mailing Address
SAMPLE PROSUMER
SAMPLE HOUSE(H), SAMPLE P.O,
Bill# 5620261100000 Bill Area A01/1 DTR SAMPLE DTR
Billing Period 11/2026[Monthly] Tariff/Phase LT-1/Three Pole# SMP-101
Bill Date 01-11-2026 Due Date 11-11-2026 DC Date 26-11-2026
Contract Demand (Nil) VA Connected Load 9596 Watts Security Deposit Rs.1000.00
Meter# MTR0SAMPLE000001
Meter Type/ NET Meter
Meter Owner Customer
Power Unit Zone Trading Initial Reading(IR) Final Reading(FR) OMF Units*
KWH Normal Import 2298.00 2413.00 1 115
KWH Normal Export 7490.00 7875.00 1 385
KWH Off Peak Import 4260.00 4474.00 1 214
KWH Off Peak Export 0.00 0.00 1 0
KWH Peak Import 1722.00 1822.00 1 100
KWH Peak Export 6.00 6.00 1 0`,

  `Section [0000]-Electrical Section Sample Section Phone# 04000 000000
Consumer# 1156000000000 Bill# 5620261100000 Regular CC Bill
Solar Generation
Description Date Zone Tr. IR FR MF Units
Regular Reading Point 01-11-2026 WNL I 8710.00 9095.00 1 385
Regular Reading Point 01-11-2026 WOP I 0.00 0.00 1 0
Regular Reading Point 01-11-2026 WPK I 12.00 12.00 1 0
Bill Details [INR] Amount(Rs.)
a) Fixed Charges Fixed Charge[FC] 285.00
b) Energy Charges Energy Charge[EC] 147.40
Auto Recovery FS[FSM] 2.20
c) Other Charges Electricity Duty[ED] 14.74
d) Round Off -0.34
e) Total Amt.(Bill#5620261100000) (a+b+c+d) 449.00
Net Payable(e+f+g+h+i-j-k) 0.00`,

  `Solar OnGrid Consumer (Generator)
Consumer No. 1156000000000 Consumer Name SAMPLE PROSUMER
SPIN 000000000 Plant Capacity 4.46 KW
Grid Connected On 01-01-2025
Bank Statement for 202611 (Generator)
Units Imported 429 kWh Units Exported 385 kWh
Bank Opening 0 Billed Consumption 44 kWh
Bank Closing 0`,
];

describe('KSEB OrumaNET PDF Parser & Prosumer Calculator', () => {
  it('parses all net meter, solar generation, bank, and bill figures from 11/2026 bill', () => {
    const { record, warnings } = parseKsebBillPages(SAMPLE_BILL_PAGES, 'nov2026.pdf');

    expect(warnings).toHaveLength(0);
    expect(record.consumerNo).toBe('1156000000000');
    expect(record.consumerName).toBe('SAMPLE PROSUMER');
    expect(record.billingMonth).toBe('2026-11');
    expect(record.billingLabel).toBe('11/2026');
    expect(record.tariffPhase).toBe('three');
    expect(record.meterOwner).toBe('prosumer');
    expect(record.bankOpening).toBe(0);
    expect(record.bankClosing).toBe(0);

    // Final Readings (used to autofill next month's Previous fields)
    expect(record.readings.import.NL.fr).toBe(2413);
    expect(record.readings.export.NL.fr).toBe(7875);
    expect(record.readings.import.OP.fr).toBe(4474);
    expect(record.readings.export.OP.fr).toBe(0);
    expect(record.readings.import.PK.fr).toBe(1822);
    expect(record.readings.export.PK.fr).toBe(6);

    expect(record.readings.generation.NL.fr).toBe(9095);
    expect(record.readings.generation.OP.fr).toBe(0);
    expect(record.readings.generation.PK.fr).toBe(12);

    // Bill Summary
    expect(record.summary.totalImport).toBe(429);
    expect(record.summary.totalExport).toBe(385);
    expect(record.summary.solarGenerated).toBe(385);
    expect(record.summary.billedUnits).toBe(44);
    expect(record.summary.fixedCharge).toBe(285);
    expect(record.summary.energyCharge).toBe(147.4);
    expect(record.summary.fuelSurcharge).toBe(2.2);
    expect(record.summary.electricityDuty).toBe(14.74);
    expect(record.summary.roundOff).toBe(-0.34);
    expect(record.summary.totalAmount).toBe(449);
  });

  it('reproduces 11/2026 bill amounts exactly using anwarbio tariffs', () => {
    const result = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      billingMonth: '2026-11',
      phaseType: 'three',
      meterOwner: 'prosumer',
      previousBank: 0,
      todAdjustmentMode: 'anwarbio',
      importUnits: { NL: 115, OP: 214, PK: 100 },
      exportUnits: { NL: 385, OP: 0, PK: 0 },
      solarGenUnits: { NL: 385, OP: 0, PK: 0 },
    });

    expect(result.billedUnits).toBe(44);
    expect(result.billingMethod).toBe('telescopic');
    expect(result.fixedCharge).toBe(285);
    expect(result.meterCharge).toBe(0);
    expect(result.energyCharge).toBe(147.4);
    expect(result.surchargeAmount).toBe(2.2);
    expect(result.dutyAmount).toBe(14.74);
    expect(result.unroundedTotal).toBe(449.34);
    expect(result.roundOff).toBe(-0.34);
    expect(result.roundedTotal).toBe(449);
  });

  it('applies anwarbio (NL->OP->PK) vs KSEB OrumaNET (PK->NL->OP) toggle above 250 net units', () => {
    const shared = {
      billingMonth: '2026-11',
      phaseType: 'three' as const,
      meterOwner: 'prosumer' as const,
      previousBank: 0,
      importUnits: { NL: 100, OP: 200, PK: 150 }, // 450 import
      exportUnits: { NL: 150, OP: 0, PK: 0 }, // 50 surplus export
      solarGenUnits: { NL: 250, OP: 0, PK: 0 },
    };

    const anwarbio = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      ...shared,
      todAdjustmentMode: 'anwarbio',
    });
    const kseb = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      ...shared,
      todAdjustmentMode: 'kseb',
    });

    // Net billed = 300 (>250 -> ToD base 6.75)
    expect(anwarbio.billedUnits).toBe(300);
    expect(kseb.billedUnits).toBe(300);

    // anwarbio subtracts 50 surplus from OP (leaving OP=150, PK=150)
    expect(anwarbio.zoneBreakdown.adjustedImportAfterBank).toEqual({
      NL: 0,
      OP: 150,
      PK: 150,
    });
    // KSEB subtracts 50 surplus from PK (leaving OP=200, PK=100)
    expect(kseb.zoneBreakdown.adjustedImportAfterBank).toEqual({
      NL: 0,
      OP: 200,
      PK: 100,
    });

    // PK multiplier is 1.25 vs OP 1.0, so anwarbio energy charge is higher
    expect(anwarbio.energyCharge).toBeGreaterThan(kseb.energyCharge);
  });

  it('falls back safely when upstream other_charges.csv has blank surcharge (Dec 2026)', () => {
    const result = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      billingMonth: '2026-12',
      phaseType: 'three',
      meterOwner: 'prosumer',
      previousBank: 0,
      todAdjustmentMode: 'anwarbio',
      importUnits: { NL: 100, OP: 100, PK: 50 },
      exportUnits: { NL: 200, OP: 0, PK: 0 },
      solarGenUnits: { NL: 200, OP: 0, PK: 0 },
    });

    expect(result.surchargeFallbackUsed).toBe(true);
    expect(result.surchargeRate).toBe(0.05);
    expect(Number.isFinite(result.roundedTotal)).toBe(true);
  });

  it('calculates 2026-10 consumption from Page 4 Adjustment Report accurately', () => {
    const result = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      billingMonth: '2026-10',
      phaseType: 'three',
      meterOwner: 'prosumer',
      previousBank: 0,
      todAdjustmentMode: 'kseb',
      importUnits: { NL: 93, OP: 365, PK: 79 },
      exportUnits: { NL: 496, OP: 0, PK: 0 },
      solarGenUnits: { NL: 496, OP: 0, PK: 0 },
    });

    expect(result.billedUnits).toBe(41);
    expect(result.zoneBreakdown.adjustedImportAfterBank).toEqual({
      NL: 0,
      OP: 41,
      PK: 0,
    });
    expect(result.fixedCharge).toBe(310); // 537 units > 500 slab
    expect(result.surchargeRate).toBe(0.03); // Oct 2026 from other_charges.csv
    expect(result.surchargeAmount).toBe(1.23);
  });

  it('toggles clamped OC >= 0 vs exact anwarbio negative OC when export exceeds solar gen', () => {
    const base = {
      billingMonth: '2026-12',
      phaseType: 'three' as const,
      meterOwner: 'prosumer' as const,
      previousBank: 0,
      todAdjustmentMode: 'anwarbio' as const,
      importUnits: { NL: 81, OP: 265, PK: 35 }, // 381 total
      exportUnits: { NL: 347, OP: 0, PK: 0 }, // 347 total
      solarGenUnits: { NL: 296, OP: 0, PK: 0 }, // 296 total
      surchargeOverride: 0.05,
    };

    const clamped = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      ...base,
      allowNegativeOwnConsumption: false,
    });
    expect(clamped.ownConsumption).toBe(0);
    expect(clamped.totalUnitsForFixed).toBe(381);
    expect(clamped.fixedCharge).toBe(260);
    expect(clamped.unroundedTotal).toBe(386.99);
    expect(clamped.roundedTotal).toBe(387);

    const anwarbioExact = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      ...base,
      allowNegativeOwnConsumption: true,
    });
    expect(anwarbioExact.ownConsumption).toBe(-51);
    expect(anwarbioExact.totalUnitsForFixed).toBe(330);
    expect(anwarbioExact.fixedCharge).toBe(250);
    expect(anwarbioExact.unroundedTotal).toBe(376.99);
    expect(anwarbioExact.roundedTotal).toBe(377);
  });
});
