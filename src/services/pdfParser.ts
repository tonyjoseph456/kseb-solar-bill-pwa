import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  BillRecord,
  MeteringMode,
  MeterOwner,
  MeterSnapshotReadings,
  PhaseType,
  ZoneMeterReading,
} from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ParsedKsebPdfResult {
  record: BillRecord;
  warnings: string[];
  rawTextPreview: string;
}

interface PdfTextItemLike {
  str: string;
  transform: number[];
}

function cleanNum(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function makeEmptyZone(): ZoneMeterReading {
  return { ir: 0, fr: 0, mf: 1, units: 0 };
}

/**
 * Reconstructs visual lines per PDF page by grouping text items with close Y coordinates
 * and sorting left-to-right by X coordinate.
 */
export function groupTextItemsIntoLines(items: PdfTextItemLike[]): string[] {
  const tokens = items
    .filter((item) => item.str && item.str.trim().length > 0)
    .map((item) => ({
      str: item.str.trim(),
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }));

  // Sort top-to-bottom (higher Y first in PDF coordinates), then left-to-right
  tokens.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 3.5) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: { y: number; items: typeof tokens }[] = [];
  for (const tok of tokens) {
    const existing = rows.find((r) => Math.abs(r.y - tok.y) <= 3.5);
    if (existing) {
      existing.items.push(tok);
    } else {
      rows.push({ y: tok.y, items: [tok] });
    }
  }

  return rows.map((row) =>
    row.items
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Parses extracted text pages from a KSEB OrumaNET Prosumer PDF bill into a structured BillRecord.
 */
export function parseKsebBillPages(
  pageTexts: string[],
  filename = 'kseb-bill.pdf'
): ParsedKsebPdfResult {
  const fullText = pageTexts.join('\n');
  const warnings: string[] = [];

  // 1. Metadata
  const consumerMatch =
    fullText.match(/Consumer#\s*(\d{10,15})/i) ||
    fullText.match(/Consumer\s*No\.?\s*:?\s*(\d{10,15})/i);
  const consumerNo = consumerMatch?.[1] ?? '';
  if (!consumerNo) warnings.push('Consumer number not found automatically.');

  const billNoMatch = fullText.match(/Bill#\s*(\d{8,20})/i);
  const billNo = billNoMatch?.[1] ?? '';

  const periodMatch = fullText.match(/Billing\s*Period\s*(\d{1,2})\/(\d{4})/i);
  let billingMonth = '';
  let billingLabel = '';
  if (periodMatch) {
    const mm = periodMatch[1].padStart(2, '0');
    const yyyy = periodMatch[2];
    billingMonth = `${yyyy}-${mm}`;
    billingLabel = `${mm}/${yyyy}`;
  } else {
    const bankPeriodMatch = fullText.match(/Bank\s*Statement\s*for\s*(\d{4})(\d{2})/i);
    if (bankPeriodMatch) {
      billingMonth = `${bankPeriodMatch[1]}-${bankPeriodMatch[2]}`;
      billingLabel = `${bankPeriodMatch[2]}/${bankPeriodMatch[1]}`;
    } else {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = String(now.getFullYear());
      billingMonth = `${yyyy}-${mm}`;
      billingLabel = `${mm}/${yyyy}`;
      warnings.push('Billing Period not detected; defaulted to current month.');
    }
  }

  // Consumer Name: Page 3 "Consumer Name SAMPLE PROSUMER" or Page 1 after "Name & Mailing Address"
  let consumerName = '';
  const page3Name = fullText.match(/Consumer\s*Name\s+([A-Z][A-Z\s.]{1,40}?)(?:\n|SPIN|$)/i);
  if (page3Name) {
    consumerName = page3Name[1].trim();
  } else {
    const page1Name = fullText.match(/Name\s*&\s*Mailing\s*Address[^\n]*\n\s*([^\n]+)/i);
    if (page1Name) {
      consumerName = page1Name[1]
        .replace(/\s+(?:South|Central|North|State\s+Electricity\s+Ombudsman)\s*:.*$/i, '')
        .trim();
    }
  }

  const sectionMatch = fullText.match(/Section\s+([^\n]+?)(?:\s+Phone#|\n|$)/i);
  const section = sectionMatch?.[1]?.trim() ?? '';

  const billDateMatch = fullText.match(/Bill\s*Date\s*(\d{2}-\d{2}-\d{4})/i);
  const billDate = billDateMatch?.[1] ?? '';

  const dueDateMatch = fullText.match(/Due\s*Date\s*(\d{2}-\d{2}-\d{4})/i);
  const dueDate = dueDateMatch?.[1] ?? '';

  const phaseMatch = fullText.match(/Tariff\/Phase\s*[^\s/]+\s*\/\s*(Three|Single)/i);
  const tariffPhase: PhaseType =
    phaseMatch && /single/i.test(phaseMatch[1]) ? 'single' : 'three';

  const ownerMatch = fullText.match(
    /Meter\s*(?:Owner|Type\s*\/\s*Owner)\s*(?:[^/\n]+\/\s*)?(Customer|Prosumer|KSEB|Board)/i
  );
  const meterOwner: MeterOwner =
    ownerMatch && /kseb|board/i.test(ownerMatch[1]) ? 'kseb' : 'prosumer';

  const meterNoMatch = fullText.match(/Meter#\s*([A-Z0-9]+)/i);
  const meterNumber = meterNoMatch?.[1] ?? '';

  const loadMatch = fullText.match(/Connected\s*Load\s*([\d,.]+)\s*Watts/i);
  const connectedLoadWatts = loadMatch ? cleanNum(loadMatch[1]) : undefined;

  const plantMatch = fullText.match(/Plant\s*Capacity\s*([\d.]+)\s*KW/i);
  const plantCapacityKw = plantMatch ? cleanNum(plantMatch[1]) : undefined;

  // 2. Net Meter Readings (Page 1)
  const readings: MeterSnapshotReadings = {
    import: { NL: makeEmptyZone(), OP: makeEmptyZone(), PK: makeEmptyZone() },
    export: { NL: makeEmptyZone(), OP: makeEmptyZone(), PK: makeEmptyZone() },
    generation: { NL: makeEmptyZone(), OP: makeEmptyZone(), PK: makeEmptyZone() },
  };

  const netMeterConfigs: {
    zone: 'NL' | 'OP' | 'PK';
    zoneLabel: string;
    trading: 'import' | 'export';
    tradingLabel: string;
  }[] = [
    { zone: 'NL', zoneLabel: 'Normal', trading: 'import', tradingLabel: 'Import' },
    { zone: 'NL', zoneLabel: 'Normal', trading: 'export', tradingLabel: 'Export' },
    { zone: 'OP', zoneLabel: 'Off\\s*Peak', trading: 'import', tradingLabel: 'Import' },
    { zone: 'OP', zoneLabel: 'Off\\s*Peak', trading: 'export', tradingLabel: 'Export' },
    { zone: 'PK', zoneLabel: 'Peak', trading: 'import', tradingLabel: 'Import' },
    { zone: 'PK', zoneLabel: 'Peak', trading: 'export', tradingLabel: 'Export' },
  ];

  let netRowsMatched = 0;
  for (const cfg of netMeterConfigs) {
    const re = new RegExp(
      `^\\s*(?:KWH\\s+)?${cfg.zoneLabel}\\s+${cfg.tradingLabel}\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d.]+)\\s+([\\d,]+(?:\\.\\d+)?)`,
      'im'
    );
    const m = fullText.match(re);
    if (m) {
      readings[cfg.trading][cfg.zone] = {
        ir: cleanNum(m[1]),
        fr: cleanNum(m[2]),
        mf: cleanNum(m[3]) || 1,
        units: cleanNum(m[4]),
      };
      netRowsMatched++;
    }
  }
  let meteringMode: MeteringMode = 'tod';
  let cumRowsMatched = 0;
  if (netRowsMatched === 0) {
    const cumConfigs: { trading: 'import' | 'export'; tradingLabel: string }[] = [
      { trading: 'import', tradingLabel: 'Import' },
      { trading: 'export', tradingLabel: 'Export' },
    ];
    for (const cfg of cumConfigs) {
      const re = new RegExp(
        `^\\s*(?:KWH\\s+)?Cumulative\\s+${cfg.tradingLabel}\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d.]+)\\s+([\\d,]+(?:\\.\\d+)?)`,
        'im'
      );
      const m = fullText.match(re);
      if (m) {
        readings[cfg.trading].NL = {
          ir: cleanNum(m[1]),
          fr: cleanNum(m[2]),
          mf: cleanNum(m[3]) || 1,
          units: cleanNum(m[4]),
        };
        cumRowsMatched++;
      }
    }
    if (cumRowsMatched > 0 || /Power\s*Unit\/Zone\s*CUMULATIVE/i.test(fullText)) {
      meteringMode = 'cumulative';
    }
  }

  if (meteringMode === 'cumulative') {
    if (cumRowsMatched < 2) {
      warnings.push(
        `Only ${cumRowsMatched}/2 Cumulative Net Meter rows matched automatically. Please verify values below.`
      );
    }
  } else if (netRowsMatched < 6) {
    warnings.push(
      `Only ${netRowsMatched}/6 Net Meter rows matched automatically. Please verify values below.`
    );
  }

  // 3. Solar Generation Readings (Page 2: WNL, WOP, WPK or pre-Oct-2025 WAL)
  const solarConfigs: { zone: 'NL' | 'OP' | 'PK'; code: string }[] = [
    { zone: 'NL', code: 'WNL' },
    { zone: 'OP', code: 'WOP' },
    { zone: 'PK', code: 'WPK' },
  ];

  let solarRowsMatched = 0;
  for (const cfg of solarConfigs) {
    const re = new RegExp(
      `${cfg.code}\\s+(?:[IE]\\s+)?([\\d,]+(?:\\.\\d+)?)\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d.]+)\\s+([\\d,]+(?:\\.\\d+)?)`,
      'i'
    );
    const m = fullText.match(re);
    if (m) {
      readings.generation[cfg.zone] = {
        ir: cleanNum(m[1]),
        fr: cleanNum(m[2]),
        mf: cleanNum(m[3]) || 1,
        units: cleanNum(m[4]),
      };
      solarRowsMatched++;
    }
  }
  if (solarRowsMatched === 0 && meteringMode === 'cumulative') {
    const walMatch = fullText.match(
      /\bWAL\s+(?:[IE]\s+)?([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)\s+([\d,]+(?:\.\d+)?)/i
    );
    if (walMatch) {
      readings.generation.NL = {
        ir: cleanNum(walMatch[1]),
        fr: cleanNum(walMatch[2]),
        mf: cleanNum(walMatch[3]) || 1,
        units: cleanNum(walMatch[4]),
      };
    } else {
      warnings.push('Cumulative Solar Generation row (WAL) did not match automatically.');
    }
  } else if (solarRowsMatched < 3) {
    warnings.push(
      `Only ${solarRowsMatched}/3 Solar Generation rows (WNL/WOP/WPK) matched automatically.`
    );
  }

  // 4. Bank Opening & Closing (Page 3)
  const bankOpenMatch = fullText.match(/Bank\s*Opening\s+([\d,]+(?:\.\d+)?)/i);
  const bankCloseMatch = fullText.match(/Bank\s*Closing\s+([\d,]+(?:\.\d+)?)/i);
  const bankOpening = bankOpenMatch ? cleanNum(bankOpenMatch[1]) : 0;
  const bankClosing = bankCloseMatch ? cleanNum(bankCloseMatch[1]) : 0;

  // 5. Financial Bill Details (Page 2)
  const fcMatch = fullText.match(/Fixed\s*Charge\[FC\]\s*([-\d,]+\.\d{2})/i);
  const ecMatch = fullText.match(/Energy\s*Charge\[EC\]\s*([-\d,]+\.\d{2})/i);
  const fsmMatch = fullText.match(
    /(?:Auto\s*Recovery\s*FS\[FSM\]|Fuel\s*Surcharge(?:\[[^\]]+\])?)\s*([-\d,]+\.\d{2})/i
  );
  const edMatch = fullText.match(/Electricity\s*Duty\[ED\]\s*([-\d,]+\.\d{2})/i);
  const roundMatch = fullText.match(/Round\s*Off\s*([-\d,]+\.\d{2})/i);
  const totalMatch = fullText.match(
    /Total\s*Amt\.?\([^)]*\)\s*(?:\([^)]*\))?\s*([-\d,]+\.\d{2})/i
  );
  const netPayableMatch = fullText.match(/Net\s*Payable\([^)]*\)\s*([-\d,]+\.\d{2})/i);

  const fixedCharge = fcMatch ? cleanNum(fcMatch[1]) : 0;
  const energyCharge = ecMatch ? cleanNum(ecMatch[1]) : 0;
  const fuelSurcharge = fsmMatch ? cleanNum(fsmMatch[1]) : 0;
  const electricityDuty = edMatch ? cleanNum(edMatch[1]) : 0;
  const roundOff = roundMatch ? cleanNum(roundMatch[1]) : 0;
  const totalAmount = totalMatch
    ? cleanNum(totalMatch[1])
    : Math.round(fixedCharge + energyCharge + fuelSurcharge + electricityDuty);
  const netPayable = netPayableMatch ? cleanNum(netPayableMatch[1]) : undefined;

  const totalImport =
    readings.import.NL.units + readings.import.OP.units + readings.import.PK.units;
  const totalExport =
    readings.export.NL.units + readings.export.OP.units + readings.export.PK.units;
  const solarGenerated =
    readings.generation.NL.units +
    readings.generation.OP.units +
    readings.generation.PK.units;
  const ownConsumption = Math.max(0, solarGenerated - totalExport);

  const billedConsMatch = fullText.match(/Billed\s*Consumption\s+([\d,]+)\s*kWh/i);
  const billedUnits = billedConsMatch
    ? cleanNum(billedConsMatch[1])
    : Math.max(0, totalImport - totalExport - bankOpening);

  const nowIso = new Date().toISOString();
  const id = `official_${consumerNo || 'kseb'}_${billingMonth}`;

  const record: BillRecord = {
    id,
    recordType: 'official_bill',
    billingMonth,
    billingLabel,
    consumerNo,
    consumerName,
    billNo,
    billDate,
    dueDate,
    section,
    meterNumber,
    tariffPhase,
    meterOwner,
    connectedLoadWatts,
    plantCapacityKw,
    bankOpening,
    bankClosing,
    readings,
    summary: {
      totalImport,
      totalExport,
      solarGenerated,
      ownConsumption,
      netImportBeforeBank: Math.max(0, totalImport - totalExport),
      netExport: Math.max(0, totalExport - totalImport),
      billedUnits,
      fixedCharge,
      fixedSlabLabel: 'Official KSEB Bill',
      energyCharge,
      fuelSurcharge,
      electricityDuty,
      meterRent: 0,
      roundOff,
      unroundedTotal: Number(
        (fixedCharge + energyCharge + fuelSurcharge + electricityDuty).toFixed(2)
      ),
      totalAmount,
      netPayable,
    },
    meteringMode,
    tariffSource: 'Official KSEB OrumaNET PDF',
    pdfFilename: filename,
    hasLocalPdf: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    syncStatus: 'pending',
  };

  return {
    record,
    warnings,
    rawTextPreview: fullText.slice(0, 2500),
  };
}

export async function parseKsebPdfFile(file: File): Promise<ParsedKsebPdfResult> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = groupTextItemsIntoLines(content.items as PdfTextItemLike[]);
    pageTexts.push(lines.join('\n'));
  }

  return parseKsebBillPages(pageTexts, file.name);
}
