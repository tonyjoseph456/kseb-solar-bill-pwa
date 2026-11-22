import {
  Cloud,
  CloudOff,
  FileUp,
  History,
  RefreshCw,
  Settings,
  Sun,
  Calculator,
} from 'lucide-react';
import type { TariffTables } from '../types';

export type ActiveTab = 'calculator' | 'history' | 'solar' | 'settings';

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenPdfUpload: () => void;
  tariffs: TariffTables;
  tariffLoading: boolean;
  onRefreshTariffs: () => void;
  cloudEmail: string | null;
  pendingCount: number;
  syncing: boolean;
  onSyncNow: () => void;
  consumerLabel: string;
}

export function Header({
  activeTab,
  onSelectTab,
  onOpenPdfUpload,
  tariffs,
  tariffLoading,
  onRefreshTariffs,
  cloudEmail,
  pendingCount,
  syncing,
  onSyncNow,
  consumerLabel,
}: HeaderProps) {
  const sourceLabel =
    tariffs.source === 'github-raw' || tariffs.source === 'github-pages'
      ? 'GitHub Live'
      : tariffs.source === 'cache'
      ? 'Offline Cache'
      : 'Bundled Fallback';

  const fetchedTime = tariffs.fetchedAt
    ? new Date(tariffs.fetchedAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  return (
    <>
      <header className="app-header">
        <div className="header-top">
          <div>
            <h1 className="brand-title">
              <Sun size={22} />
              KSEB Solar Prosumer Calculator
            </h1>
            <p className="brand-subtitle">
              {consumerLabel || 'PDF Auto-Fill • Live anwarbio/kseb-bill-calculator Rates'}
            </p>
          </div>
          <div className="header-actions">
            <button type="button" className="btn btn-white" onClick={onOpenPdfUpload}>
              <FileUp size={16} />
              Upload KSEB Bill PDF
            </button>
          </div>
        </div>

        <div className="status-strip">
          <button
            type="button"
            className="pill pill-btn"
            onClick={onRefreshTariffs}
            disabled={tariffLoading}
            title="Refresh latest tariff CSVs from anwarbio/kseb-bill-calculator"
          >
            <RefreshCw size={13} className={tariffLoading ? 'spin' : ''} />
            <span>
              Rates: {sourceLabel} ({fetchedTime})
            </span>
          </button>

          {cloudEmail ? (
            <button
              type="button"
              className="pill pill-btn"
              onClick={onSyncNow}
              disabled={syncing}
              title={`Signed in as ${cloudEmail}`}
            >
              <Cloud size={13} />
              <span>
                {syncing
                  ? 'Syncing...'
                  : pendingCount > 0
                  ? `Cloud: ${pendingCount} pending`
                  : 'Cloud: Synced'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="pill pill-btn"
              onClick={() => onSelectTab('settings')}
            >
              <CloudOff size={13} />
              <span>Local DB (Sign In to Sync)</span>
            </button>
          )}
        </div>
      </header>

      <nav className="nav-tabs" aria-label="Main navigation">
        <button
          type="button"
          className={`nav-tab ${activeTab === 'calculator' ? 'active' : ''}`}
          onClick={() => onSelectTab('calculator')}
        >
          <Calculator size={16} />
          <span>Calculate</span>
        </button>
        <button
          type="button"
          className={`nav-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => onSelectTab('history')}
        >
          <History size={16} />
          <span>History</span>
        </button>
        <button
          type="button"
          className={`nav-tab ${activeTab === 'solar' ? 'active' : ''}`}
          onClick={() => onSelectTab('solar')}
        >
          <Sun size={16} />
          <span>Solar Data</span>
        </button>
        <button
          type="button"
          className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectTab('settings')}
        >
          <Settings size={16} />
          <span>Settings</span>
        </button>
      </nav>
    </>
  );
}
