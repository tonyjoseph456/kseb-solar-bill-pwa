import { useState } from 'react';
import {
  BookmarkCheck,
  Eye,
  FileText,
  Trash2,
  X,
} from 'lucide-react';
import type { BillRecord, ZoneKey } from '../types';
import { getPdfBlob } from '../services/db';

interface HistoryTabProps {
  records: BillRecord[];
  onDeleteRecord: (id: string) => Promise<void>;
  onUseAsBaseline: (id: string) => void;
}

const ZONE_NAMES: { key: ZoneKey; name: string }[] = [
  { key: 'NL', name: 'Normal (NL / WNL)' },
  { key: 'OP', name: 'Off Peak (OP / WOP)' },
  { key: 'PK', name: 'Peak (PK / WPK)' },
];

export function HistoryTab({
  records,
  onDeleteRecord,
  onUseAsBaseline,
}: HistoryTabProps) {
  const [filterType, setFilterType] = useState<'all' | 'official_bill' | 'meter_estimate'>(
    'all'
  );
  const [selected, setSelected] = useState<BillRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = records.filter((r) =>
    filterType === 'all' ? true : r.recordType === filterType
  );

  const totalSolar = filtered.reduce((acc, r) => acc + r.summary.solarGenerated, 0);
  const totalExport = filtered.reduce((acc, r) => acc + r.summary.totalExport, 0);
  const totalAmount = filtered.reduce((acc, r) => acc + r.summary.totalAmount, 0);

  async function handleViewPdf(record: BillRecord) {
    const pdf = await getPdfBlob(record.id);
    if (!pdf) {
      alert('Original PDF is not stored locally on this device.');
      return;
    }
    const url = URL.createObjectURL(pdf.blob);
    window.open(url, '_blank');
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
      <div className="grid-4" style={{ marginBottom: 14 }}>
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
      </div>

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
                        {rec.hasLocalPdf && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => handleViewPdf(rec)}
                            title="Open saved PDF"
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
                {selected.hasLocalPdf && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleViewPdf(selected)}
                  >
                    <FileText size={16} />
                    Open Original PDF
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
    </div>
  );
}
