import { useCallback, useEffect, useState } from 'react';
import type {
  AppSettings,
  BillRecord,
  CurrentReadingsDraft,
  SolarGenerationRecord,
  TariffTables,
  TodAdjustmentMode,
} from './types';
import {
  DEFAULT_SETTINGS,
  getAllRecords,
  getAllSolarRecords,
  getCachedTariffs,
  getReadingsDraft,
  getSettings,
  pickBaselineRecord,
  saveBillRecord,
  saveCachedTariffs,
  savePdfBlob,
  saveSettings,
  saveSolarRecord,
  softDeleteBillRecord,
  softDeleteSolarRecord,
} from './services/db';
import {
  BUNDLED_FALLBACK_TARIFFS,
  fetchLatestTariffsFromGitHub,
} from './services/tariffFetcher';
import {
  formatCloudUserLabel,
  getCurrentCloudUser,
  subscribeCloudAuth,
  syncWithSupabase,
} from './services/supabaseSync';
import { Header, type ActiveTab } from './components/Header';
import { CalculatorTab } from './components/CalculatorTab';
import { HistoryTab } from './components/HistoryTab';
import { SolarTab } from './components/SolarTab';
import { SettingsTab } from './components/SettingsTab';
import { PdfUploadModal } from './components/PdfUploadModal';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('calculator');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [records, setRecords] = useState<BillRecord[]>([]);
  const [solarRecords, setSolarRecords] = useState<SolarGenerationRecord[]>([]);
  const [tariffs, setTariffs] = useState<TariffTables>(BUNDLED_FALLBACK_TARIFFS);
  const [draft, setDraft] = useState<CurrentReadingsDraft | null>(null);
  const [ready, setReady] = useState(false);

  const [tariffLoading, setTariffLoading] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [cloudEmail, setCloudEmail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState('');
  const [solarTableMissing, setSolarTableMissing] = useState(false);

  const reloadRecords = useCallback(async () => {
    const [all, allSolar] = await Promise.all([getAllRecords(false), getAllSolarRecords(false)]);
    setRecords(all);
    setSolarRecords(allSolar);
    return all;
  }, []);

  const refreshTariffs = useCallback(async () => {
    setTariffLoading(true);
    try {
      const live = await fetchLatestTariffsFromGitHub();
      setTariffs(live);
      await saveCachedTariffs(live);
    } catch (err) {
      console.warn('Could not fetch live tariffs from GitHub, keeping cached:', err);
    } finally {
      setTariffLoading(false);
    }
  }, []);

  const refreshCloudSessionAndSync = useCallback(
    async (cfg: AppSettings, runSync: boolean) => {
      try {
        const user = await getCurrentCloudUser(cfg);
        setCloudEmail(formatCloudUserLabel(user));
        if (user && runSync) {
          setSyncing(true);
          const report = await syncWithSupabase(cfg);
          setSolarTableMissing(Boolean(report.solarTableMissing));
          const errSuffix =
            report.pdfErrors.length > 0
              ? ` • PDF note: ${report.pdfErrors.join('; ')}`
              : '';
          const totalPushed = report.pushed + report.solarPushed;
          const totalPulled = report.pulled + report.solarPulled;
          setLastSyncMessage(
            `Last synced ${new Date(report.syncedAt).toLocaleTimeString()} (↑${totalPushed} pushed, ↓${totalPulled} pulled${errSuffix})`
          );
          await reloadRecords();
        }
      } catch (err) {
        setLastSyncMessage(
          err instanceof Error ? `Sync skipped: ${err.message}` : 'Sync failed'
        );
      } finally {
        setSyncing(false);
      }
    },
    [reloadRecords]
  );

  useEffect(() => {
    let active = true;
    async function init() {
      const [loadedSettings, loadedRecords, loadedSolarRecords, cachedTariffs, loadedDraft] =
        await Promise.all([
          getSettings(),
          getAllRecords(false),
          getAllSolarRecords(false),
          getCachedTariffs(),
          getReadingsDraft(),
        ]);
      if (!active) return;

      setSettings(loadedSettings);
      setRecords(loadedRecords);
      setSolarRecords(loadedSolarRecords);
      if (cachedTariffs) {
        setTariffs({ ...cachedTariffs, source: 'cache' });
      }
      setDraft(loadedDraft);
      setReady(true);

      // Always fetch latest GitHub CSV rates whenever PWA opens
      refreshTariffs();

      // Check cloud session & auto-sync if configured
      refreshCloudSessionAndSync(loadedSettings, loadedSettings.autoSyncOnOpen);
    }
    init();
    return () => {
      active = false;
    };
  }, [refreshTariffs, refreshCloudSessionAndSync]);

  useEffect(() => {
    if (!ready) return;
    return subscribeCloudAuth(settings, (user, event) => {
      setCloudEmail(formatCloudUserLabel(user));
      if (user && typeof window !== 'undefined' && window.location.search.includes('code=')) {
        const cleanUrl = `${window.location.origin}${window.location.pathname}`;
        window.history.replaceState({}, document.title, cleanUrl);
      }
      if (user && event === 'SIGNED_IN' && settings.autoSyncOnOpen) {
        refreshCloudSessionAndSync(settings, true);
      }
    });
  }, [ready, settings, refreshCloudSessionAndSync]);

  const baselineRecord = pickBaselineRecord(records, settings.activeBaselineId);

  async function handleUpdateSettings(next: AppSettings) {
    const saved = await saveSettings(next);
    setSettings(saved);
  }

  async function handleSaveUploadedBill(record: BillRecord, file: File | null) {
    if (file) {
      await savePdfBlob(record.id, file.name, file);
    }
    await saveBillRecord(record);

    const nextSettings: AppSettings = {
      ...settings,
      consumerNo: record.consumerNo || settings.consumerNo,
      consumerName: record.consumerName || settings.consumerName,
      defaultPhase: record.tariffPhase,
      defaultMeterOwner: record.meterOwner,
      activeBaselineId: record.id,
    };
    await handleUpdateSettings(nextSettings);
    await reloadRecords();

    if (cloudEmail) {
      refreshCloudSessionAndSync(nextSettings, true);
    }
  }

  async function handleSaveCalculation(record: BillRecord) {
    await saveBillRecord(record);
    await reloadRecords();
    if (cloudEmail) {
      refreshCloudSessionAndSync(settings, true);
    }
  }

  async function handleDeleteRecord(id: string) {
    await softDeleteBillRecord(id);
    if (settings.activeBaselineId === id) {
      await handleUpdateSettings({ ...settings, activeBaselineId: undefined });
    }
    await reloadRecords();
    if (cloudEmail) {
      refreshCloudSessionAndSync(settings, true);
    }
  }

  async function handleSelectBaseline(id: string) {
    await handleUpdateSettings({ ...settings, activeBaselineId: id });
  }

  async function handleChangeTodMode(mode: TodAdjustmentMode) {
    await handleUpdateSettings({ ...settings, todAdjustmentMode: mode });
  }

  async function handleChangeAllowNegativeOC(allow: boolean) {
    await handleUpdateSettings({ ...settings, allowNegativeOwnConsumption: allow });
  }

  async function handleSaveSolarRecords(incoming: SolarGenerationRecord[]) {
    for (const rec of incoming) {
      await saveSolarRecord(rec);
    }
    await reloadRecords();
    if (cloudEmail) {
      refreshCloudSessionAndSync(settings, true);
    }
  }

  async function handleDeleteSolarRecord(id: string) {
    await softDeleteSolarRecord(id);
    await reloadRecords();
    if (cloudEmail) {
      refreshCloudSessionAndSync(settings, true);
    }
  }

  const pendingCount =
    records.filter((r) => r.syncStatus !== 'synced').length +
    solarRecords.filter((r) => r.syncStatus !== 'synced').length;
  const consumerLabel =
    baselineRecord?.consumerName || settings.consumerName
      ? `${baselineRecord?.consumerName || settings.consumerName} • ${
          baselineRecord?.consumerNo || settings.consumerNo || ''
        }`
      : '';

  if (!ready) {
    return (
      <div className="app-shell">
        <div className="card">Loading KSEB Solar Prosumer Calculator...</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenPdfUpload={() => setShowPdfModal(true)}
        tariffs={tariffs}
        tariffLoading={tariffLoading}
        onRefreshTariffs={refreshTariffs}
        cloudEmail={cloudEmail}
        pendingCount={pendingCount}
        syncing={syncing}
        onSyncNow={() => refreshCloudSessionAndSync(settings, true)}
        consumerLabel={consumerLabel}
      />

      {activeTab === 'calculator' && (
        <CalculatorTab
          tariffs={tariffs}
          settings={settings}
          records={records}
          baselineRecord={baselineRecord}
          initialDraft={draft}
          onSelectBaseline={handleSelectBaseline}
          onOpenPdfUpload={() => setShowPdfModal(true)}
          onSaveCalculation={handleSaveCalculation}
          onChangeTodMode={handleChangeTodMode}
          onChangeAllowNegativeOC={handleChangeAllowNegativeOC}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab
          records={records}
          settings={settings}
          onReloadRecords={reloadRecords}
          onDeleteRecord={handleDeleteRecord}
          onUseAsBaseline={(id) => {
            handleSelectBaseline(id);
            setActiveTab('calculator');
          }}
        />
      )}

      {activeTab === 'solar' && (
        <SolarTab
          solarRecords={solarRecords}
          billRecords={records}
          settings={settings}
          cloudEmail={cloudEmail}
          solarTableMissing={solarTableMissing}
          onUpdateSettings={handleUpdateSettings}
          onSaveSolarRecords={handleSaveSolarRecords}
          onDeleteSolarRecord={handleDeleteSolarRecord}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsTab
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          tariffs={tariffs}
          tariffLoading={tariffLoading}
          onRefreshTariffs={refreshTariffs}
          cloudEmail={cloudEmail}
          onAuthChanged={() => refreshCloudSessionAndSync(settings, false)}
          onSyncNow={() => refreshCloudSessionAndSync(settings, true)}
          syncing={syncing}
          lastSyncMessage={lastSyncMessage}
          onReloadRecords={async () => {
            await reloadRecords();
          }}
        />
      )}

      {showPdfModal && (
        <PdfUploadModal
          onClose={() => setShowPdfModal(false)}
          onSaveBill={handleSaveUploadedBill}
        />
      )}
    </div>
  );
}
