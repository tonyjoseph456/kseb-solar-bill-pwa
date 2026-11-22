import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { AppSettings, BillRecord } from '../types';
import {
  getAllRecords,
  getPdfBlob,
  saveBillRecord,
  savePdfBlob,
  type StoredPdfEntry,
} from './db';

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey = '';

export function getSupabaseClient(url: string, anonKey: string): SupabaseClient | null {
  const trimmedUrl = url.trim();
  const trimmedKey = anonKey.trim();
  if (!trimmedUrl || !trimmedKey) return null;

  const key = `${trimmedUrl}::${trimmedKey}`;
  if (cachedClient && cachedConfigKey === key) {
    return cachedClient;
  }

  cachedClient = createClient(trimmedUrl, trimmedKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  cachedConfigKey = key;
  return cachedClient;
}

export function formatCloudUserLabel(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const handle =
    typeof meta?.user_name === 'string'
      ? meta.user_name
      : typeof meta?.preferred_username === 'string'
      ? meta.preferred_username
      : null;
  return user.email || (handle ? `@${handle}` : 'Signed-in User');
}

export function subscribeCloudAuth(
  settings: AppSettings,
  onUserChange: (user: User | null, event: string) => void
): () => void {
  const client = getSupabaseClient(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!client) return () => {};
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    onUserChange(session?.user ?? null, event);
  });
  return () => subscription.unsubscribe();
}

export async function getCurrentCloudUser(settings: AppSettings): Promise<User | null> {
  const client = getSupabaseClient(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

export async function signInCloud(
  settings: AppSettings,
  email: string,
  password: string
): Promise<User> {
  const client = getSupabaseClient(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!client) throw new Error('Enter Supabase URL and Anon Key first.');

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign in did not return a user.');
  return data.user;
}

export async function signUpCloud(
  settings: AppSettings,
  email: string,
  password: string
): Promise<{ user: User | null; needsConfirmation: boolean }> {
  const client = getSupabaseClient(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!client) throw new Error('Enter Supabase URL and Anon Key first.');

  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : undefined;

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  });
  if (error) throw error;
  return {
    user: data.user,
    needsConfirmation: !data.session,
  };
}

