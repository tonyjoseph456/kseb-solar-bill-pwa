import { useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  Database,
  Download,
  LogIn,
  LogOut,
  RefreshCw,
  Upload,
} from 'lucide-react';
import schemaSql from '../../supabase/schema.sql?raw';
import type { AppSettings, TariffTables } from '../types';
import { exportDatabaseBackupJSON, importDatabaseBackupJSON } from '../services/db';
import {
  signInCloud,
  signInWithGitHubCloud,
  signOutCloud,
  signUpCloud,
} from '../services/supabaseSync';

interface SettingsTabProps {
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => Promise<void>;
  tariffs: TariffTables;
  tariffLoading: boolean;
  onRefreshTariffs: () => Promise<void>;
  cloudEmail: string | null;
  onAuthChanged: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  syncing: boolean;
  lastSyncMessage: string;
  onReloadRecords: () => Promise<void>;
}

export function SettingsTab({
  settings,
  onUpdateSettings,
  tariffs,
  tariffLoading,
  onRefreshTariffs,
  cloudEmail,
  onAuthChanged,
  onSyncNow,
  syncing,
  lastSyncMessage,
  onReloadRecords,
}: SettingsTabProps) {
  const backupFileRef = useRef<HTMLInputElement | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState(settings.supabaseUrl);
  const [supabaseKey, setSupabaseKey] = useState(settings.supabaseAnonKey);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showSchema, setShowSchema] = useState(false);

  async function handleSaveCloudKeys() {
    const next = await Promise.resolve({
      ...settings,
      supabaseUrl: supabaseUrl.trim(),
      supabaseAnonKey: supabaseKey.trim(),
    });
    await onUpdateSettings(next);
    setAuthStatus('Saved Supabase project URL and anon key.');
    await onAuthChanged();
  }

  async function handleSignIn(mode: 'signin' | 'signup') {
    setAuthLoading(true);
    setAuthStatus('');
    try {
      const merged: AppSettings = {
        ...settings,
        supabaseUrl: supabaseUrl.trim(),
        supabaseAnonKey: supabaseKey.trim(),
      };
      await onUpdateSettings(merged);

      if (mode === 'signin') {
        const user = await signInCloud(merged, email.trim(), password);
        setAuthStatus(`Signed in as ${user.email}.`);
      } else {
        const res = await signUpCloud(merged, email.trim(), password);
        setAuthStatus(
          res.needsConfirmation
            ? 'Account created! Check your email to confirm, then sign in.'
            : `Signed up & logged in as ${res.user?.email}.`
        );
      }
      await onAuthChanged();
    } catch (err) {
      setAuthStatus(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleGitHubSignIn() {
    setAuthLoading(true);
    setAuthStatus('');
    try {
      const merged: AppSettings = {
        ...settings,
        supabaseUrl: supabaseUrl.trim(),
        supabaseAnonKey: supabaseKey.trim(),
      };
      await onUpdateSettings(merged);
      await signInWithGitHubCloud(merged);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GitHub sign-in failed.';
      if (/not enabled|unsupported provider/i.test(msg)) {
        const projectRef = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
        const callbackUrl = supabaseUrl
          ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1/callback`
          : 'https://<project>.supabase.co/auth/v1/callback';
        setAuthStatus(
          `GitHub OAuth is not enabled in this Supabase project yet. Enable it in Supabase Dashboard (${
            projectRef
              ? `Authentication -> Providers -> GitHub for project ${projectRef}`
              : 'Authentication -> Providers -> GitHub'
          }) with callback URL ${callbackUrl}, OR create an Email + Password account below.`
        );
      } else {
        setAuthStatus(msg);
      }
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    await signOutCloud(settings);
    await onAuthChanged();
    setAuthStatus('Signed out from cloud sync (local DB remains intact).');
  }

  async function handleCopySql() {
    await navigator.clipboard.writeText(schemaSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  }

  async function handleExportBackup() {
    const json = await exportDatabaseBackupJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kseb-solar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportBackup(file: File) {
    const text = await file.text();
    const count = await importDatabaseBackupJSON(text);
    await onReloadRecords();
    alert(`Imported ${count} record(s) into local DB.`);
  }

  return (
    <div>
      {/* Free Cloud Sync */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Cloud size={18} />
            Free Cloud Sync (Supabase Free Tier)
          </h2>
          {cloudEmail ? (
            <span className="badge badge-green">Connected: {cloudEmail}</span>
          ) : (
            <span className="badge badge-amber">Not Connected (Local IndexedDB active)</span>
          )}
        </div>
        <p className="text-muted" style={{ marginTop: 0 }}>
          Sync your monthly PDF bills, meter readings, and calculations across phone and desktop
          using a free Supabase project (500 MB DB + 1 GB PDF storage).
        </p>

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div>
            <label className="field-label">Supabase Project URL</label>
            <input
              type="text"
              placeholder="https://your-project-id.supabase.co"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Supabase Publishable / Anon Key</label>
            <input
              type="password"
              placeholder="sb_publishable_..."
              value={supabaseKey}
              onChange={(e) => setSupabaseKey(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleSaveCloudKeys}>
            Save Project Keys
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setShowSchema((s) => !s)}
          >
            {showSchema ? 'Hide SQL Setup' : 'Show Free Setup & SQL Schema'}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleCopySql}>
            {copiedSql ? <Check size={14} /> : <Copy size={14} />}
            {copiedSql ? 'Copied schema.sql' : 'Copy schema.sql'}
          </button>
        </div>

        {showSchema && (
          <div style={{ marginBottom: 14 }}>
            <ol className="text-muted" style={{ paddingLeft: 18, marginBottom: 8 }}>
              <li>Create a free project at supabase.com.</li>
              <li>Open <strong>SQL Editor</strong>, paste <code>schema.sql</code> below, and click Run.</li>
              <li>Copy your <strong>Project URL</strong> &amp; <strong>anon public key</strong> from Project Settings → API above.</li>
              <li>Create your login email &amp; password below to sync across devices.</li>
            </ol>
            <div className="code-box">{schemaSql}</div>
          </div>
        )}

        {cloudEmail ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
              paddingTop: 10,
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onSyncNow}
              disabled={syncing}
            >
              <RefreshCw size={14} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={handleSignOut}>
              <LogOut size={14} />
              Sign Out
            </button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={settings.autoSyncOnOpen}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, autoSyncOnOpen: e.target.checked })
                }
              />
              Auto-sync on app open
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={settings.uploadPdfToCloud}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, uploadPdfToCloud: e.target.checked })
                }
              />
              Sync PDF files to Storage
            </label>
          </div>
        ) : (
          <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn-outline"
                disabled={authLoading}
                onClick={handleGitHubSignIn}
                style={{ background: '#0f172a', color: '#ffffff', borderColor: '#0f172a' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.91c.58.11.79-.25.79-.55v-2.16c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.07.78 2.16v3.2c0 .31.21.67.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
                </svg>
                Sign in with GitHub
              </button>
              <span className="text-muted">or use Email &amp; Password:</span>
            </div>

            <div className="grid-3" style={{ alignItems: 'end' }}>
              <div>
                <label className="field-label">Account Email</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Password</label>
                <input
                  type="password"
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={authLoading}
                  onClick={() => handleSignIn('signin')}
                >
                  <LogIn size={14} />
                  Sign In
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={authLoading}
                  onClick={() => handleSignIn('signup')}
                >
                  Create Account
                </button>
              </div>
            </div>
          </div>
        )}

        {(authStatus || lastSyncMessage) && (
          <div className="text-muted" style={{ marginTop: 10, fontWeight: 600 }}>
            {authStatus || lastSyncMessage}
          </div>
        )}
      </div>

      {/* Live GitHub Tariff Tables */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <RefreshCw size={18} />
            Live Tariff Data (anwarbio/kseb-bill-calculator)
          </h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={tariffLoading}
            onClick={onRefreshTariffs}
          >
            <RefreshCw size={14} />
            {tariffLoading ? 'Fetching...' : 'Fetch Latest from GitHub'}
          </button>
        </div>

        <p className="text-muted" style={{ marginTop: 0 }}>
          Source: <strong>{tariffs.source}</strong> • Fetched:{' '}
          <strong>{new Date(tariffs.fetchedAt).toLocaleString()}</strong> • Non-Telescopic
          Threshold: <strong>{tariffs.constants.nonTelStartUnit} u</strong> • ToD Multipliers: NL{' '}
          <strong>{tariffs.todMultipliers.nl}</strong>, OP{' '}
          <strong>{tariffs.todMultipliers.op}</strong>, PK{' '}
          <strong>{tariffs.todMultipliers.pk}</strong>
        </p>

        <div className="grid-2">
          <div>
            <h4 style={{ margin: '6px 0' }}>Telescopic Slabs (≤ {tariffs.constants.nonTelStartUnit} u)</h4>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Up to Units</th>
                  <th className="num">₹ / Unit</th>
                </tr>
              </thead>
              <tbody>
                {tariffs.domesticTelescopic.map((s) => (
                  <tr key={s.limit}>
                    <td>{s.limit}</td>
                    <td className="num">₹ {s.rate.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4 style={{ margin: '6px 0' }}>Recent Duty & Fuel Surcharge (LT1)</h4>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Duty</th>
                  <th className="num">FS (₹/u)</th>
                </tr>
              </thead>
              <tbody>
                {tariffs.otherCharges.slice(-6).map((c, idx) => (
                  <tr key={`${c.year}_${c.month}_${idx}`}>
                    <td>
                      {c.month} {c.year}
                    </td>
                    <td className="num">{c.duty}%</td>
                    <td className="num">
                      {c.surcharge !== null ? `₹ ${c.surcharge.toFixed(2)}` : 'Pending'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Backup & Defaults */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Database size={18} />
            Local Backup & Defaults
          </h2>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button type="button" className="btn btn-outline" onClick={handleExportBackup}>
            <Download size={16} />
            Export Full JSON Backup (with PDFs)
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => backupFileRef.current?.click()}
          >
            <Upload size={16} />
            Import JSON Backup
          </button>
          <input
            ref={backupFileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportBackup(file);
            }}
          />
        </div>
      </div>
    </div>
  );
}
