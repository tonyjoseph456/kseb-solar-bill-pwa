import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, X } from 'lucide-react';
import type { BillRecord, ZoneKey } from '../types';
import { parseKsebPdfFile } from '../services/pdfParser';

interface PdfUploadModalProps {
  onClose: () => void;
  onSaveBill: (record: BillRecord, file: File | null) => Promise<void>;
}

const ZONE_LABELS: { key: ZoneKey; label: string }[] = [
  { key: 'NL', label: 'Normal (NL)' },
  { key: 'OP', label: 'Off Peak (OP)' },
  { key: 'PK', label: 'Peak (PK)' },
];

export function PdfUploadModal({ onClose, onSaveBill }: PdfUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsedRecord, setParsedRecord] = useState<BillRecord | null>(null);

  async function handleFile(file: File) {
    setError('');
    setWarnings([]);
    setParsing(true);
    setSelectedFile(file);
    try {
      const result = await parseKsebPdfFile(file);
      setParsedRecord(result.record);
      setWarnings(result.warnings);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not parse PDF: ${err.message}`
          : 'Failed to parse PDF file.'
      );
    } finally {
      setParsing(false);
    }
  }

  function updateField<K extends keyof BillRecord>(key: K, val: BillRecord[K]) {
    if (!parsedRecord) return;
    setParsedRecord({ ...parsedRecord, [key]: val });
  }

  function updateReading(
    group: 'import' | 'export' | 'generation',
    zone: ZoneKey,
    field: 'ir' | 'fr' | 'units',
    val: number
  ) {
    if (!parsedRecord) return;
    const currentZone = parsedRecord.readings[group][zone];
    const nextZone = { ...currentZone, [field]: val };
    if (field === 'ir' || field === 'fr') {
      nextZone.units = Math.max(0, Number((nextZone.fr - nextZone.ir).toFixed(2)));
    }
    const nextReadings = {
      ...parsedRecord.readings,
      [group]: {
        ...parsedRecord.readings[group],
        [zone]: nextZone,
      },
    };
    const totalImport =
      nextReadings.import.NL.units +
      nextReadings.import.OP.units +
      nextReadings.import.PK.units;
    const totalExport =
      nextReadings.export.NL.units +
      nextReadings.export.OP.units +
      nextReadings.export.PK.units;
    const solarGenerated =
      nextReadings.generation.NL.units +
      nextReadings.generation.OP.units +
      nextReadings.generation.PK.units;

    setParsedRecord({
      ...parsedRecord,
      readings: nextReadings,
      summary: {
        ...parsedRecord.summary,
        totalImport,
        totalExport,
        solarGenerated,
        ownConsumption: Math.max(0, solarGenerated - totalExport),
      },
    });
  }

  function updateSummaryField(
    field: keyof BillRecord['summary'],
    val: number
  ) {
    if (!parsedRecord) return;
    setParsedRecord({
      ...parsedRecord,
      summary: {
        ...parsedRecord.summary,
        [field]: val,
      },
    });
  }

  async function handleConfirmSave() {
    if (!parsedRecord) return;
    setSaving(true);
    try {
      const [yyyy, mm] = parsedRecord.billingMonth.split('-');
      const finalRecord: BillRecord = {
        ...parsedRecord,
        id: `official_${parsedRecord.consumerNo || 'kseb'}_${parsedRecord.billingMonth}`,
        billingLabel: yyyy && mm ? `${mm}/${yyyy}` : parsedRecord.billingLabel,
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      };
      await onSaveBill(finalRecord, selectedFile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bill.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <div className="card-header">
          <h2 className="card-title">
            <FileUp size={18} />
            Upload Previous KSEB Bill PDF
          </h2>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {!parsedRecord && (
          <div
            className="dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <FileUp size={32} color="#0f766e" />
            <p style={{ margin: '10px 0 4px', fontWeight: 700 }}>
              {parsing ? 'Reading KSEB OrumaNET PDF...' : 'Tap or drag KSEB PDF bill here'}
            </p>
            <p className="text-muted" style={{ margin: 0 }}>
              Parsed 100% locally in your browser. Final Readings (FR) will auto-fill your
              Previous Readings automatically.
            </p>
          </div>
        )}

        {error && (
          <div className="banner banner-danger" style={{ marginTop: 12 }}>
            <span>{error}</span>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="banner banner-warn" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                {warnings.map((w, idx) => (
                  <div key={idx}>{w}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {parsedRecord && (
          <div style={{ marginTop: 10 }}>
            <div className="banner banner-success">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} />
                <span>
                  Extracted <strong>{selectedFile?.name}</strong>. Verify fields below and save.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setParsedRecord(null);
                  setSelectedFile(null);
                  setWarnings([]);
                }}
              >
                Choose Different PDF
              </button>
            </div>

            <div className="grid-3" style={{ marginBottom: 14 }}>
              <div>
                <label className="field-label">Billing Month</label>
                <input
                  type="month"
                  value={parsedRecord.billingMonth}
                  onChange={(e) => updateField('billingMonth', e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Consumer Number</label>
                <input
                  type="text"
                  value={parsedRecord.consumerNo}
                  onChange={(e) => updateField('consumerNo', e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Consumer Name</label>
                <input
                  type="text"
                  value={parsedRecord.consumerName}
                  onChange={(e) => updateField('consumerName', e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Bill Number</label>
                <input
                  type="text"
                  value={parsedRecord.billNo ?? ''}
                  onChange={(e) => updateField('billNo', e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Phase</label>
                <select
                  value={parsedRecord.tariffPhase}
                  onChange={(e) =>
                    updateField('tariffPhase', e.target.value as 'single' | 'three')
                  }
                >
                  <option value="three">Three Phase</option>
                  <option value="single">Single Phase</option>
                </select>
              </div>
              <div>
                <label className="field-label">Meter Owner</label>
                <select
                  value={parsedRecord.meterOwner}
                  onChange={(e) =>
                    updateField('meterOwner', e.target.value as 'prosumer' | 'kseb')
                  }
                >
                  <option value="prosumer">Customer / Prosumer (₹0 rent)</option>
                  <option value="kseb">KSEB Owned</option>
                </select>
              </div>
            </div>

            <h3 style={{ fontSize: '0.92rem', margin: '12px 0 6px' }}>
              Extracted Net Meter & Solar Readings (FR becomes next month&apos;s Previous)
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Zone</th>
                    <th className="num">Initial (IR)</th>
                    <th className="num">Final (FR)</th>
                    <th className="num">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {(['import', 'export', 'generation'] as const).map((group) =>
                    ZONE_LABELS.map((z) => {
                      const row = parsedRecord.readings[group][z.key];
                      return (
                        <tr key={`${group}_${z.key}`}>
                          <td>
                            {group === 'import'
                              ? 'Net Import'
                              : group === 'export'
                              ? 'Net Export'
                              : 'Solar Gen'}
                          </td>
                          <td>{z.label}</td>
                          <td className="num">
                            <input
                              type="number"
                              step="any"
                              value={row.ir}
                              onChange={(e) =>
                                updateReading(group, z.key, 'ir', Number(e.target.value) || 0)
                              }
                            />
                          </td>
                          <td className="num">
                            <input
                              type="number"
                              step="any"
                              value={row.fr}
                              onChange={(e) =>
                                updateReading(group, z.key, 'fr', Number(e.target.value) || 0)
                              }
                            />
                          </td>
                          <td className="num">
                            <input
                              type="number"
                              step="any"
                              value={row.units}
                              onChange={(e) =>
                                updateReading(
                                  group,
                                  z.key,
                                  'units',
                                  Number(e.target.value) || 0
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '0.92rem', margin: '14px 0 6px' }}>
              Bank Balance & Official Bill Amounts
            </h3>
            <div className="grid-4" style={{ marginBottom: 16 }}>
              <div>
                <label className="field-label">Bank Opening</label>
                <input
                  type="number"
                  value={parsedRecord.bankOpening}
                  onChange={(e) => updateField('bankOpening', Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="field-label">Bank Closing</label>
                <input
                  type="number"
                  value={parsedRecord.bankClosing}
                  onChange={(e) => updateField('bankClosing', Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="field-label">Fixed Charge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={parsedRecord.summary.fixedCharge}
                  onChange={(e) =>
                    updateSummaryField('fixedCharge', Number(e.target.value) || 0)
                  }
                />
              </div>
              <div>
                <label className="field-label">Energy Charge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={parsedRecord.summary.energyCharge}
                  onChange={(e) =>
                    updateSummaryField('energyCharge', Number(e.target.value) || 0)
                  }
                />
              </div>
              <div>
                <label className="field-label">Fuel Surcharge (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={parsedRecord.summary.fuelSurcharge}
                  onChange={(e) =>
                    updateSummaryField('fuelSurcharge', Number(e.target.value) || 0)
                  }
                />
              </div>
              <div>
                <label className="field-label">Electricity Duty (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={parsedRecord.summary.electricityDuty}
                  onChange={(e) =>
                    updateSummaryField('electricityDuty', Number(e.target.value) || 0)
                  }
                />
              </div>
              <div>
                <label className="field-label">Billed Units (kWh)</label>
                <input
                  type="number"
                  value={parsedRecord.summary.billedUnits}
                  onChange={(e) =>
                    updateSummaryField('billedUnits', Number(e.target.value) || 0)
                  }
                />
              </div>
              <div>
                <label className="field-label">Total Bill Demand (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={parsedRecord.summary.totalAmount}
                  onChange={(e) =>
                    updateSummaryField('totalAmount', Number(e.target.value) || 0)
                  }
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={handleConfirmSave}
              >
                {saving ? 'Saving...' : 'Save Bill & Auto-Fill Previous Readings'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
