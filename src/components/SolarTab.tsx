import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  FileSpreadsheet,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AppSettings,
  BillRecord,
  SolarBillMatchMode,
  SolarGenerationRecord,
} from '../types';
import {
  computeAllSolarMonthStats,
  computeSolarYearSummary,
  parseSolarInverterCsv,
} from '../services/solarCalculator';
import {
  SolarDailyAvgLineChart,
  SolarWeeklyLineChart,
  SolarYearlyColumnChart,
} from './SolarCharts';

interface SolarTabProps {
  solarRecords: SolarGenerationRecord[];
  billRecords: BillRecord[];
  settings: AppSettings;
  cloudEmail: string | null;
  solarTableMissing: boolean;
  onUpdateSettings: (next: AppSettings) => Promise<void>;
  onSaveSolarRecords: (records: SolarGenerationRecord[]) => Promise<void>;
  onDeleteSolarRecord: (id: string) => Promise<void>;
}

const SOLAR_TABLE_SQL = `-- Run once in Supabase SQL Editor to sync Solar CSV data across devices:
create table if not exists public.solar_records (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_month text not null,
  payload jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists idx_solar_records_user_month
  on public.solar_records (user_id, billing_month desc);

alter table public.solar_records enable row level security;

revoke all on public.solar_records from anon;
grant select, insert, update, delete on public.solar_records to authenticated;

create policy "Users read own solar records" on public.solar_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own solar records" on public.solar_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own solar records" on public.solar_records
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own solar records" on public.solar_records
  for delete to authenticated using ((select auth.uid()) = user_id);`;

function formatMetric(val: number | null | undefined, maxDecimals = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return String(Number(val.toFixed(maxDecimals)));
}

