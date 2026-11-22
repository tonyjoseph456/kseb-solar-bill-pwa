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

const SAMPLE_AUG2025_CUMULATIVE_PAGES = [
  `KERALA STATE ELECTRICITY BOARD LIMITED
DEMAND CUM DISCONNECTION NOTICE
Section [0000]-Electrical Section Sample Section Phone# 04000 000000 Customer Care 1912
Consumer# 1156000000000 Reg. Mob# 900xxxx000 Regular CC Bill(PostPaid)
Name & Mailing Address
SAMPLE PROSUMER South: Chairperson,CGRF(South)
SAMPLE HOUSE(H), SAMPLE P.O,
Bill# 5620250800000 Bill Area A01/1 DTR SAMPLE DTR
Billing Period 8/2025[Monthly] Tariff/Phase LT-1/Three Pole# SMP-101
Bill Date 01-08-2025 Due Date 11-08-2025 DC Date 26-08-2025
Meter# MTR0SAMPLE000001
Meter Type/Owner NET Meter/Customer
Power Unit/Zone CUMULATIVE
KWH Cumulative Import 6000.00 6452.00 1 452
KWH Cumulative Export 5000.00 5320.00 1 320`,

  `Section [0000]-Electrical Section Sample Section Phone# 04000 000000
Consumer# 1156000000000 Bill# 5620250800000 Regular CC Bill
Solar Generation
Description Date Zone Tr. IR FR MF Units
Regular Reading Point 01-08-2025 WAL E 1000.00 1349.00 1 349
Bill Details [INR] Amount(Rs.)
a) Fixed Charges Fixed Charge[FC] 285.00
b) Energy Charges Energy Charge[EC] 218.50
Auto Recovery FS[FSM] 5.58
c) Other Charges Electricity Duty[ED] 21.85
e) Round Off 0.07
d) Total Amt.(Bill#5620250800000) (a+b+c+e) 531.00
Net Payable(d+f+g+h+i-j-k) 0.00`,

  `Solar OnGrid Consumer (Generator)
Consumer No. 1156000000000 Consumer Name SAMPLE PROSUMER
SPIN 000000000 Plant Capacity 4.46 KW
Bank Statement for 202508 (Generator)
Units Imported 452 kWh Units Exported 320 kWh
Bank Opening 70 Billed Consumption 62 kWh
Bank Closing 0`,
];

const SAMPLE_SEP2025_CUMULATIVE_PAGE = [
  `KERALA STATE ELECTRICITY BOARD LIMITED
DEMAND CUM DISCONNECTION NOTICE
Section [0000]-Electrical Section Sample Section Phone# 04000 000000 Customer Care 1912
Consumer# 1156000000000 Reg. Mob# 900xxxx000 Regular CC Bill(PostPaid)
Name & Mailing Address For redressing complaints/grievance approach the concerned CGRF
SAMPLE PROSUMER South: Chairperson,CGRF(South), Kottarakkara
SAMPLE HOUSE(H), SAMPLE P.O,
Bill# 5620250900000 Bill Area A01/1 DTR SAMPLE DTR
Billing Period 9/2025[Monthly] Tariff/Phase LT-1/Three Pole# SMP-101
Bill Date 01-09-2025 Due Date 11-09-2025 DC Date 26-09-2025
Meter# MTR0SAMPLE000001
Meter Type/Owner NET Meter/Customer
Power Unit/Zone CUMULATIVE
KWH Cumulative Import 6452.00 6841.00 1 389
KWH Cumulative Export 5320.00 5649.00 1 329
Solar Generation
Description Date Zone Tr. IR FR MF Units
Regular Reading Point 01-09-2025 WAL E 1349.00 1741.00 1 392
Bill Details [INR] Amount(Rs.)
a) Fixed Charges Fixed Charge[FC] 285.00
b) Energy Charges Energy Charge[EC] 210.00
Auto Recovery FS[FSM] 6.00
c) Other Charges Electricity Duty[ED] 21.00
d) Total Amt.(Bill#5620250900000) (a+b+c+e) 522.00
Net Payable(d+f+g+h+i-j-k) 0.00`,
];