export async function signInWithGitHubCloud(settings: AppSettings): Promise<void> {
  const client = getSupabaseClient(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!client) throw new Error('Enter Supabase URL and Publishable/Anon Key first.');

  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : undefined;

  const { error } = await client.auth.signInWithOAuth({
    provider: 'github',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
}

export async function signOutCloud(settings: AppSettings): Promise<void> {
  const client = getSupabaseClient(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!client) return;
  await client.auth.signOut();
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  pdfsUploaded: number;
  pdfsDownloaded: number;
  pdfErrors: string[];
  syncedAt: string;
}

export async function downloadPdfFromCloud(
  settings: AppSettings,
  record: BillRecord
): Promise<StoredPdfEntry> {
  if (!record.pdfStoragePath) {
    throw new Error('This PDF was not uploaded to cloud storage yet.');
  }
  const client = getSupabaseClient(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!client) {
    throw new Error('Cloud sync is not configured.');
  }
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) {
    throw new Error('Sign in with GitHub in Settings to download synced PDFs.');
  }

  const { data: pdfBlob, error } = await client.storage
    .from('bill-pdfs')
    .download(record.pdfStoragePath);
  if (error || !pdfBlob) {
    throw new Error(error?.message || 'Failed to download PDF from cloud storage.');
  }

  const filename = record.pdfFilename || `${record.billingMonth}.pdf`;
  await savePdfBlob(record.id, filename, pdfBlob);
  await saveBillRecord({ ...record, hasLocalPdf: true });
  const stored = await getPdfBlob(record.id);
  if (!stored) {
    throw new Error('Downloaded PDF was empty.');
  }
  return stored;
}

export async function syncWithSupabase(settings: AppSettings): Promise<SyncReport> {
  const client = getSupabaseClient(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!client) throw new Error('Supabase URL / Anon Key not configured.');

  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData.user) {
    throw new Error('Please sign in to your Supabase account to sync.');
  }
  const userId = userData.user.id;

  const localRecords = await getAllRecords(true);
  const localById = new Map(localRecords.map((r) => [r.id, r]));

  // 1. Pull remote records
  const { data: remoteRows, error: pullErr } = await client
    .from('bill_records')
    .select('id, payload, deleted, updated_at');
  if (pullErr) throw pullErr;

  let pulled = 0;
  let pdfsDownloaded = 0;
  const pdfErrors: string[] = [];
  const remoteById = new Map<
    string,
    { payload: BillRecord; deleted: boolean; updated_at: string }
  >();

  for (const row of remoteRows ?? []) {
    const payload = row.payload as BillRecord;
    remoteById.set(row.id, {
      payload,
      deleted: Boolean(row.deleted),
      updated_at: row.updated_at,
    });

    const local = localById.get(row.id);
    const remoteTime = Date.parse(row.updated_at || payload.updatedAt || '0');
    const localTime = local ? Date.parse(local.updatedAt || '0') : -1;

    if (!local || remoteTime > localTime) {
      const existingPdf = !row.deleted ? await getPdfBlob(row.id) : undefined;
      let merged: BillRecord = {
        ...payload,
        hasLocalPdf: Boolean(existingPdf),
        deleted: Boolean(row.deleted),
        syncStatus: 'synced',
        updatedAt: row.updated_at || payload.updatedAt,
      };

      // Download PDF from Supabase Storage if missing locally
      if (!merged.deleted && merged.pdfStoragePath && !existingPdf) {
        try {
          const { data: pdfBlob, error: dlErr } = await client.storage
            .from('bill-pdfs')
            .download(merged.pdfStoragePath);
          if (!dlErr && pdfBlob) {
            await savePdfBlob(
              merged.id,
              merged.pdfFilename || `${merged.billingMonth}.pdf`,
              pdfBlob
            );
            merged = { ...merged, hasLocalPdf: true };
            pdfsDownloaded++;
          } else if (dlErr) {
            pdfErrors.push(`${merged.billingLabel}: ${dlErr.message}`);
          }
        } catch (err) {
          pdfErrors.push(
            `${merged.billingLabel}: ${err instanceof Error ? err.message : 'PDF download failed'}`
          );
        }
      }

      await saveBillRecord(merged);
      localById.set(row.id, merged);
      pulled++;
    }
  }

  // 2. Push newer or unsynced local records (or heal records whose local PDF isn't in cloud yet)
  let pushed = 0;
  let pdfsUploaded = 0;
  for (const local of localById.values()) {
    const remote = remoteById.get(local.id);
    const remoteTime = remote
      ? Date.parse(remote.updated_at || remote.payload.updatedAt || '0')
      : -1;
    const localTime = Date.parse(local.updatedAt || '0');

    const localPdf = !local.deleted ? await getPdfBlob(local.id) : undefined;
    const needsPdfUpload =
      settings.uploadPdfToCloud &&
      !local.deleted &&
      Boolean(localPdf) &&
      !local.pdfStoragePath;

    const needsPush =
      !remote ||
      local.syncStatus === 'pending' ||
      local.syncStatus === 'local' ||
      localTime > remoteTime ||
      needsPdfUpload;

    if (!needsPush) continue;

    let pdfStoragePath = local.pdfStoragePath;
    let pdfUploadFailed = false;
    if (needsPdfUpload && localPdf) {
      const path = `${userId}/${local.id}.pdf`;
      // Pass Uint8Array bytes directly so storage-js sends binary body instead of FormData
      // (avoids iOS Safari FormData 0-byte Content-Length bug on IDB File/Blob objects).
      const { error: upErr } = await client.storage
        .from('bill-pdfs')
        .upload(path, localPdf.bytes, { upsert: true, contentType: 'application/pdf' });
      if (!upErr) {
        pdfStoragePath = path;
        pdfsUploaded++;
      } else {
        pdfUploadFailed = true;
        pdfErrors.push(`${local.billingLabel}: ${upErr.message}`);
      }
    }

    const remotePayload: BillRecord = {
      ...local,
      hasLocalPdf: false,
      pdfStoragePath,
      syncStatus: 'synced',
    };

    const { error: upsertErr } = await client.from('bill_records').upsert({
      id: local.id,
      user_id: userId,
      record_type: local.recordType,
      billing_month: local.billingMonth,
      consumer_no: local.consumerNo,
      payload: remotePayload,
      deleted: Boolean(local.deleted),
      updated_at: local.updatedAt,
    });

    if (upsertErr) throw upsertErr;
    await saveBillRecord({
      ...local,
      hasLocalPdf: Boolean(localPdf),
      pdfStoragePath,
      syncStatus: pdfUploadFailed ? 'pending' : 'synced',
    });
    pushed++;
  }

  return {
    pushed,
    pulled,
    pdfsUploaded,
    pdfsDownloaded,
    pdfErrors,
    syncedAt: new Date().toISOString(),
  };
}