export function SolarTab({
  solarRecords,
  billRecords,
  settings,
  cloudEmail,
  solarTableMissing,
  onUpdateSettings,
  onSaveSolarRecords,
  onDeleteSolarRecord,
}: SolarTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const plantKw =
    settings.solarPlantCapacityKw && settings.solarPlantCapacityKw > 0
      ? settings.solarPlantCapacityKw
      : 5;
  const matchMode: SolarBillMatchMode = settings.solarBillMatchMode ?? 'next_month';

  const [plantKwInput, setPlantKwInput] = useState(String(plantKw));
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);

  const [editingMeterLink, setEditingMeterLink] = useState(false);
  const [importDraft, setImportDraft] = useState('');
  const [exportDraft, setExportDraft] = useState('');
  const [showDailyReadings, setShowDailyReadings] = useState(false);

  useEffect(() => {
    setPlantKwInput(String(plantKw));
  }, [plantKw]);

  const allStats = useMemo(
    () => computeAllSolarMonthStats(solarRecords, billRecords, plantKw, matchMode),
    [solarRecords, billRecords, plantKw, matchMode]
  );

  const availableYears = useMemo(() => {
    const yrs = new Set<number>();
    for (const s of allStats) yrs.add(s.year);
    if (yrs.size === 0) yrs.add(new Date().getFullYear());
    return Array.from(yrs).sort((a, b) => b - a);
  }, [allStats]);

  const [selectedYear, setSelectedYear] = useState<number>(
    availableYears[0] ?? new Date().getFullYear()
  );

  useEffect(() => {
    if (!availableYears.includes(selectedYear) && availableYears.length > 0) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);

  const yearSummary = useMemo(
    () => computeSolarYearSummary(selectedYear, allStats, plantKw),
    [selectedYear, allStats, plantKw]
  );

  const yearMonthStats = useMemo(
    () => allStats.filter((s) => s.year === selectedYear),
    [allStats, selectedYear]
  );

  const [selectedMonth, setSelectedMonth] = useState<string>(
    yearMonthStats[yearMonthStats.length - 1]?.record.billingMonth ?? ''
  );

  useEffect(() => {
    const hasSelected = yearMonthStats.some((s) => s.record.billingMonth === selectedMonth);
    if (!hasSelected) {
      setSelectedMonth(yearMonthStats[yearMonthStats.length - 1]?.record.billingMonth ?? '');
    }
  }, [yearMonthStats, selectedMonth]);

  const selectedStats = useMemo(
    () => allStats.find((s) => s.record.billingMonth === selectedMonth) ?? null,
    [allStats, selectedMonth]
  );

  useEffect(() => {
    setEditingMeterLink(false);
    setShowDailyReadings(false);
    setImportDraft(
      selectedStats?.record.importOverride !== undefined
        ? String(selectedStats.record.importOverride)
        : ''
    );
    setExportDraft(
      selectedStats?.record.exportOverride !== undefined
        ? String(selectedStats.record.exportOverride)
        : ''
    );
  }, [selectedStats?.record.id, selectedStats?.record.importOverride, selectedStats?.record.exportOverride]);

  const lifetimeTotals = useMemo(() => {
    const totalUnits = allStats.reduce((acc, s) => acc + s.totalUnits, 0);
    const totalDays = allStats.reduce((acc, s) => acc + s.recordedDays, 0);
    const dailyAvg = totalDays > 0 ? totalUnits / totalDays : 0;
    const monthlyAvg = allStats.length > 0 ? totalUnits / allStats.length : 0;
    const perKw = dailyAvg > 0 ? dailyAvg / plantKw : 0;
    return { totalUnits, totalDays, dailyAvg, monthlyAvg, perKw };
  }, [allStats, plantKw]);

  async function handleCsvFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadStatus('');
    setUploadError('');

    const parsedRecords: SolarGenerationRecord[] = [];
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const recs = parseSolarInverterCsv(text, file.name);
        for (const r of recs) {
          parsedRecords.push(r);
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Failed to parse ${file.name}`);
      }
    }

    if (parsedRecords.length > 0) {
      // Preserve any existing manual import/export overrides when re-uploading a month CSV
      const existingById = new Map(solarRecords.map((r) => [r.id, r]));
      const mergedToSave = parsedRecords.map((rec) => {
        const prev = existingById.get(rec.id);
        return prev
          ? {
              ...rec,
              importOverride: prev.importOverride,
              exportOverride: prev.exportOverride,
              notes: prev.notes,
              createdAt: prev.createdAt || rec.createdAt,
            }
          : rec;
      });

      await onSaveSolarRecords(mergedToSave);
      const latest = [...mergedToSave].sort((a, b) =>
        b.billingMonth.localeCompare(a.billingMonth)
      )[0];
      if (latest) {
        const yr = parseInt(latest.billingMonth.slice(0, 4), 10);
        if (Number.isFinite(yr)) setSelectedYear(yr);
        setSelectedMonth(latest.billingMonth);
      }

      const labels = mergedToSave
        .map(
          (r) =>
            `${r.billingLabel} (${r.dailyReadings.reduce((s, d) => s + d.units, 0)} kWh, ${
              r.dailyReadings.length
            } d)`
        )
        .join(' • ');
      setUploadStatus(`Saved ${mergedToSave.length} month(s): ${labels}`);
    }

    if (errors.length > 0) {
      setUploadError(errors.join(' | '));
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handlePlantKwBlur() {
    const n = parseFloat(plantKwInput);
    if (!Number.isFinite(n) || n <= 0) {
      setPlantKwInput(String(plantKw));
      return;
    }
    if (n !== plantKw) {
      await onUpdateSettings({ ...settings, solarPlantCapacityKw: n });
    }
  }

  async function handleSaveMeterOverrides() {
    if (!selectedStats) return;
    const imp = importDraft.trim() === '' ? undefined : parseFloat(importDraft);
    const exp = exportDraft.trim() === '' ? undefined : parseFloat(exportDraft);
    const updated: SolarGenerationRecord = {
      ...selectedStats.record,
      importOverride: imp !== undefined && Number.isFinite(imp) ? imp : undefined,
      exportOverride: exp !== undefined && Number.isFinite(exp) ? exp : undefined,
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending',
    };
    await onSaveSolarRecords([updated]);
    setEditingMeterLink(false);
  }

  async function handleDeleteMonth(rec: SolarGenerationRecord) {
    if (!confirm(`Delete ${rec.billingLabel} solar generation data?`)) return;
    await onDeleteSolarRecord(rec.id);
  }

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(SOLAR_TABLE_SQL);
      setSqlCopied(true);
      setTimeout(() => setSqlCopied(false), 3000);
    } catch {
      setSqlCopied(false);
    }
  }

  return (
    <div>
      {cloudEmail && solarTableMissing && (
        <div className="banner banner-warn">
          <div>
            <strong>Cloud table missing (`solar_records`):</strong> Run the updated SQL once in
            Supabase SQL Editor so your uploaded CSV months sync across devices. Your local DB
            still saves everything offline.
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleCopySql}>
            <Copy size={14} />
            {sqlCopied ? 'Copied SQL!' : 'Copy solar_records SQL'}
          </button>
        </div>
      )}

      {/* Upload & Plant Controls */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">
              <Sun size={18} color="#0f766e" />
              Solar Inverter Generation ({plantKw}kW Plant)
            </h2>
            <p className="text-muted" style={{ margin: '3px 0 0' }}>
              Upload one or multiple monthly CSV files (`DD-MM-YYYY, Units Produced`) to build
              weekly, monthly, and yearly analytics.
            </p>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleCsvFiles(e.target.files)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              {uploading ? 'Parsing CSV...' : 'Upload Monthly CSV(s)'}
            </button>
          </div>
        </div>

        <div className="grid-4" style={{ marginBottom: 12 }}>
          <div>
            <label className="field-label">Select Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Plant Capacity (kW)</label>
            <input
              type="number"
              step="0.1"
              min="0.5"
              value={plantKwInput}
              onChange={(e) => setPlantKwInput(e.target.value)}
              onBlur={handlePlantKwBlur}
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="field-label">KSEB Bill Import / Export Link</label>
            <select
              value={matchMode}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  solarBillMatchMode: e.target.value as SolarBillMatchMode,
                })
              }
            >
              <option value="next_month">
                Next Month KSEB Bill (01-(M+1) reads Month M — OrumaNET standard)
              </option>
              <option value="same_month">Same Billing Month (MM/YYYY → MM/YYYY)</option>
            </select>
          </div>
        </div>

        {/* Lifetime Totals Strip */}
        <div className="grid-4">
          <div className="metric-box">
            <div className="label">Total Units Produced (All Time)</div>
            <div className="val">{formatMetric(lifetimeTotals.totalUnits)} kWh</div>
          </div>
          <div className="metric-box">
            <div className="label">Average Production Till Now</div>
            <div className="val">{lifetimeTotals.dailyAvg.toFixed(2)} u/day</div>
            <div className="text-muted" style={{ fontSize: '0.73rem', marginTop: 2 }}>
              {formatMetric(lifetimeTotals.monthlyAvg, 1)} kWh / month
            </div>
          </div>
          <div className="metric-box">
            <div className="label">Daily Production Per kW</div>
            <div className="val">{lifetimeTotals.perKw.toFixed(2)} u/kW</div>
          </div>
          <div className="metric-box">
            <div className="label">Saved Solar Months</div>
            <div className="val">{allStats.length}</div>
            <div className="text-muted" style={{ fontSize: '0.73rem', marginTop: 2 }}>
              {lifetimeTotals.totalDays} total days recorded
            </div>
          </div>
        </div>

        {uploadStatus && (
          <div className="banner banner-success" style={{ marginTop: 12, marginBottom: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={16} />
              {uploadStatus}
            </span>
          </div>
        )}
        {uploadError && (
          <div className="banner banner-warn" style={{ marginTop: 12, marginBottom: 0 }}>
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {allStats.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
          <FileSpreadsheet size={34} color="#0f766e" style={{ marginBottom: 8 }} />
          <h3 style={{ margin: '0 0 6px' }}>No Solar Generation CSVs Uploaded Yet</h3>
          <p className="text-muted" style={{ maxWidth: 480, margin: '0 auto 14px' }}>
            Upload your inverter&apos;s monthly CSV files (e.g., `04-2025.csv`, `05-2025.csv`,
            `06-2025.csv`) to generate weekly averages, yearly tables, and production charts.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} />
            Choose CSV File(s)
          </button>
        </div>
      ) : (
        <>
          {/* Yearly Tabular Summary (Reference Image 3) */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">{selectedYear} Yearly Solar Summary</h2>
                <span className="text-muted">
                  Tap any populated month row to view or edit that month&apos;s detailed breakdown
                </span>
              </div>
              <span className="badge badge-teal">
                {yearSummary.monthsWithData} month{yearSummary.monthsWithData === 1 ? '' : 's'}
              </span>
            </div>

            <div className="solar-year-table-wrap">
              <table className="data-table solar-year-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Units Produced</th>
                    <th className="num">Daily Avg (Units)</th>
                    <th className="num">Per kW</th>
                    <th className="num">Max Units</th>
                    <th className="num">Min Units</th>
                    {Array.from({ length: yearSummary.maxWeekCount }, (_, i) => (
                      <th key={i} className="num">
                        Week {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {yearSummary.rows.map((row) => {
                    const st = row.stats;
                    const isSelected = st !== null && st.record.billingMonth === selectedMonth;
                    return (
                      <tr
                        key={row.billingMonth}
                        onClick={() => st && setSelectedMonth(st.record.billingMonth)}
                        className={isSelected ? 'solar-row-active' : undefined}
                        style={{ cursor: st ? 'pointer' : 'default' }}
                      >
                        <td>
                          <strong>{row.monthName}</strong>
                        </td>
                        <td className="num">{st ? formatMetric(st.totalUnits) : '—'}</td>
                        <td className="num">{st ? st.dailyAverage.toFixed(2) : '—'}</td>
                        <td className="num">{st ? st.productionPerKw.toFixed(2) : '—'}</td>
                        <td className="num">{st ? formatMetric(st.maxUnits) : '—'}</td>
                        <td className="num">{st ? formatMetric(st.minUnits) : '—'}</td>
                        {Array.from({ length: yearSummary.maxWeekCount }, (_, i) => {
                          const wk = st?.weeks[i];
                          return (
                            <td key={i} className="num">
                              {wk ? formatMetric(wk.averageUnits, 1) : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="solar-summary-row">
                    <td>
                      <strong>Total Units</strong>
                    </td>
                    <td className="num">
                      <strong>{formatMetric(yearSummary.totalUnits)}</strong>
                    </td>
                    <td className="num" colSpan={4 + yearSummary.maxWeekCount}>
                      <span className="text-muted">
                        Monthly Avg: {formatMetric(yearSummary.monthlyAverageInYear, 1)} kWh / mo (
                        {yearSummary.totalRecordedDays} recorded days)
                      </span>
                    </td>
                  </tr>
                  <tr className="solar-summary-row">
                    <td>
                      <strong>Average Production in {selectedYear}</strong>
                    </td>
                    <td className="num">—</td>
                    <td className="num">
                      <strong>{yearSummary.dailyAverageInYear.toFixed(2)}</strong>
                    </td>
                    <td className="num">
                      <strong>{yearSummary.productionPerKwInYear.toFixed(2)}</strong>
                    </td>
                    <td className="num" colSpan={2 + yearSummary.maxWeekCount}>
                      <span className="text-muted">Weighted daily avg across uploaded days</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Yearly Charts: Column Chart + Daily Average Line Chart (Reference Image 4) */}
          <div className="grid-2" style={{ marginBottom: 14 }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <SolarYearlyColumnChart
                year={selectedYear}
                plantCapacityKw={plantKw}
                rows={yearSummary.rows}
              />
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <SolarDailyAvgLineChart
                year={selectedYear}
                plantCapacityKw={plantKw}
                rows={yearSummary.rows}
              />
            </div>
          </div>

          {/* Monthly Detail View (Reference Images 1 & 2) */}
          {selectedStats && (
            <div className="card">
              <div className="card-header" style={{ flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Calendar size={18} color="#0f766e" />
                  <h2 className="card-title">Monthly Breakdown</h2>
                  <div className="solar-month-pills">
                    {yearMonthStats.map((st) => (
                      <button
                        key={st.record.billingMonth}
                        type="button"
                        className={`btn btn-sm ${
                          st.record.billingMonth === selectedMonth ? 'btn-primary' : 'btn-outline'
                        }`}
                        onClick={() => setSelectedMonth(st.record.billingMonth)}
                      >
                        {st.monthName.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setEditingMeterLink((v) => !v)}
                    title="Override Import/Export if KSEB bill PDF is not uploaded yet"
                  >
                    <Edit3 size={14} />
                    {editingMeterLink ? 'Cancel' : 'Edit Import/Export'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-sm"
                    onClick={() => handleDeleteMonth(selectedStats.record)}
                    title="Delete this month's solar CSV"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>

              <div className="solar-month-banner">
                <span>
                  {selectedStats.monthName} {selectedStats.year}
                </span>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, opacity: 0.85 }}>
                  {selectedStats.recordedDays}/{selectedStats.daysInMonth} days •{' '}
                  {selectedStats.record.sourceFilename}
                </span>
              </div>

              {editingMeterLink && (
                <div className="banner banner-info" style={{ marginBottom: 12 }}>
                  <div style={{ flex: '1 1 180px' }}>
                    <strong>Import / Export Override ({selectedStats.monthName}):</strong>{' '}
                    <span className="text-muted">
                      Leave blank to auto-fill from KSEB Bill History (
                      {matchMode === 'next_month' ? 'next month bill' : 'same month bill'}).
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                    <div style={{ width: 100 }}>
                      <label className="field-label">Import (kWh)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="Auto"
                        value={importDraft}
                        onChange={(e) => setImportDraft(e.target.value)}
                      />
                    </div>
                    <div style={{ width: 100 }}>
                      <label className="field-label">Export (kWh)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="Auto"
                        value={exportDraft}
                        onChange={(e) => setExportDraft(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleSaveMeterOverrides}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              {/* 6-Metric Top Strip matching Reference Images 1 & 2 */}
              <div className="grid-6" style={{ marginBottom: 14 }}>
                <div className="metric-box">
                  <div className="label">Total Units Produced</div>
                  <div className="val">{formatMetric(selectedStats.totalUnits)}</div>
                </div>
                <div className="metric-box">
                  <div className="label">Daily Average Production</div>
                  <div className="val">{selectedStats.dailyAverage.toFixed(2)}</div>
                </div>
                <div className="metric-box">
                  <div className="label">Estimated Production</div>
                  <div className="val">{formatMetric(selectedStats.estimatedProduction)}</div>
                </div>
                <div className="metric-box">
                  <div className="label">Import</div>
                  <div className="val">{formatMetric(selectedStats.importUnits)}</div>
                  {selectedStats.matchedBillMonth &&
                    selectedStats.record.importOverride === undefined && (
                      <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                        From {selectedStats.matchedBillMonth} bill
                      </div>
                    )}
                </div>
                <div className="metric-box">
                  <div className="label">Export</div>
                  <div className="val">{formatMetric(selectedStats.exportUnits)}</div>
                </div>
                <div className="metric-box">
                  <div className="label">Average Import</div>
                  <div className="val">{formatMetric(selectedStats.averageImport)}</div>
                  {selectedStats.exactAverageImport !== null && (
                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                      Exact: {selectedStats.exactAverageImport.toFixed(2)}
                    </div>
                  )}
                </div>
              </div>

              {/* Left Stats + Right Weekly Line Chart */}
              <div className="solar-month-split">
                <div className="solar-stat-grid">
                  <div className="solar-stat-cell">
                    <div className="solar-stat-head">Max Production</div>
                    <div className="solar-stat-val">{formatMetric(selectedStats.maxUnits)}</div>
                  </div>
                  <div className="solar-stat-cell">
                    <div className="solar-stat-head">Min Production</div>
                    <div className="solar-stat-val">{formatMetric(selectedStats.minUnits)}</div>
                  </div>
                  {selectedStats.weeks.map((wk) => (
                    <div className="solar-stat-cell" key={wk.weekNumber}>
                      <div className="solar-stat-head">
                        Week {wk.weekNumber} Average ({wk.rangeLabel})
                      </div>
                      <div className="solar-stat-val">
                        {formatMetric(wk.averageUnits, 1)}
                      </div>
                    </div>
                  ))}
                  <div className="solar-stat-cell">
                    <div className="solar-stat-head">Production Per kW</div>
                    <div className="solar-stat-val">
                      {selectedStats.productionPerKw.toFixed(2)}
                    </div>
                  </div>
                </div>

                <div>
                  <SolarWeeklyLineChart
                    monthName={selectedStats.monthName}
                    weeks={selectedStats.weeks}
                  />
                </div>
              </div>

              {/* Collapsible Daily CSV Readings */}
              <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowDailyReadings((v) => !v)}
                >
                  {showDailyReadings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showDailyReadings ? 'Hide' : 'Show'} Daily CSV Readings (
                  {selectedStats.recordedDays} days)
                </button>

                {showDailyReadings && (
                  <div style={{ marginTop: 10, overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th className="num">Units Produced (kWh)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedStats.record.dailyReadings.map((d) => (
                          <tr key={d.date}>
                            <td>{d.date.split('-').reverse().join('-')}</td>
                            <td className="num">
                              <strong>{d.units}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
