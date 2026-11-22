import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Maximize2, X } from 'lucide-react';
import type { SolarWeekSummary, SolarYearTableRow } from '../services/solarCalculator';
import { downloadCanvasAsPng, sanitizeImageFilename } from '../services/imageExport';

interface ChartPoint {
  label: string;
  value: number | null;
  detail?: string;
}

function computeNiceScale(maxValue: number, targetTicks = 5): { yMax: number; ticks: number[] } {
  const safeMax = maxValue > 0 ? maxValue : 10;
  const roughStep = safeMax / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(roughStep));
  const norm = roughStep / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = niceNorm * mag;
  const yMax = Math.max(step, Math.ceil((safeMax * 1.12) / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + step * 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return { yMax: ticks[ticks.length - 1] ?? yMax, ticks };
}

interface ChartFrameProps {
  title: string;
  tooltipContent: string | null;
  tooltipTone?: 'sky' | 'teal';
  allowExpand?: boolean;
  bordered?: boolean;
  renderSvg: (enlarged: boolean) => ReactNode;
}

async function exportChartSvgAsPng(svgEl: SVGSVGElement, title: string): Promise<void> {
  const vb = svgEl.viewBox.baseVal;
  const svgW = vb && vb.width > 0 ? vb.width : svgEl.clientWidth || 780;
  const svgH = vb && vb.height > 0 ? vb.height : svgEl.clientHeight || 340;

  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(svgW));
  clone.setAttribute('height', String(svgH));
  clone.style.fontFamily =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif';

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not render chart SVG to image.'));
      image.src = svgUrl;
    });

    const scale = 2;
    const padX = 24;
    const titleAreaH = 44;
    const padBottom = 16;
    const totalW = svgW + padX * 2;
    const totalH = titleAreaH + svgH + padBottom;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(totalW * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable.');

    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, padX, 24, totalW - padX * 2);

    ctx.drawImage(img, padX, titleAreaH, svgW, svgH);

    await downloadCanvasAsPng(canvas, sanitizeImageFilename(title));
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function ChartFrame({
  title,
  tooltipContent,
  tooltipTone = 'sky',
  allowExpand = true,
  bordered = true,
  renderSvg,
}: ChartFrameProps) {
  const [enlarged, setEnlarged] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [saveError, setSaveError] = useState('');
  const enlargedBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enlarged) return;
    setSaveError('');
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setEnlarged(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enlarged]);

  async function handleSaveImage() {
    const svgEl = enlargedBodyRef.current?.querySelector('svg');
    if (!svgEl) return;
    setSavingImage(true);
    setSaveError('');
    try {
      await exportChartSvgAsPng(svgEl, title);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save chart image.');
    } finally {
      setSavingImage(false);
    }
  }

  return (
    <>
      <div className={bordered ? 'solar-chart-box' : 'solar-chart-inline'}>
        <div className="solar-chart-header">
          <div className="solar-chart-title">{title}</div>
          {allowExpand && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setEnlarged(true)}
              title="View enlarged graph"
            >
              <Maximize2 size={13} />
              Enlarge
            </button>
          )}
        </div>

        {/* Fixed-height status strip prevents layout shift / hover jitter */}
        <div className="solar-chart-tooltip-bar">
          {tooltipContent ? (
            <span className={`badge ${tooltipTone === 'teal' ? 'badge-teal' : 'badge-sky'}`}>
              {tooltipContent}
            </span>
          ) : (
            <span className="text-muted" style={{ fontSize: '0.77rem' }}>
              Hover or tap a value to inspect details
            </span>
          )}
        </div>

        {renderSvg(false)}
      </div>

      {enlarged && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={() => setEnlarged(false)}
        >
          <div
            className="modal-panel modal-panel-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header" style={{ marginBottom: 6 }}>
              <h2 className="card-title">{title}</h2>
              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={savingImage}
                  onClick={handleSaveImage}
                  title="Download high-resolution PNG image"
                >
                  <Download size={15} />
                  {savingImage ? 'Saving...' : 'Save Image'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setEnlarged(false)}
                  aria-label="Close enlarged chart"
                >
                  <X size={16} />
                  Close
                </button>
              </div>
            </div>
            <div className="solar-chart-tooltip-bar" style={{ marginBottom: 8 }}>
              {saveError ? (
                <span className="badge badge-amber">{saveError}</span>
              ) : tooltipContent ? (
                <span className={`badge ${tooltipTone === 'teal' ? 'badge-teal' : 'badge-sky'}`}>
                  {tooltipContent}
                </span>
              ) : (
                <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                  Hover or tap any month / point to inspect details
                </span>
              )}
            </div>
            <div ref={enlargedBodyRef}>{renderSvg(true)}</div>
          </div>
        </div>
      )}
    </>
  );
}

