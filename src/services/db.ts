import type { AppSettings, BillRecord, CurrentReadingsDraft, TariffTables } from '../types';

const DB_NAME = 'kseb_prosumer_pwa_db';
const DB_VERSION = 1;

const DEFAULT_SUPABASE_URL = 'https://lmiemxvdwdzgllerwpel.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_v_UflmoeXe2C14wyDdHUmg_lRr9im7D';

export const DEFAULT_SETTINGS: AppSettings = {
  todAdjustmentMode: 'anwarbio',
  allowNegativeOwnConsumption: false,
  defaultPhase: 'three',
  defaultMeterOwner: 'prosumer',
  consumerNo: '',
  consumerName: '',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  supabaseAnonKey:
    import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  autoSyncOnOpen: true,
  uploadPdfToCloud: true,
  updatedAt: new Date(0).toISOString(),
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        const store = db.createObjectStore('records', { keyPath: 'id' });
        store.createIndex('by_month', 'billingMonth', { unique: false });
        store.createIndex('by_updated', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs', { keyPath: 'recordId' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txPromise<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      })
  );
}

export async function getAllRecords(includeDeleted = false): Promise<BillRecord[]> {
  const all = await txPromise<BillRecord[]>('records', 'readonly', (s) => s.getAll());
  const filtered = includeDeleted ? all : all.filter((r) => !r.deleted);
  return filtered.sort((a, b) => {
    if (a.billingMonth !== b.billingMonth) {
      return b.billingMonth.localeCompare(a.billingMonth);
    }
    if (a.recordType !== b.recordType) {
      return a.recordType === 'official_bill' ? -1 : 1;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function saveBillRecord(record: BillRecord): Promise<BillRecord> {
  const saved: BillRecord = {
    ...record,
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
  await txPromise('records', 'readwrite', (s) => s.put(saved));
  return saved;
}

export async function softDeleteBillRecord(id: string): Promise<void> {
  const existing = await txPromise<BillRecord | undefined>('records', 'readonly', (s) =>
    s.get(id)
  );
  if (!existing) return;
  const updated: BillRecord = {
    ...existing,
    deleted: true,
    updatedAt: new Date().toISOString(),
    syncStatus: existing.syncStatus === 'synced' ? 'pending' : existing.syncStatus,
  };
  await txPromise('records', 'readwrite', (s) => s.put(updated));
  await txPromise('pdfs', 'readwrite', (s) => s.delete(id));
}

export interface StoredPdfEntry {
  recordId: string;
  filename: string;
  blob: Blob;
  bytes: Uint8Array;
  updatedAt: string;
}

interface RawStoredPdfRow {
  recordId: string;
  filename: string;
  data?: ArrayBuffer;
  mimeType?: string;
  blob?: Blob;
  updatedAt: string;
}

async function toArrayBuffer(input: Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  return await input.arrayBuffer();
}

export async function savePdfBlob(
  recordId: string,
  filename: string,
  input: Blob | ArrayBuffer | Uint8Array
): Promise<void> {
  const data = await toArrayBuffer(input);
  if (data.byteLength === 0) {
    throw new Error('Selected PDF file is empty (0 bytes). Please choose the PDF again.');
  }
  await txPromise('pdfs', 'readwrite', (s) =>
    s.put({
      recordId,
      filename,
      data,
      mimeType: 'application/pdf',
      updatedAt: new Date().toISOString(),
    })
  );
}

export async function getPdfBlob(recordId: string): Promise<StoredPdfEntry | undefined> {
  const row = await txPromise<RawStoredPdfRow | undefined>('pdfs', 'readonly', (s) =>
    s.get(recordId)
  );
  if (!row) return undefined;

  let buf: ArrayBuffer | null = null;
  if (row.data instanceof ArrayBuffer) {
    buf = row.data;
  } else if (row.blob) {
    try {
      buf = await row.blob.arrayBuffer();
    } catch {
      buf = null;
    }
  }

  if (!buf || buf.byteLength === 0) {
    return undefined;
  }

  return {
    recordId: row.recordId,
    filename: row.filename,
    bytes: new Uint8Array(buf),
    blob: new Blob([buf], { type: row.mimeType || 'application/pdf' }),
    updatedAt: row.updatedAt,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const row = await txPromise<{ key: string; value: AppSettings } | undefined>(
    'meta',
    'readonly',
    (s) => s.get('settings')
  );
  const merged = row ? { ...DEFAULT_SETTINGS, ...row.value } : { ...DEFAULT_SETTINGS };
  if (!merged.supabaseUrl && DEFAULT_SETTINGS.supabaseUrl) {
    merged.supabaseUrl = DEFAULT_SETTINGS.supabaseUrl;
  }
  if (!merged.supabaseAnonKey && DEFAULT_SETTINGS.supabaseAnonKey) {
    merged.supabaseAnonKey = DEFAULT_SETTINGS.supabaseAnonKey;
  }
  return merged;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const updated = { ...settings, updatedAt: new Date().toISOString() };
  await txPromise('meta', 'readwrite', (s) => s.put({ key: 'settings', value: updated }));
  return updated;
}

export async function getCachedTariffs(): Promise<TariffTables | null> {
  const row = await txPromise<{ key: string; value: TariffTables } | undefined>(
    'meta',
    'readonly',
    (s) => s.get('tariffs')
  );
  return row ? row.value : null;
}

export async function saveCachedTariffs(tables: TariffTables): Promise<void> {
  await txPromise('meta', 'readwrite', (s) => s.put({ key: 'tariffs', value: tables }));
}

export async function getReadingsDraft(): Promise<CurrentReadingsDraft | null> {
  const row = await txPromise<{ key: string; value: CurrentReadingsDraft } | undefined>(
    'meta',
    'readonly',
    (s) => s.get('draft')
  );
  return row ? row.value : null;
}

export async function saveReadingsDraft(draft: CurrentReadingsDraft): Promise<void> {
  await txPromise('meta', 'readwrite', (s) => s.put({ key: 'draft', value: draft }));
}

export async function clearReadingsDraft(): Promise<void> {
  await txPromise('meta', 'readwrite', (s) => s.delete('draft'));
}

export function pickBaselineRecord(
  records: BillRecord[],
  preferredId?: string
): BillRecord | null {
  const active = records.filter((r) => !r.deleted);
  if (active.length === 0) return null;

  if (preferredId) {
    const match = active.find((r) => r.id === preferredId);
    if (match) return match;
  }

  // Prefer the latest uploaded official KSEB bill so FR auto-fills from the real bill
  const officialBills = active
    .filter((r) => r.recordType === 'official_bill')
    .sort((a, b) => b.billingMonth.localeCompare(a.billingMonth));
  if (officialBills.length > 0) return officialBills[0];

  return active[0];
}

export async function exportDatabaseBackupJSON(): Promise<string> {
  const [records, settings] = await Promise.all([getAllRecords(false), getSettings()]);
  const pdfEntries: { recordId: string; filename: string; base64: string }[] = [];
  for (const r of records) {
    if (r.hasLocalPdf) {
      const pdf = await getPdfBlob(r.id);
      if (pdf?.blob) {
        const base64 = await blobToDataUrl(pdf.blob);
        pdfEntries.push({ recordId: pdf.recordId, filename: pdf.filename, base64 });
      }
    }
  }
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        ...settings,
        supabaseAnonKey: '', // omit key from portable export unless user re-enters
      },
      records,
      pdfs: pdfEntries,
    },
    null,
    2
  );
}

export async function importDatabaseBackupJSON(jsonText: string): Promise<number> {
  const parsed = JSON.parse(jsonText);
  if (!parsed || !Array.isArray(parsed.records)) {
    throw new Error('Invalid backup JSON format');
  }
  let count = 0;
  for (const rec of parsed.records as BillRecord[]) {
    await saveBillRecord({
      ...rec,
      syncStatus: rec.syncStatus === 'synced' ? 'pending' : rec.syncStatus || 'pending',
    });
    count++;
  }
  if (Array.isArray(parsed.pdfs)) {
    for (const p of parsed.pdfs as { recordId: string; filename: string; base64: string }[]) {
      const res = await fetch(p.base64);
      const blob = await res.blob();
      await savePdfBlob(p.recordId, p.filename, blob);
    }
  }
  return count;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
