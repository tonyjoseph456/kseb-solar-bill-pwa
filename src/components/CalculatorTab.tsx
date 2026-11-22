import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookmarkCheck,
  Eraser,
  FileUp,
  Info,
  RotateCcw,
  Save,
  Sparkles,
} from 'lucide-react';
import type {
  AppSettings,
  BillRecord,
  CurrentReadingsDraft,
  MeterOwner,
  PhaseType,
  TariffTables,
  TodAdjustmentMode,
  ZoneKey,
} from '../types';
import { calculateProsumerBill } from '../services/calculator';
import { clearReadingsDraft, saveReadingsDraft } from '../services/db';

interface CalculatorTabProps {
  tariffs: TariffTables;
  settings: AppSettings;
  records: BillRecord[];
  baselineRecord: BillRecord | null;
  initialDraft: CurrentReadingsDraft | null;
  onSelectBaseline: (id: string) => void;
  onOpenPdfUpload: () => void;
  onSaveCalculation: (record: BillRecord) => Promise<void>;
  onChangeTodMode: (mode: TodAdjustmentMode) => void;
  onChangeAllowNegativeOC: (allow: boolean) => void;
}

const ZONES: { key: ZoneKey; label: string; solarCode: string }[] = [
  { key: 'NL', label: 'Normal (NL)', solarCode: 'WNL' },
  { key: 'OP', label: 'Off Peak (OP)', solarCode: 'WOP' },
  { key: 'PK', label: 'Peak (PK)', solarCode: 'WPK' },
];

function nextMonthAfter(ym: string): string {
  const [yStr, mStr] = ym.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return `${nextY}-${String(nextM).padStart(2, '0')}`;
}