interface LineChartBaseProps {
  title: string;
  xLabel?: string;
  yLabel: string;
  points: ChartPoint[];
  strokeColor?: string;
  height?: number;
  maxWidthViewBox?: number;
  bordered?: boolean;
}

function LineChartSvg({
  title,
  xLabel,
  yLabel,
  points,
  strokeColor = '#4f6bed',
  height = 240,
  maxWidthViewBox = 560,
  bordered = false,
}: LineChartBaseProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const numericValues = points.map((p) => p.value).filter((v): v is number => v !== null);
  const maxVal = numericValues.length > 0 ? Math.max(...numericValues) : 10;
  const { yMax, ticks } = computeNiceScale(maxVal, 5);

  const activePoint = hoverIdx !== null ? points[hoverIdx] : null;
  const tooltipText =
    activePoint && activePoint.value !== null
      ? activePoint.detail ?? `${activePoint.label}: ${activePoint.value}`
      : null;

  function renderSvg(enlarged: boolean) {
    const viewW = enlarged ? Math.max(maxWidthViewBox, 780) : maxWidthViewBox;
    const viewH = enlarged ? Math.max(height + 90, 340) : height;
    const padL = enlarged ? 56 : 50;
    const padR = 18;
    const padT = enlarged ? 32 : 28;
    const padB = xLabel ? (enlarged ? 48 : 44) : 32;
    const plotW = viewW - padL - padR;
    const plotH = viewH - padT - padB;

    const count = Math.max(1, points.length);
    const slotW = plotW / count;
    const getX = (i: number) => padL + slotW * i + slotW / 2;
    const getY = (val: number) => padT + plotH - (val / yMax) * plotH;

    const segments: string[] = [];
    let currentSeg: string[] = [];
    points.forEach((p, idx) => {
      if (p.value !== null) {
        currentSeg.push(`${getX(idx).toFixed(1)},${getY(p.value).toFixed(1)}`);
      } else if (currentSeg.length > 0) {
        segments.push(currentSeg.join(' '));
        currentSeg = [];
      }
    });
    if (currentSeg.length > 0) {
      segments.push(currentSeg.join(' '));
    }

    const fontSizeTick = enlarged ? 12 : 11;
    const fontSizeVal = enlarged ? 12 : 10.5;

    return (
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        className="solar-svg"
        role="img"
        aria-label={title}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {ticks.map((t) => {
          const y = getY(t);
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={viewW - padR}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={fontSizeTick}
                fill="#64748b"
              >
                {t}
              </text>
            </g>
          );
        })}

        <text
          x={14}
          y={padT + plotH / 2}
          textAnchor="middle"
          fontSize={fontSizeTick}
          fontWeight="600"
          fill="#64748b"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}
        >
          {yLabel}
        </text>

        {segments.map((pts, sIdx) => (
          <polyline
            key={sIdx}
            fill="none"
            stroke={strokeColor}
            strokeWidth={enlarged ? 3.2 : 2.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={pts}
          />
        ))}

        {/* Highlight vertical guide line for active point */}
        {hoverIdx !== null && points[hoverIdx]?.value !== null && (
          <line
            x1={getX(hoverIdx)}
            y1={padT}
            x2={getX(hoverIdx)}
            y2={padT + plotH}
            stroke="#cbd5e1"
            strokeDasharray="3 3"
            strokeWidth="1.2"
          />
        )}

        {points.map((p, idx) => {
          const x = getX(idx);
          const isHovered = hoverIdx === idx;
          return (
            <g
              key={p.label + idx}
              onMouseEnter={() => setHoverIdx(idx)}
              onClick={() => setHoverIdx(isHovered ? null : idx)}
              style={{ cursor: p.value !== null ? 'pointer' : 'default' }}
            >
              {/* Full-slot invisible hit target eliminates tiny dot hover jitter */}
              <rect
                x={padL + idx * slotW}
                y={padT}
                width={slotW}
                height={plotH + 24}
                fill="transparent"
              />

              <text
                x={x}
                y={padT + plotH + 17}
                textAnchor="middle"
                fontSize={fontSizeTick}
                fontWeight={isHovered ? '700' : '500'}
                fill={isHovered ? '#0f172a' : '#475569'}
              >
                {p.label}
              </text>

              {p.value !== null && (
                <>
                  <circle
                    cx={x}
                    cy={getY(p.value)}
                    r={isHovered ? (enlarged ? 7 : 6) : enlarged ? 5 : 4.2}
                    fill={strokeColor}
                    stroke="#ffffff"
                    strokeWidth="1.8"
                  />
                  <text
                    x={x}
                    y={Math.max(14, getY(p.value) - (enlarged ? 11 : 9))}
                    textAnchor="middle"
                    fontSize={fontSizeVal}
                    fontWeight="700"
                    fill="#1e293b"
                    stroke="#ffffff"
                    strokeWidth="3.5"
                    strokeLinejoin="round"
                    style={{ paintOrder: 'stroke' }}
                  >
                    {p.value}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {xLabel && (
          <text
            x={padL + plotW / 2}
            y={viewH - 6}
            textAnchor="middle"
            fontSize={fontSizeTick}
            fontWeight="600"
            fill="#64748b"
          >
            {xLabel}
          </text>
        )}
      </svg>
    );
  }

  return (
    <ChartFrame
      title={title}
      tooltipContent={tooltipText}
      tooltipTone="sky"
      bordered={bordered}
      renderSvg={renderSvg}
    />
  );
}

export function SolarWeeklyLineChart({
  monthName,
  weeks,
}: {
  monthName: string;
  weeks: SolarWeekSummary[];
}) {
  const points: ChartPoint[] = weeks.map((w) => ({
    label: String(w.weekNumber),
    value: w.averageUnits,
    detail: `Week ${w.weekNumber} (${w.rangeLabel}): ${
      w.averageUnits !== null ? `${w.averageUnits} u/day` : 'No data'
    }`,
  }));

  return (
    <LineChartSvg
      title={`Weekly Average Production in ${monthName}`}
      xLabel="Week"
      yLabel="Units"
      points={points}
      strokeColor="#4f6bed"
      height={220}
      maxWidthViewBox={480}
      bordered
    />
  );
}

export function SolarDailyAvgLineChart({
  year,
  plantCapacityKw,
  rows,
}: {
  year: number;
  plantCapacityKw: number;
  rows: SolarYearTableRow[];
}) {
  const points: ChartPoint[] = rows.map((r) => ({
    label: r.shortMonthName,
    value: r.stats ? r.stats.dailyAverage : null,
    detail: r.stats
      ? `${r.monthName} ${year}: ${r.stats.dailyAverage} u/day (${r.stats.productionPerKw} u/kW)`
      : undefined,
  }));

  return (
    <LineChartSvg
      title={`Daily Average Production In Each Month For ${plantCapacityKw}kW Solar Plant In ${year}`}
      xLabel="Month"
      yLabel="Daily Avg (Units)"
      points={points}
      strokeColor="#0284c7"
      height={250}
      maxWidthViewBox={620}
      bordered={false}
    />
  );
}

export function SolarYearlyColumnChart({
  year,
  plantCapacityKw,
  rows,
}: {
  year: number;
  plantCapacityKw: number;
  rows: SolarYearTableRow[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const vals = rows.map((r) => (r.stats ? r.stats.totalUnits : 0));
  const maxVal = vals.length > 0 ? Math.max(...vals) : 100;
  const { yMax, ticks } = computeNiceScale(maxVal, 5);

  const hovered = hoverIdx !== null ? rows[hoverIdx] : null;
  const tooltipText = hovered?.stats
    ? `${hovered.monthName} ${year}: ${hovered.stats.totalUnits} kWh (${hovered.stats.recordedDays} days)`
    : null;
  const title = `Monthly Solar Production in ${year} (${plantCapacityKw}kW Plant)`;

  function renderSvg(enlarged: boolean) {
    const viewW = enlarged ? 780 : 620;
    const viewH = enlarged ? 340 : 250;
    const padL = enlarged ? 56 : 52;
    const padR = 18;
    const padT = enlarged ? 32 : 28;
    const padB = enlarged ? 38 : 34;
    const plotW = viewW - padL - padR;
    const plotH = viewH - padT - padB;

    const count = Math.max(1, rows.length);
    const slotW = plotW / count;
    const barW = Math.min(enlarged ? 50 : 44, Math.max(16, slotW * 0.62));
    const getY = (val: number) => padT + plotH - (val / yMax) * plotH;

    const fontSizeTick = enlarged ? 12 : 11;
    const fontSizeVal = enlarged ? 12 : 10.5;
    const gradId = enlarged ? `solarBarGradLg_${year}` : `solarBarGrad_${year}`;

    return (
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        className="solar-svg"
        role="img"
        aria-label={title}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" />
            <stop offset="100%" stopColor="#14b8a6" />
          </linearGradient>
        </defs>

        {ticks.map((t) => {
          const y = getY(t);
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={viewW - padR}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={fontSizeTick}
                fill="#64748b"
              >
                {t}
              </text>
            </g>
          );
        })}

        <text
          x={14}
          y={padT + plotH / 2}
          textAnchor="middle"
          fontSize={fontSizeTick}
          fontWeight="600"
          fill="#64748b"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}
        >
          Units (kWh)
        </text>

        {rows.map((r, idx) => {
          const cx = padL + slotW * idx + slotW / 2;
          const val = r.stats ? r.stats.totalUnits : 0;
          const barY = getY(val);
          const barH = Math.max(0, padT + plotH - barY);
          const isHovered = hoverIdx === idx;

          return (
            <g
              key={r.billingMonth}
              onMouseEnter={() => setHoverIdx(idx)}
              onClick={() => setHoverIdx(isHovered ? null : idx)}
              style={{ cursor: r.stats ? 'pointer' : 'default' }}
            >
              {/* Full-slot invisible hit target eliminates jitter across narrow bars */}
              <rect
                x={padL + idx * slotW}
                y={padT}
                width={slotW}
                height={plotH + 24}
                fill="transparent"
              />

              {r.stats && (
                <>
                  <rect
                    x={cx - barW / 2}
                    y={barY}
                    width={barW}
                    height={barH}
                    rx={4}
                    fill={isHovered ? '#0369a1' : `url(#${gradId})`}
                  />
                  <text
                    x={cx}
                    y={Math.max(14, barY - 6)}
                    textAnchor="middle"
                    fontSize={fontSizeVal}
                    fontWeight="700"
                    fill="#0f172a"
                  >
                    {val}
                  </text>
                </>
              )}
              <text
                x={cx}
                y={padT + plotH + 17}
                textAnchor="middle"
                fontSize={fontSizeTick}
                fontWeight={isHovered ? '700' : '500'}
                fill={isHovered ? '#0f172a' : '#475569'}
              >
                {r.shortMonthName}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <ChartFrame
      title={title}
      tooltipContent={tooltipText}
      tooltipTone="teal"
      bordered={false}
      renderSvg={renderSvg}
    />
  );
}
