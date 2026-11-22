import type {
  FixedChargeRow,
  MeterChargeRow,
  NonTelescopicSlabRow,
  OtherChargeRow,
  TariffTables,
  TelescopicSlabRow,
  TodBaseRateRow,
} from '../types';

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/anwarbio/kseb-bill-calculator/main/';
const GITHUB_PAGES_BASE = 'https://anwarbio.github.io/kseb-bill-calculator/';

const CSV_FILES = {
  fixedCharge: 'fixed_charge.csv',
  meterCharges: 'meter_charges.csv',
  otherCharges: 'other_charges.csv',
  telescopic: 'tariff_domestic_telescopic.csv',
  nonTelescopic: 'tariff_domestic_nontelescopic.csv',
  todRates: 'tariff_tod.csv',
  todBase: 'tariff_tod_base.csv',
} as const;

export const SHORT_MONTHS = [
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

export function parseFixedChargesCSV(text: string): FixedChargeRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [slab, single, three] = line.split(',');
      let min = 0;
      let max = Infinity;
      if (slab.includes('-')) {
        const [a, b] = slab.split('-').map((n) => Number(n.trim()));
        min = a;
        max = b;
      } else if (/above/i.test(slab)) {
        const m = slab.match(/\d+/);
        min = m ? parseInt(m[0], 10) + 1 : 501;
        // Note: anwarbio sets min = parseInt(slab.match(/\d+/)[0]) = 500, checked after 0-500 row
        if (m) min = parseInt(m[0], 10);
      }
      return {
        min,
        max,
        label: slab.trim(),
        single: parseFloat(single),
        three: parseFloat(three),
      };
    });
}

export function parseMeterChargesCSV(text: string): MeterChargeRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [label, single, three] = line.split(',');
      return {
        label: label.trim(),
        single: parseFloat(single),
        three: parseFloat(three),
      };
    });
}

export function parseOtherChargesCSV(text: string): OtherChargeRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [year, month, label, duty, surcharge] = line.split(',');
      const parsedDuty = parseFloat((duty ?? '').trim());
      const rawSurcharge = (surcharge ?? '').trim();
      const parsedSurcharge = rawSurcharge === '' ? null : parseFloat(rawSurcharge);
      return {
        year: parseInt(year.trim(), 10),
        month: month.trim(),
        label: label.trim(),
        duty: Number.isFinite(parsedDuty) ? parsedDuty : 10,
        surcharge:
          parsedSurcharge !== null && Number.isFinite(parsedSurcharge) ? parsedSurcharge : null,
      };
    });
}

export function parseTelescopicSlabsCSV(text: string): TelescopicSlabRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [range, rate] = line.split(',');
      const upper = parseInt(
        range.split('-')[1] || (range.match(/\d+/g) || ['0'])[0],
        10
      );
      return { limit: upper, rate: parseFloat(rate) };
    });
}

export function parseNonTelescopicSlabsCSV(text: string): NonTelescopicSlabRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [range, rate] = line.split(',').map((v) => v.trim());
      if (/above/i.test(range)) {
        return { upper: Infinity, rate: parseFloat(rate) };
      }
      const nums = range.match(/\d+/g);
      const upper = nums && nums.length > 1 ? parseInt(nums[1], 10) : 0;
      return { upper, rate: parseFloat(rate) };
    });
}

export function parseTodRatesCSV(text: string): { nl: number; op: number; pk: number } {
  const result = { nl: 0.9, op: 1, pk: 1.25 };
  text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .forEach((line) => {
      const [label, rate] = line.split(',');
      const key = label.trim().toLowerCase();
      const val = parseFloat(rate);
      if (key === 'nl' && Number.isFinite(val)) result.nl = val;
      if (key === 'op' && Number.isFinite(val)) result.op = val;
      if (key === 'pk' && Number.isFinite(val)) result.pk = val;
    });
  return result;
}

export function parseTodBaseCSV(text: string): TodBaseRateRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [range, base] = line.split(',').map((v) => v.trim());
      if (/above/i.test(range)) {
        return { upper: Infinity, base: parseFloat(base) };
      }
      const nums = range.match(/\d+/g);
      const upper = nums && nums.length > 1 ? parseInt(nums[1], 10) : 0;
      return { upper, base: parseFloat(base) };
    });
}