export function CalculatorTab({
  tariffs,
  settings,
  records,
  baselineRecord,
  initialDraft,
  onSelectBaseline,
  onOpenPdfUpload,
  onSaveCalculation,
  onChangeTodMode,
  onChangeAllowNegativeOC,
}: CalculatorTabProps) {
  const defaultMonth = baselineRecord
    ? nextMonthAfter(baselineRecord.billingMonth)
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const [billingMonth, setBillingMonth] = useState(
    initialDraft?.billingMonth || defaultMonth
  );
  const [phaseType, setPhaseType] = useState<PhaseType>(
    baselineRecord?.tariffPhase ?? settings.defaultPhase
  );
  const [meterOwner, setMeterOwner] = useState<MeterOwner>(
    baselineRecord?.meterOwner ?? settings.defaultMeterOwner
  );
  const [todMode, setTodMode] = useState<TodAdjustmentMode>(settings.todAdjustmentMode);
  const [allowNegativeOC, setAllowNegativeOC] = useState<boolean>(
    Boolean(settings.allowNegativeOwnConsumption)
  );

  // Current readings strings (empty string = unchanged = 0 units)
  const [importCurr, setImportCurr] = useState<Record<ZoneKey, string>>(
    initialDraft?.importCurr ?? { NL: '', OP: '', PK: '' }
  );
  const [exportCurr, setExportCurr] = useState<Record<ZoneKey, string>>(
    initialDraft?.exportCurr ?? { NL: '', OP: '', PK: '' }
  );
  const [genCurr, setGenCurr] = useState<Record<ZoneKey, string>>(
    initialDraft?.genCurr ?? { NL: '', OP: '', PK: '' }
  );

  // Previous readings overrides (only used if user manually edits a Previous field)
  const [importPrevOverride, setImportPrevOverride] = useState<Partial<Record<ZoneKey, string>>>(
    initialDraft?.importPrevOverride ?? {}
  );
  const [exportPrevOverride, setExportPrevOverride] = useState<Partial<Record<ZoneKey, string>>>(
    initialDraft?.exportPrevOverride ?? {}
  );
  const [genPrevOverride, setGenPrevOverride] = useState<Partial<Record<ZoneKey, string>>>(
    initialDraft?.genPrevOverride ?? {}
  );
  const [bankOpeningOverride, setBankOpeningOverride] = useState<string>(
    initialDraft?.bankOpeningOverride ?? ''
  );

  const [dutyOverride, setDutyOverride] = useState<string>(initialDraft?.dutyOverride ?? '');
  const [surchargeOverride, setSurchargeOverride] = useState<string>(
    initialDraft?.surchargeOverride ?? ''
  );

  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState('');
  const prevBaselineIdRef = useRef<string | undefined>(baselineRecord?.id);

  // Sync phase, owner, prev overrides & default month when a new PDF baseline is uploaded or switched
  useEffect(() => {
    if (baselineRecord && prevBaselineIdRef.current !== baselineRecord.id) {
      prevBaselineIdRef.current = baselineRecord.id;
      setPhaseType(baselineRecord.tariffPhase);
      setMeterOwner(baselineRecord.meterOwner);
      setBillingMonth(nextMonthAfter(baselineRecord.billingMonth));
      setImportPrevOverride({});
      setExportPrevOverride({});
      setGenPrevOverride({});
      setBankOpeningOverride('');
    }
  }, [baselineRecord?.id]);

  useEffect(() => {
    setTodMode(settings.todAdjustmentMode);
  }, [settings.todAdjustmentMode]);

  useEffect(() => {
    setAllowNegativeOC(Boolean(settings.allowNegativeOwnConsumption));
  }, [settings.allowNegativeOwnConsumption]);

  // Persist draft in IndexedDB
  useEffect(() => {
    saveReadingsDraft({
      billingMonth,
      importCurr,
      exportCurr,
      genCurr,
      importPrevOverride,
      exportPrevOverride,
      genPrevOverride,
      bankOpeningOverride,
      dutyOverride,
      surchargeOverride,
    }).catch(() => {});
  }, [
    billingMonth,
    importCurr,
    exportCurr,
    genCurr,
    importPrevOverride,
    exportPrevOverride,
    genPrevOverride,
    bankOpeningOverride,
    dutyOverride,
    surchargeOverride,
  ]);

  function getPrevValue(group: 'import' | 'export' | 'generation', zone: ZoneKey): number {
    const overrideMap =
      group === 'import'
        ? importPrevOverride
        : group === 'export'
        ? exportPrevOverride
        : genPrevOverride;
    const raw = overrideMap[zone];
    if (raw !== undefined && raw !== '') {
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : 0;
    }
    return baselineRecord ? baselineRecord.readings[group][zone].fr : 0;
  }

  function getPrevInputDisplay(group: 'import' | 'export' | 'generation', zone: ZoneKey): string {
    const overrideMap =
      group === 'import'
        ? importPrevOverride
        : group === 'export'
        ? exportPrevOverride
        : genPrevOverride;
    if (overrideMap[zone] !== undefined) return overrideMap[zone]!;
    return baselineRecord ? String(baselineRecord.readings[group][zone].fr) : '0';
  }

  const prevBank =
    bankOpeningOverride !== ''
      ? Number(bankOpeningOverride) || 0
      : baselineRecord?.bankClosing ?? 0;

  function computeChannel(
    group: 'import' | 'export' | 'generation',
    zone: ZoneKey,
    currMap: Record<ZoneKey, string>
  ) {
    const prev = getPrevValue(group, zone);
    const mf = baselineRecord ? baselineRecord.readings[group][zone].mf || 1 : 1;
    const rawCurr = currMap[zone].trim();
    if (rawCurr === '') {
      return { prev, curr: prev, mf, units: 0, invalid: false, entered: false };
    }
    const curr = parseFloat(rawCurr);
    if (!Number.isFinite(curr)) {
      return { prev, curr: prev, mf, units: 0, invalid: true, entered: true };
    }
    const invalid = curr < prev;
    const units = invalid ? 0 : Number(((curr - prev) * mf).toFixed(2));
    return { prev, curr, mf, units, invalid, entered: true };
  }

  const channels = {
    import: {
      NL: computeChannel('import', 'NL', importCurr),
      OP: computeChannel('import', 'OP', importCurr),
      PK: computeChannel('import', 'PK', importCurr),
    },
    export: {
      NL: computeChannel('export', 'NL', exportCurr),
      OP: computeChannel('export', 'OP', exportCurr),
      PK: computeChannel('export', 'PK', exportCurr),
    },
    generation: {
      NL: computeChannel('generation', 'NL', genCurr),
      OP: computeChannel('generation', 'OP', genCurr),
      PK: computeChannel('generation', 'PK', genCurr),
    },
  };

  const hasNegativeDiff = (['import', 'export', 'generation'] as const).some((g) =>
    ZONES.some((z) => channels[g][z.key].invalid)
  );

  const calc = useMemo(() => {
    const parsedDuty = dutyOverride.trim() === '' ? null : parseFloat(dutyOverride);
    const parsedSurcharge =
      surchargeOverride.trim() === '' ? null : parseFloat(surchargeOverride);

    return calculateProsumerBill(tariffs, {
      billingMonth,
      phaseType,
      meterOwner,
      previousBank: prevBank,
      todAdjustmentMode: todMode,
      allowNegativeOwnConsumption: allowNegativeOC,
      importUnits: {
        NL: channels.import.NL.units,
        OP: channels.import.OP.units,
        PK: channels.import.PK.units,
      },
      exportUnits: {
        NL: channels.export.NL.units,
        OP: channels.export.OP.units,
        PK: channels.export.PK.units,
      },
      solarGenUnits: {
        NL: channels.generation.NL.units,
        OP: channels.generation.OP.units,
        PK: channels.generation.PK.units,
      },
      dutyOverride: Number.isFinite(parsedDuty) ? parsedDuty : null,
      surchargeOverride: Number.isFinite(parsedSurcharge) ? parsedSurcharge : null,
    });
  }, [
    tariffs,
    billingMonth,
    phaseType,
    meterOwner,
    prevBank,
    todMode,
    allowNegativeOC,
    channels.import.NL.units,
    channels.import.OP.units,
    channels.import.PK.units,
    channels.export.NL.units,
    channels.export.OP.units,
    channels.export.PK.units,
    channels.generation.NL.units,
    channels.generation.OP.units,
    channels.generation.PK.units,
    dutyOverride,
    surchargeOverride,
  ]);

  function handleResetPrevToBaseline() {
    setImportPrevOverride({});
    setExportPrevOverride({});
    setGenPrevOverride({});
    setBankOpeningOverride('');
  }

  async function handleClearCurrent() {
    setImportCurr({ NL: '', OP: '', PK: '' });
    setExportCurr({ NL: '', OP: '', PK: '' });
    setGenCurr({ NL: '', OP: '', PK: '' });
    setDutyOverride('');
    setSurchargeOverride('');
    await clearReadingsDraft();
  }

  async function handleSaveCalculation() {
    setSaving(true);
    setSaveFeedback('');
    try {
      const [yyyy, mm] = billingMonth.split('-');
      const consumerNo = baselineRecord?.consumerNo || settings.consumerNo || '';
      const consumerName = baselineRecord?.consumerName || settings.consumerName || 'Prosumer';
      const nowIso = new Date().toISOString();
      const record: BillRecord = {
        id: `estimate_${consumerNo || 'kseb'}_${billingMonth}`,
        recordType: 'meter_estimate',
        billingMonth,
        billingLabel: yyyy && mm ? `${mm}/${yyyy}` : billingMonth,
        consumerNo,
        consumerName,
        tariffPhase: phaseType,
        meterOwner,
        bankOpening: prevBank,
        bankClosing: calc.updatedBank,
        readings: {
          import: {
            NL: {
              ir: channels.import.NL.prev,
              fr: channels.import.NL.curr,
              mf: channels.import.NL.mf,
              units: channels.import.NL.units,
            },
            OP: {
              ir: channels.import.OP.prev,
              fr: channels.import.OP.curr,
              mf: channels.import.OP.mf,
              units: channels.import.OP.units,
            },
            PK: {
              ir: channels.import.PK.prev,
              fr: channels.import.PK.curr,
              mf: channels.import.PK.mf,
              units: channels.import.PK.units,
            },
          },
          export: {
            NL: {
              ir: channels.export.NL.prev,
              fr: channels.export.NL.curr,
              mf: channels.export.NL.mf,
              units: channels.export.NL.units,
            },
            OP: {
              ir: channels.export.OP.prev,
              fr: channels.export.OP.curr,
              mf: channels.export.OP.mf,
              units: channels.export.OP.units,
            },
            PK: {
              ir: channels.export.PK.prev,
              fr: channels.export.PK.curr,
              mf: channels.export.PK.mf,
              units: channels.export.PK.units,
            },
          },
          generation: {
            NL: {
              ir: channels.generation.NL.prev,
              fr: channels.generation.NL.curr,
              mf: channels.generation.NL.mf,
              units: channels.generation.NL.units,
            },
            OP: {
              ir: channels.generation.OP.prev,
              fr: channels.generation.OP.curr,
              mf: channels.generation.OP.mf,
              units: channels.generation.OP.units,
            },
            PK: {
              ir: channels.generation.PK.prev,
              fr: channels.generation.PK.curr,
              mf: channels.generation.PK.mf,
              units: channels.generation.PK.units,
            },
          },
        },
        summary: {
          totalImport: calc.importUnits,
          totalExport: calc.exportUnits,
          solarGenerated: calc.solarGenerated,
          ownConsumption: calc.ownConsumption,
          netImportBeforeBank: calc.netImportBeforeBank,
          netExport: calc.netExport,
          billedUnits: calc.billedUnits,
          fixedCharge: calc.fixedCharge,
          fixedSlabLabel: calc.fixedSlabLabel,
          energyCharge: calc.energyCharge,
          fuelSurcharge: calc.surchargeAmount,
          electricityDuty: calc.dutyAmount,
          meterRent: calc.meterCharge,
          roundOff: calc.roundOff,
          unroundedTotal: calc.unroundedTotal,
          totalAmount: calc.roundedTotal,
          consumerEquivalentTotal: calc.consumerComparison.roundedTotal,
          solarSavings: calc.consumerComparison.savings,
        },
        todAdjustmentMode: todMode,
        dutyRateUsed: calc.dutyPercent,
        surchargeRateUsed: calc.surchargeRate,
        tariffSource: `${tariffs.source} (${tariffs.fetchedAt.slice(0, 10)})`,
        createdAt: nowIso,
        updatedAt: nowIso,
        syncStatus: 'pending',
      };
      await onSaveCalculation(record);
      setSaveFeedback(`Saved calculation for ${record.billingLabel} to DB.`);
      setTimeout(() => setSaveFeedback(''), 4000);
    } finally {
      setSaving(false);
    }
  }

  function renderMeterGroup(
    title: string,
    group: 'import' | 'export' | 'generation',
    currMap: Record<ZoneKey, string>,
    setCurrMap: React.Dispatch<React.SetStateAction<Record<ZoneKey, string>>>,
    setPrevOverride: React.Dispatch<React.SetStateAction<Partial<Record<ZoneKey, string>>>>
  ) {
    const groupTotal =
      channels[group].NL.units + channels[group].OP.units + channels[group].PK.units;

    return (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">{title}</h2>
          <span className="badge badge-teal">Total: {groupTotal} kWh</span>
        </div>
        <div className="zone-rows">
          {ZONES.map((z) => {
            const ch = channels[group][z.key];
            const prevDisplay = getPrevInputDisplay(group, z.key);
            return (
              <div className="zone-row" key={`${group}_${z.key}`}>
                <div className="zone-badge">
                  <strong>{group === 'generation' ? z.solarCode : z.label}</strong>
                  <span>{group === 'generation' ? z.label : `MF ×${ch.mf}`}</span>
                </div>

                <div>
                  <label className="field-label">Previous (FR)</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    className={baselineRecord ? 'prev-autofilled' : ''}
                    value={prevDisplay}
                    onChange={(e) =>
                      setPrevOverride((old) => ({ ...old, [z.key]: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <label className="field-label">Current Reading</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    className={ch.invalid ? 'input-error' : ''}
                    placeholder={String(ch.prev)}
                    value={currMap[z.key]}
                    onChange={(e) =>
                      setCurrMap((old) => ({ ...old, [z.key]: e.target.value }))
                    }
                  />
                </div>

                <div className={`units-chip ${ch.invalid ? 'negative' : ''}`}>
                  {ch.invalid ? 'Curr < Prev' : `${ch.units} u`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      {baselineRecord ? (
        <div className="banner banner-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookmarkCheck size={18} />
            <span>
              Auto-filled <strong>Previous (FR)</strong> from{' '}
              <strong>
                {baselineRecord.recordType === 'official_bill' ? 'Official Bill' : 'Saved'}{' '}
                {baselineRecord.billingLabel}
              </strong>{' '}
              (Bank Closing: <strong>{baselineRecord.bankClosing}</strong> kWh)
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {records.length > 1 && (
              <select
                style={{ width: 'auto', padding: '5px 8px', fontSize: '0.82rem' }}
                value={baselineRecord.id}
                onChange={(e) => onSelectBaseline(e.target.value)}
                aria-label="Baseline bill"
              >
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.billingLabel} ({r.recordType === 'official_bill' ? 'PDF Bill' : 'Estimate'})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleResetPrevToBaseline}
              title="Reset any edited Previous readings back to the baseline bill"
            >
              <RotateCcw size={13} />
              Reset Prev
            </button>
          </div>
        </div>
      ) : (
        <div className="banner banner-warn">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={18} />
            <span>
              No previous KSEB bill uploaded yet. Upload your previous month&apos;s PDF bill to
              auto-fill all Previous Final Readings automatically every time you open the app.
            </span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpenPdfUpload}>
            <FileUp size={14} />
            Upload Bill PDF
          </button>
        </div>
      )}

      {/* Bill Parameters & ToD Mode Toggle */}
      <div className="card">
        <div className="grid-4" style={{ marginBottom: 12 }}>
          <div>
            <label className="field-label">Current Billing Month</label>
            <input
              type="month"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Phase</label>
            <select
              value={phaseType}
              onChange={(e) => setPhaseType(e.target.value as PhaseType)}
            >
              <option value="three">Three Phase</option>
              <option value="single">Single Phase</option>
            </select>
          </div>
          <div>
            <label className="field-label">Meter Owner</label>
            <select
              value={meterOwner}
              onChange={(e) => setMeterOwner(e.target.value as MeterOwner)}
            >
              <option value="prosumer">Customer / Prosumer (₹0)</option>
              <option value="kseb">KSEB Owned</option>
            </select>
          </div>
          <div>
            <label className="field-label">Previous Bank Balance</label>
            <input
              type="number"
              step="any"
              className={baselineRecord && bankOpeningOverride === '' ? 'prev-autofilled' : ''}
              value={
                bankOpeningOverride !== ''
                  ? bankOpeningOverride
                  : String(baselineRecord?.bankClosing ?? 0)
              }
              onChange={(e) => setBankOpeningOverride(e.target.value)}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
          }}
        >
          <div style={{ flex: '1 1 300px' }}>
            <label className="field-label">ToD Zone Adjustment Priority (&gt;250 net units)</label>
            <div className="segmented">
              <button
                type="button"
                className={todMode === 'anwarbio' ? 'active' : ''}
                onClick={() => {
                  setTodMode('anwarbio');
                  onChangeTodMode('anwarbio');
                }}
              >
                anwarbio Default (NL → OP → PK)
              </button>
              <button
                type="button"
                className={todMode === 'kseb' ? 'active' : ''}
                onClick={() => {
                  setTodMode('kseb');
                  onChangeTodMode('kseb');
                }}
              >
                KSEB OrumaNET (PK → NL → OP)
              </button>
            </div>
          </div>

          <div style={{ flex: '1 1 280px' }}>
            <label className="field-label">Own Consumption (Solar Gen − Export)</label>
            <div className="segmented">
              <button
                type="button"
                className={!allowNegativeOC ? 'active' : ''}
                onClick={() => {
                  setAllowNegativeOC(false);
                  onChangeAllowNegativeOC(false);
                }}
              >
                Clamp ≥ 0 (KSEB Safe)
              </button>
              <button
                type="button"
                className={allowNegativeOC ? 'active' : ''}
                onClick={() => {
                  setAllowNegativeOC(true);
                  onChangeAllowNegativeOC(true);
                }}
              >
                Exact anwarbio (Allow −)
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ width: 92 }}>
              <label className="field-label">Duty (%)</label>
              <input
                type="number"
                step="0.1"
                placeholder={String(calc.dutyPercent)}
                value={dutyOverride}
                onChange={(e) => setDutyOverride(e.target.value)}
              />
            </div>
            <div style={{ width: 112 }}>
              <label className="field-label">FS (₹/unit)</label>
              <input
                type="number"
                step="0.01"
                placeholder={String(calc.surchargeRate)}
                value={surchargeOverride}
                onChange={(e) => setSurchargeOverride(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleClearCurrent}
              title="Clear entered Current readings"
            >
              <Eraser size={14} />
              Clear Current
            </button>
          </div>
        </div>

        {calc.surchargeFallbackUsed && (
          <div className="banner banner-warn" style={{ marginTop: 10, marginBottom: 0 }}>
            <span>
              Fuel Surcharge for <strong>{billingMonth}</strong> is not yet published in{' '}
              <code>other_charges.csv</code> on GitHub; using latest available rate (₹
              {calc.surchargeRate}/unit). You can override FS above if needed.
            </span>
          </div>
        )}
      </div>

      {hasNegativeDiff && (
        <div className="banner banner-danger">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} />
            <span>
              One or more Current readings are smaller than Previous (FR). Please double-check your
              meter numbers.
            </span>
          </div>
        </div>
      )}

      {calc.exportUnits > calc.solarGenerated && (
        <div className="banner banner-warn">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>
              Net Export (<strong>{calc.exportUnits} kWh</strong>) exceeds Solar Generation (
              <strong>{calc.solarGenerated} kWh</strong>) by{' '}
              <strong>{calc.exportUnits - calc.solarGenerated} kWh</strong>.{' '}
              {allowNegativeOC ? (
                <>
                  <strong>Exact anwarbio</strong> mode is active, so Own Consumption is{' '}
                  <strong>{calc.ownConsumption} kWh</strong> (Fixed Charge usage{' '}
                  <strong>{calc.totalUnitsForFixed} kWh</strong>).
                </>
              ) : (
                <>
                  Own Consumption is clamped to <strong>0 kWh</strong> (Fixed Charge usage{' '}
                  <strong>{calc.totalUnitsForFixed} kWh</strong>). Switch to{' '}
                  <strong>Exact anwarbio (Allow −)</strong> above if you want{' '}
                  {calc.solarGenerated - calc.exportUnits} kWh.
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Meter Inputs */}
      {renderMeterGroup(
        '1. Net Meter — Import Readings',
        'import',
        importCurr,
        setImportCurr,
        setImportPrevOverride
      )}
      {renderMeterGroup(
        '2. Net Meter — Export Readings',
        'export',
        exportCurr,
        setExportCurr,
        setExportPrevOverride
      )}
      {renderMeterGroup(
        '3. Solar Generation Meter Readings',
        'generation',
        genCurr,
        setGenCurr,
        setGenPrevOverride
      )}

      {/* Live Result Card */}
      <div className="result-hero">
        <div className="result-amounts">
          <div>
            <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600 }}>
              ESTIMATED KSEB PROSUMER BILL ({billingMonth})
            </div>
            <div className="big-rupee">₹ {calc.roundedTotal.toFixed(2)}</div>
            <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: 2 }}>
              anwarbio Unrounded: <strong>₹ {calc.unroundedTotal.toFixed(2)}</strong> • Round Off:{' '}
              <strong>
                {calc.roundOff >= 0 ? '+' : ''}
                {calc.roundOff.toFixed(2)}
              </strong>{' '}
              • Method:{' '}
              <strong>
                {calc.billingMethod === 'telescopic' ? 'Telescopic (≤250 u)' : 'ToD Non-Telescopic'}
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || hasNegativeDiff}
              onClick={handleSaveCalculation}
              style={{ background: '#14b8a6', color: '#042f2e' }}
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Month Calculation to DB'}
            </button>
          </div>
        </div>
        {saveFeedback && (
          <div style={{ marginTop: 10, color: '#86efac', fontWeight: 600, fontSize: '0.86rem' }}>
            ✓ {saveFeedback}
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid-3" style={{ marginBottom: 14 }}>
        <div className="metric-box">
          <div className="label">Total Import / Export</div>
          <div className="val">
            {calc.importUnits} / {calc.exportUnits} kWh
          </div>
        </div>
        <div className="metric-box">
          <div className="label">Solar Gen / Own Use (OC)</div>
          <div className="val">
            {calc.solarGenerated} / {calc.ownConsumption} kWh
          </div>
        </div>
        <div className="metric-box">
          <div className="label">Billed Units / Closing Bank</div>
          <div className="val">
            {calc.billedUnits} u / {calc.updatedBank} u
          </div>
        </div>
      </div>

      {/* Charge Breakdown & Savings */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Bill Breakdown</h3>
            <span className="badge badge-sky">
              {calc.mode === 'anwarbio' ? 'anwarbio NL→OP→PK' : 'OrumaNET PK→NL→OP'}
            </span>
          </div>
          <table className="data-table">
            <tbody>
              <tr>
                <td>
                  Fixed Charge
                  <div className="text-muted">
                    Usage {calc.totalUnitsForFixed} u ({calc.fixedSlabLabel}, {phaseType})
                  </div>
                </td>
                <td className="num">
                  <strong>₹ {calc.fixedCharge.toFixed(2)}</strong>
                </td>
              </tr>
              <tr>
                <td>
                  Energy Charge ({calc.billedUnits} u)
                  <div className="text-muted">
                    {calc.energyBreakdownLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </td>
                <td className="num">
                  <strong>₹ {calc.energyCharge.toFixed(2)}</strong>
                </td>
              </tr>
              <tr>
                <td>
                  Fuel Surcharge
                  <div className="text-muted">
                    {calc.billedUnits} u × ₹{calc.surchargeRate}/u
                  </div>
                </td>
                <td className="num">
                  <strong>₹ {calc.surchargeAmount.toFixed(2)}</strong>
                </td>
              </tr>
              <tr>
                <td>
                  Electricity Duty
                  <div className="text-muted">{calc.dutyPercent}% of Energy Charge</div>
                </td>
                <td className="num">
                  <strong>₹ {calc.dutyAmount.toFixed(2)}</strong>
                </td>
              </tr>
              <tr>
                <td>Meter Rent ({meterOwner === 'prosumer' ? 'Customer' : 'KSEB'})</td>
                <td className="num">
                  <strong>₹ {calc.meterCharge.toFixed(2)}</strong>
                </td>
              </tr>
              <tr>
                <td>Round Off</td>
                <td className="num">
                  {calc.roundOff >= 0 ? '+' : ''}
                  {calc.roundOff.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Estimated Demand</strong>
                </td>
                <td className="num">
                  <strong>₹ {calc.roundedTotal.toFixed(2)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Sparkles size={16} color="#0f766e" />
              ToD Adjustment & Solar Savings
            </h3>
          </div>
          <table className="data-table" style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>Zone</th>
                <th className="num">Import</th>
                <th className="num">Export</th>
                <th className="num">Billed</th>
              </tr>
            </thead>
            <tbody>
              {ZONES.map((z) => (
                <tr key={z.key}>
                  <td>{z.key}</td>
                  <td className="num">{channels.import[z.key].units}</td>
                  <td className="num">{channels.export[z.key].units}</td>
                  <td className="num">
                    <strong>{calc.zoneBreakdown.adjustedImportAfterBank[z.key]}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="banner banner-success" style={{ marginBottom: 0 }}>
            <div>
              <div style={{ fontWeight: 700 }}>
                Estimated Monthly Solar Savings: ₹ {calc.consumerComparison.savings.toFixed(2)}
              </div>
              <div style={{ fontSize: '0.8rem' }}>
                Without solar ({calc.consumerComparison.consumerUnits} u consumer bill): ₹{' '}
                {calc.consumerComparison.unroundedTotal.toFixed(2)} − Prosumer bill: ₹{' '}
                {calc.unroundedTotal.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
