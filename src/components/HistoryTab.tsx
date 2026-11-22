import { useEffect, useMemo, useState } from 'react';
import {
  BookmarkCheck,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Trash2,
  X,
} from 'lucide-react';
import type { AppSettings, BillRecord, ZoneKey } from '../types';
import { getPdfBlob } from '../services/db';
import {
  downloadPdfFromCloud,
  getPdfStorageUsage,
  type PdfStorageUsage,
} from '../services/supabaseSync';

interface HistoryTabProps {
  records: BillRecord[];
  settings: AppSettings;
  onReloadRecords: () => Promise<unknown>;
  onDeleteRecord: (id: string) => Promise<void>;
  onUseAsBaseline: (id: string) => void;
}

const ZONE_NAMES: { key: ZoneKey; name: string }[] = [
  { key: 'NL', name: 'Normal (NL / WNL)' },
  { key: 'OP', name: 'Off Peak (OP / WOP)' },
  { key: 'PK', name: 'Peak (PK / WPK)' },
];

function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 100) return `${mb.toFixed(1)} MB`;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function HistoryTab({
  records,
  settings,
  onReloadRecords,
  onDeleteRecord,
  onUseAsBaseline,
}: HistoryTabProps) {
  const [filterType, setFilterType] = useState<'all' | 'official_bill' | 'meter_estimate'>(
    'all'
  );
  const [selected, setSelected] = useState<BillRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingPdfId, setLoadingPdfId] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [storageUsage, setStorageUsage] = useState<PdfStorageUsage | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{
    url: string;
    filename: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (pdfPreview?.url) {
        URL.revokeObjectURL(pdfPreview.url);
      }
    };
  }, [pdfPreview?.url]);

  useEffect(() => {
    let active = true;
    getPdfStorageUsage(settings)
      .then((info) => {
        if (active) setStorageUsage(info);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [settings, records]);

  const filtered = records.filter((r) =>
    filterType === 'all' ? true : r.recordType === filterType
  );

  const totalSolar = filtered.reduce((acc, r) => acc + r.summary.solarGenerated, 0);
  const totalExport = filtered.reduce((acc, r) => acc + r.summary.totalExport, 0);
  const totalAmount = filtered.reduce((acc, r) => acc + r.summary.totalAmount, 0);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const r of records) {
      const y = r.billingMonth.slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    }
    if (years.size === 0) years.add(String(new Date().getFullYear()));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [records]);

  const [selectedYear, setSelectedYear] = useState<string>(
    availableYears[0] ?? String(new Date().getFullYear())
  );

  useEffect(() => {
    if (!availableYears.includes(selectedYear) && availableYears.length > 0) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);

  const yearRecords = filtered.filter((r) =>
    r.billingMonth.startsWith(`${selectedYear}-`)
  );
  const yearSolar = yearRecords.reduce((acc, r) => acc + r.summary.solarGenerated, 0);
  const yearExport = yearRecords.reduce((acc, r) => acc + r.summary.totalExport, 0);
  const yearAmount = yearRecords.reduce((acc, r) => acc + r.summary.totalAmount, 0);

  async function handleViewPdf(record: BillRecord) {
    setPdfError('');
    setLoadingPdfId(record.id);
    try {
      let pdf = await getPdfBlob(record.id);
      if (!pdf && record.pdfStoragePath) {
        pdf = await downloadPdfFromCloud(settings, record);
        await onReloadRecords();
      }
      if (!pdf) {
        setPdfError(
          `The PDF for ${record.billingLabel} was not uploaded to cloud storage from the original device yet (likely due to an earlier mobile upload issue). Re-upload that PDF once via "Upload KSEB Bill PDF" to sync it across all devices.`
        );
        return;
      }
      if (pdfPreview?.url) {
        URL.revokeObjectURL(pdfPreview.url);
      }
      const url = URL.createObjectURL(pdf.blob);
      setPdfPreview({
        url,
        filename: pdf.filename || `${record.billingMonth}.pdf`,
        title: `${record.billingLabel} — ${pdf.filename || 'KSEB Bill PDF'}`,
      });
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Unable to open saved PDF.');
    } finally {
      setLoadingPdfId(null);
    }
  }

  async function handleDelete(record: BillRecord) {
    if (!confirm(`Delete ${record.billingLabel} (${record.recordType}) from history?`)) {
      return;
    }
    setDeletingId(record.id);
    try {
      await onDeleteRecord(record.id);
      if (selected?.id === record.id) setSelected(null);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="grid-5" style={{ marginBottom: 10 }}>
        <div className="metric-box">
          <div className="label">Saved Months / Records</div>
          <div className="val">{filtered.length}</div>
        </div>
        <div className="metric-box">
          <div className="label">Total Solar Generated</div>
          <div className="val">{totalSolar.toFixed(0)} kWh</div>
        </div>
        <div className="metric-box">
          <div className="label">Total Exported</div>
          <div className="val">{totalExport.toFixed(0)} kWh</div>
        </div>
        <div className="metric-box">
          <div className="label">Total Billed Amount</div>
          <div className="val">₹ {totalAmount.toFixed(2)}</div>
        </div>
        <div className="metric-box">
          <div className="label">
            PDF Space Left ({storageUsage?.source === 'cloud' ? 'Cloud' : 'Local'})
          </div>
          <div className="val">
            {storageUsage ? `${formatMB(storageUsage.remainingBytes)}` : 'Checking...'}
          </div>
          {storageUsage && (
            <div className="text-muted" style={{ fontSize: '0.73rem', marginTop: 2 }}>
              {formatMB(storageUsage.usedBytes)} / {formatMB(storageUsage.quotaBytes)} used (
              {storageUsage.fileCount} PDF{storageUsage.fileCount === 1 ? '' : 's'})
            </div>
          )}
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="metric-box">
          <div className="label">Select Year</div>
          <select
            aria-label="Filter yearly summary by year"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            style={{ marginTop: 4, padding: '6px 8px', fontWeight: 700 }}
          >
            {availableYears.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>
          <div className="text-muted" style={{ fontSize: '0.73rem', marginTop: 4 }}>
            {yearRecords.length} record{yearRecords.length === 1 ? '' : 's'} in {selectedYear}
          </div>
        </div>
        <div className="metric-box">
          <div className="label">{selectedYear} Solar Generated</div>
          <div className="val">{yearSolar.toFixed(0)} kWh</div>
        </div>
        <div className="metric-box">
          <div className="label">{selectedYear} Exported</div>
          <div className="val">{yearExport.toFixed(0)} kWh</div>
        </div>
        <div className="metric-box">
          <div className="label">{selectedYear} Billed Amount</div>
          <div className="val">₹ {yearAmount.toFixed(2)}</div>
        </div>
      </div>

      {pdfError && (
        <div className="banner banner-warn">
          <span>{pdfError}</span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setPdfError('')}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Monthly Consumption & Bill Archive</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${filterType === 'all' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilterType('all')}
            >
              All ({records.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${
                filterType === 'official_bill' ? 'btn-primary' : 'btn-outline'
              }`}
              onClick={() => setFilterType('official_bill')}
            >
              PDF Bills
            </button>
            <button
              type="button"
              className={`btn btn-sm ${
                filterType === 'meter_estimate' ? 'btn-primary' : 'btn-outline'
              }`}
              onClick={() => setFilterType('meter_estimate')}
            >
              Estimates
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted" style={{ margin: '12px 0' }}>
            No monthly bills or meter calculations saved yet. Upload a KSEB PDF bill or save a
            calculation from the Calculator tab.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Type</th>
                  <th className="num">Import</th>
                  <th className="num">Export</th>
                  <th className="num">Solar Gen</th>
                  <th className="num">Billed</th>
                  <th className="num">Banked</th>
                  <th className="num">Amount</th>
                  <th>Sync</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec) => (
                  <tr key={rec.id}>
                    <td>
                      <strong>{rec.billingLabel}</strong>
                      <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {rec.consumerNo || rec.consumerName}
                      </div>
                    </td>
                    <td>
                      {rec.recordType === 'official_bill' ? (
                        <span className="badge badge-teal">Official PDF</span>
                      ) : (
                        <span className="badge badge-sky">Meter Estimate</span>
                      )}
                    </td>
                    <td className="num">{rec.summary.totalImport}</td>
                    <td className="num">{rec.summary.totalExport}</td>
                    <td className="num">{rec.summary.solarGenerated}</td>
                    <td className="num">{rec.summary.billedUnits}</td>
                    <td className="num">
                      {(rec.bankClosing ?? 0) > 0 ? (
                        <strong style={{ color: 'var(--primary)' }}>
                          {rec.bankClosing ?? 0}
                        </strong>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="num">
                      <strong>₹ {rec.summary.totalAmount.toFixed(2)}</strong>
                    </td>
                    <td>
                      {rec.syncStatus === 'synced' ? (
                        <span className="badge badge-green">Synced</span>
                      ) : (
                        <span className="badge badge-amber">Local</span>
                      )}
                    </td>
                    <td className="num">
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => setSelected(rec)}
                          title="View full monthly breakdown"
                        >
                          <Eye size={14} />
                          View
                        </button>
                        {(rec.hasLocalPdf || rec.pdfStoragePath) && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={loadingPdfId === rec.id}
                            onClick={() => handleViewPdf(rec)}
                            title={
                              rec.hasLocalPdf
                                ? 'Open saved PDF'
                                : 'Download & open synced PDF from cloud'
                            }
                          >
                            <FileText size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger-outline btn-sm"
                          disabled={deletingId === rec.id}
                          onClick={() => handleDelete(rec)}
                          title="Delete entry"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  {selected.billingLabel} —{' '}
                  {selected.recordType === 'official_bill'
                    ? 'Official KSEB PDF Bill'
                    : 'Saved Meter Calculation'}
                </h2>
                <div className="text-muted">
                  Consumer: {selected.consumerName || '—'} ({selected.consumerNo || '—'}) •
                  Phase: {selected.tariffPhase} • Bank Opening: {selected.bankOpening} → Closing:{' '}
                  {selected.bankClosing}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setSelected(null)}
              >
                <X size={16} />
              </button>
            </div>

            <h3 style={{ fontSize: '0.92rem', margin: '10px 0 6px' }}>
              Zone-Wise Meter Readings & Consumption
            </h3>
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Zone</th>
                    <th className="num">Initial (IR)</th>
                    <th className="num">Final (FR)</th>
                    <th className="num">Units (kWh)</th>
                  </tr>
                </thead>
                <tbody>
                  {(['import', 'export', 'generation'] as const).map((group) =>
                    ZONE_NAMES.map((z) => {
                      const item = selected.readings[group][z.key];
                      return (
                        <tr key={`${group}_${z.key}`}>
                          <td>
                            {group === 'import'
                              ? 'Net Import'
                              : group === 'export'
                              ? 'Net Export'
                              : 'Solar Gen'}
                          </td>
                          <td>{z.name}</td>
                          <td className="num">{item.ir}</td>
                          <td className="num">{item.fr}</td>
                          <td className="num">
                            <strong>{item.units}</strong>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '0.92rem', margin: '10px 0 6px' }}>Charge Summary</h3>
            <table className="data-table" style={{ marginBottom: 14 }}>
              <tbody>
                <tr>
                  <td>Fixed Charge</td>
                  <td className="num">₹ {selected.summary.fixedCharge.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Energy Charge ({selected.summary.billedUnits} billed units)</td>
                  <td className="num">₹ {selected.summary.energyCharge.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Fuel Surcharge</td>
                  <td className="num">₹ {selected.summary.fuelSurcharge.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Electricity Duty</td>
                  <td className="num">₹ {selected.summary.electricityDuty.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Round Off</td>
                  <td className="num">{selected.summary.roundOff.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>Total Bill Amount</strong>
                  </td>
                  <td className="num">
                    <strong>₹ {selected.summary.totalAmount.toFixed(2)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {(selected.hasLocalPdf || selected.pdfStoragePath) && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={loadingPdfId === selected.id}
                    onClick={() => handleViewPdf(selected)}
                  >
                    <FileText size={16} />
                    {loadingPdfId === selected.id ? 'Loading PDF...' : 'Open Original PDF'}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onUseAsBaseline(selected.id);
                    setSelected(null);
                  }}
                >
                  <BookmarkCheck size={16} />
                  Use FR as Calculator Previous
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pdfPreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel" style={{ maxWidth: 920 }}>
            <div className="card-header">
              <h2 className="card-title">
                <FileText size={18} />
                {pdfPreview.title}
              </h2>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setPdfPreview(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <a
                className="btn btn-primary btn-sm"
                href={pdfPreview.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} />
                Open in New Tab
              </a>
              <a
                className="btn btn-outline btn-sm"
                href={pdfPreview.url}
                download={pdfPreview.filename}
              >
                <Download size={14} />
                Download PDF
              </a>
            </div>

            <iframe
              title={pdfPreview.title}
              src={pdfPreview.url}
              style={{
                width: '100%',
                height: '68vh',
                border: '1px solid var(--border)',
                borderRadius: 10,
                background: '#f8fafc',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