const SAMPLE_OCT2025_TRANSITION_PAGES = [
  `KERALA STATE ELECTRICITY BOARD LIMITED
DEMAND CUM DISCONNECTION NOTICE
Section [0000]-Electrical Section Sample Section Phone# 04000 000000
Consumer# 1156000000000 Regular CC Bill(PostPaid)
Name & Mailing Address
SAMPLE PROSUMER
Bill# 5620251000000
Billing Period 10/2025[Monthly] Tariff/Phase LT-1/Three
Bill Date 01-10-2025 Due Date 11-10-2025
Meter# MTR0SAMPLE000001
Meter Owner Customer
KWH Normal Import 100.00 150.00 1 50
KWH Normal Export 50.00 320.00 1 270
KWH Off Peak Import 200.00 340.00 1 140
KWH Off Peak Export 0.00 0.00 1 0
KWH Peak Import 50.00 100.00 1 50
KWH Peak Export 0.00 0.00 1 0`,

  `Solar Generation
Description Date Zone Tr. IR FR MF Units
Pricing Type Change 02-09-2025 WAL E 1527.00 1527.00 1 0
Regular Reading Point 01-10-2025 WNL I 1741.00 2011.00 1 270
Regular Reading Point 01-10-2025 WOP I 0.00 0.00 1 0
Regular Reading Point 01-10-2025 WPK I 0.00 0.00 1 0
Bill Details [INR] Amount(Rs.)
a) Fixed Charges Fixed Charge[FC] 260.00
f) Round Off 0.00
e) Total Amt.(Bill#5620251000000) (a+e) 260.00`,

  `Consumer No. 1156000000000 Consumer Name SAMPLE PROSUMER
Bank Opening 0 Billed Consumption 0 kWh
Bank Closing 30`,
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

  it('parses and reproduces pre-Oct 2025 cumulative 8/2025 bill (with Bank Opening & WAL)', () => {
    const { record, warnings } = parseKsebBillPages(SAMPLE_AUG2025_CUMULATIVE_PAGES, 'aug2025.pdf');

    expect(warnings).toHaveLength(0);
    expect(record.meteringMode).toBe('cumulative');
    expect(record.billingMonth).toBe('2025-08');
    expect(record.meterOwner).toBe('prosumer');
    expect(record.tariffPhase).toBe('three');
    expect(record.readings.import.NL.fr).toBe(6452);
    expect(record.readings.import.NL.units).toBe(452);
    expect(record.readings.export.NL.fr).toBe(5320);
    expect(record.readings.export.NL.units).toBe(320);
    expect(record.readings.generation.NL.fr).toBe(1349);
    expect(record.readings.generation.NL.units).toBe(349);
    expect(record.bankOpening).toBe(70);
    expect(record.bankClosing).toBe(0);
    expect(record.summary.billedUnits).toBe(62);
    expect(record.summary.totalAmount).toBe(531);

    const calc = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      billingMonth: '2025-08',
      meteringMode: 'cumulative',
      phaseType: 'three',
      meterOwner: 'prosumer',
      previousBank: 70,
      todAdjustmentMode: 'anwarbio',
      importUnits: { NL: 452, OP: 0, PK: 0 },
      exportUnits: { NL: 320, OP: 0, PK: 0 },
      solarGenUnits: { NL: 349, OP: 0, PK: 0 },
      surchargeOverride: 0.09,
    });

    expect(calc.meteringMode).toBe('cumulative');
    expect(calc.ownConsumption).toBe(29);
    expect(calc.totalUnitsForFixed).toBe(481);
    expect(calc.fixedCharge).toBe(285);
    expect(calc.billedUnits).toBe(62);
    expect(calc.updatedBank).toBe(0);
    expect(calc.energyCharge).toBe(218.5);
    expect(calc.surchargeAmount).toBe(5.58);
    expect(calc.dutyAmount).toBe(21.85);
    expect(calc.roundOff).toBe(0.07);
    expect(calc.roundedTotal).toBe(531);
  });

  it('parses single-page 9/2025 cumulative bill cleanly without CGRF bleed and reproduces 522.00', () => {
    const { record, warnings } = parseKsebBillPages(SAMPLE_SEP2025_CUMULATIVE_PAGE, 'sep2025.pdf');

    expect(warnings).toHaveLength(0);
    expect(record.meteringMode).toBe('cumulative');
    expect(record.consumerName).toBe('SAMPLE PROSUMER');
    expect(record.billingMonth).toBe('2025-09');
    expect(record.bankOpening).toBe(0);
    expect(record.bankClosing).toBe(0);
    expect(record.readings.import.NL.units).toBe(389);
    expect(record.readings.export.NL.units).toBe(329);
    expect(record.readings.generation.NL.units).toBe(392);
    expect(record.summary.billedUnits).toBe(60);
    expect(record.summary.totalAmount).toBe(522);

    const calc = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      billingMonth: '2025-09',
      meteringMode: 'cumulative',
      phaseType: 'three',
      meterOwner: 'prosumer',
      previousBank: 0,
      todAdjustmentMode: 'anwarbio',
      importUnits: { NL: 389, OP: 0, PK: 0 },
      exportUnits: { NL: 329, OP: 0, PK: 0 },
      solarGenUnits: { NL: 392, OP: 0, PK: 0 },
      surchargeOverride: 0.1,
    });

    expect(calc.ownConsumption).toBe(63);
    expect(calc.totalUnitsForFixed).toBe(452);
    expect(calc.fixedCharge).toBe(285);
    expect(calc.billedUnits).toBe(60);
    expect(calc.energyCharge).toBe(210);
    expect(calc.surchargeAmount).toBe(6);
    expect(calc.dutyAmount).toBe(21);
    expect(calc.roundedTotal).toBe(522);
  });

  it('keeps 10/2025 ToD transition bill in ToD mode despite pricing-change WAL row', () => {
    const { record, warnings } = parseKsebBillPages(SAMPLE_OCT2025_TRANSITION_PAGES, 'oct2025.pdf');

    expect(warnings).toHaveLength(0);
    expect(record.meteringMode).toBe('tod');
    expect(record.billingMonth).toBe('2025-10');
    expect(record.readings.import.NL.units).toBe(50);
    expect(record.readings.import.OP.units).toBe(140);
    expect(record.readings.import.PK.units).toBe(50);
    expect(record.readings.generation.NL.fr).toBe(2011);
    expect(record.readings.generation.NL.units).toBe(270);
    expect(record.bankClosing).toBe(30);
  });

  it('uses flat domestic non-telescopic slab rate (not ToD multipliers) above 250 units in cumulative mode', () => {
    const calc = calculateProsumerBill(BUNDLED_FALLBACK_TARIFFS, {
      billingMonth: '2025-07',
      meteringMode: 'cumulative',
      phaseType: 'three',
      meterOwner: 'prosumer',
      previousBank: 0,
      todAdjustmentMode: 'anwarbio',
      importUnits: { NL: 500, OP: 0, PK: 0 },
      exportUnits: { NL: 200, OP: 0, PK: 0 },
      solarGenUnits: { NL: 250, OP: 0, PK: 0 },
    });

    expect(calc.billedUnits).toBe(300);
    expect(calc.billingMethod).toBe('non-telescopic');
    expect(calc.todBaseRate).toBeNull();
    expect(calc.energyCharge).toBe(2025); // 300 * 6.75 flat non-telescopic rate
  });
});