export function buildTariffTablesFromRawCSVs(
  csvMap: Record<keyof typeof CSV_FILES, string>,
  source: TariffTables['source'],
  sourceUrls: string[],
  constants = { nonTelStartUnit: 250, prosTodStartUnit: 250, conTodStartUnit: 500 }
): TariffTables {
  return {
    fixedCharges: parseFixedChargesCSV(csvMap.fixedCharge),
    meterCharges: parseMeterChargesCSV(csvMap.meterCharges),
    otherCharges: parseOtherChargesCSV(csvMap.otherCharges),
    domesticTelescopic: parseTelescopicSlabsCSV(csvMap.telescopic),
    domesticNonTelescopic: parseNonTelescopicSlabsCSV(csvMap.nonTelescopic),
    todMultipliers: parseTodRatesCSV(csvMap.todRates),
    todBaseRates: parseTodBaseCSV(csvMap.todBase),
    constants,
    fetchedAt: new Date().toISOString(),
    source,
    sourceUrls,
  };
}

// Verified baseline snapshot from anwarbio/kseb-bill-calculator (2025-2027 tariff circular)
const FALLBACK_CSVS: Record<keyof typeof CSV_FILES, string> = {
  fixedCharge: `Monthly consumption slab,Single Phase ,Three Phase
0-50,50,130
51-100,85,175
101-150,105,205
151-200,140,215
201-250,160,235
0-300,220,240
0-350,240,250
0-400,260,260
0-500,285,285
Above 500 ,310,310`,
  meterCharges: `label,single,three
LT1_Prosumer,30,35
Consumer,6,15`,
  otherCharges: `year,month,label,duty,surcharge
2025,Dec,LT1,10,0.05
2026,Jan,LT1,10,0.08
2026,Feb,LT1,10,0
2026,Mar,LT1,10,-0.02
2026,Apr,LT1,10,0
2026,May,LT1,10,0.01
2026,Jun,LT1,10,0.02
2026,Jul,LT1,10,0
2026,Aug,LT1,10,0
2026,Sep,LT1,10,0.03
2026,Oct,LT1,10,0.03
2026,Nov,LT1,10,0.05
2026,Dec,LT1,10,`,
  telescopic: `Units,Charge
0-50,3.35
51-100,4.25
101-150,5.35
151-200,7.2
201-250,8.5`,
  nonTelescopic: `Units,Charge
0-300,6.75
0-350,7.6
0-400,7.95
0-500,8.25
Above 500,9.2`,
  todRates: `Zone,Rate
NL,0.9
PK,1.25
OP,1`,
  todBase: `Units,Base Rate
0-300,6.75
0-350,7.6
0-400,7.95
0-500,8.25
Above 500,9.2`,
};

export const BUNDLED_FALLBACK_TARIFFS: TariffTables = buildTariffTablesFromRawCSVs(
  FALLBACK_CSVS,
  'bundled-fallback',
  []
);

async function fetchTextWithTimeout(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchThresholdsFromHtml(baseUrl: string): Promise<{
  nonTelStartUnit: number;
  prosTodStartUnit: number;
  conTodStartUnit: number;
} | null> {
  try {
    const html = await fetchTextWithTimeout(`${baseUrl}index.html`, 6000);
    const nonTel = html.match(/NonTelStartUnit\s*=\s*(\d+)/);
    const prosTod = html.match(/ProsTODStartUnit\s*=\s*(\d+)/);
    const conTod = html.match(/ConTODStartUnit\s*=\s*(\d+)/);
    if (nonTel && prosTod && conTod) {
      return {
        nonTelStartUnit: parseInt(nonTel[1], 10),
        prosTodStartUnit: parseInt(prosTod[1], 10),
        conTodStartUnit: parseInt(conTod[1], 10),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchFromBase(
  baseUrl: string,
  source: 'github-raw' | 'github-pages'
): Promise<TariffTables> {
  const entries = Object.entries(CSV_FILES) as [keyof typeof CSV_FILES, string][];
  const urls = entries.map(([, file]) => `${baseUrl}${file}`);

  const [texts, thresholds] = await Promise.all([
    Promise.all(urls.map((u) => fetchTextWithTimeout(u))),
    fetchThresholdsFromHtml(baseUrl),
  ]);

  const csvMap = {} as Record<keyof typeof CSV_FILES, string>;
  entries.forEach(([key], idx) => {
    csvMap[key] = texts[idx];
  });

  return buildTariffTablesFromRawCSVs(
    csvMap,
    source,
    urls,
    thresholds ?? { nonTelStartUnit: 250, prosTodStartUnit: 250, conTodStartUnit: 500 }
  );
}

/**
 * Fetches the latest tariff CSVs directly from anwarbio/kseb-bill-calculator
 * (GitHub raw first, falling back to GitHub Pages).
 */
export async function fetchLatestTariffsFromGitHub(): Promise<TariffTables> {
  try {
    return await fetchFromBase(GITHUB_RAW_BASE, 'github-raw');
  } catch (rawErr) {
    console.warn('GitHub raw fetch failed, trying GitHub Pages mirror:', rawErr);
    return await fetchFromBase(GITHUB_PAGES_BASE, 'github-pages');
  }
}
