import { useState } from 'react';
import type { SolarWeekSummary, SolarYearTableRow } from '../services/solarCalculator';

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
  const yMax = Math.max(step, Math.ceil((safeMax * 1.08) / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + step * 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return { yMax: ticks[ticks.length - 1] ?? yMax, ticks };
}

interface LineChartBaseProps {
  title: string;
  xLabel?: string;
  yLabel: string;
  points: ChartPoint[];
  strokeColor?: string;
  height?: number;
  maxWidthViewBox?: number;
}

function LineChartSvg({
  title,
  xLabel,
  yLabel,
  points,
  strokeColor = '#4f6bed',
  height = 240,
  maxWidthViewBox = 560,
}: LineChartBaseProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const padL = 48;
  const padR = 20;
  const padT = 26;
  const padB = xLabel ? 44 : 30;
  const plotW = maxWidthViewBox - padL - padR;
  const plotH = height - padT - padB;

  const numericValues = points.map((p) => p.value).filter((v): v is number => v !== null);
  const maxVal = numericValues.length > 0 ? Math.max(...numericValues) : 10;
  const { yMax, ticks } = computeNiceScale(maxVal, 5);

  const count = points.length;
  const getX = (i: number) =>
    count <= 1 ? padL + plotW / 2 : padL + (i / (count - 1)) * plotW;
  const getY = (val: number) => padT + plotH - (val / yMax) * plotH;

  // Build contiguous polyline segments across non-null points
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

  const activePoint = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="solar-chart-box">
      <div className="solar-chart-header">
        <div className="solar-chart-title">{title}</div>
        {activePoint && activePoint.value !== null && (
          <span className="badge badge-sky">
            {activePoint.detail ?? `${activePoint.label}: ${activePoint.value}`}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${maxWidthViewBox} ${height}`}
        className="solar-svg"
        role="img"
        aria-label={title}
      >
        {/* Horizontal grid lines */}
        {ticks.map((t) => {
          const y = getY(t);
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={maxWidthViewBox - padR}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#64748b"
              >
                {t}
              </text>
            </g>
          );
        })}

        {/* Y axis label */}
        <text
          x={14}
          y={padT + plotH / 2}
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fill="#64748b"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}
        >
          {yLabel}
        </text>

        {/* Line segments */}
        {segments.map((pts, sIdx) => (
          <polyline
            key={sIdx}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={pts}
          />
        ))}

        {/* Points, labels, and X axis ticks */}
        {points.map((p, idx) => {
          const x = getX(idx);
          const isHovered = hoverIdx === idx;
          return (
            <g
              key={p.label + idx}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              onClick={() => setHoverIdx(isHovered ? null : idx)}
              style={{ cursor: p.value !== null ? 'pointer' : 'default' }}
            >
              <text
                x={x}
                y={padT + plotH + 17}
                textAnchor="middle"
                fontSize="11"
                fontWeight={isHovered ? '700' : '500'}
                fill="#475569"
              >
                {p.label}
              </text>

              {p.value !== null && (
                <>
                  <circle
                    cx={x}
                    cy={getY(p.value)}
                    r={isHovered ? 6 : 4.5}
                    fill={strokeColor}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <text
                    x={x}
                    y={Math.max(12, getY(p.value) - 9)}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#1e293b"
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
            y={height - 6}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="#64748b"
          >
            {xLabel}
          </text>
        )}
      </svg>
    </div>
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
  const W = 620;
  const H = 250;
  const padL = 52;
  const padR = 18;
  const padT = 26;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const vals = rows.map((r) => (r.stats ? r.stats.totalUnits : 0));
  const maxVal = vals.length > 0 ? Math.max(...vals) : 100;
  const { yMax, ticks } = computeNiceScale(maxVal, 5);

  const count = Math.max(1, rows.length);
  const slotW = plotW / count;
  const barW = Math.min(44, Math.max(16, slotW * 0.62));
  const getY = (val: number) => padT + plotH - (val / yMax) * plotH;

  const hovered = hoverIdx !== null ? rows[hoverIdx] : null;

  return (
    <div className="solar-chart-box">
      <div className="solar-chart-header">
        <div className="solar-chart-title">
          Monthly Solar Production in {year} ({plantCapacityKw}kW Plant)
        </div>
        {hovered?.stats && (
          <span className="badge badge-teal">
            {hovered.monthName}: {hovered.stats.totalUnits} kWh ({hovered.stats.recordedDays} d)
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="solar-svg"
        role="img"
        aria-label={`Monthly Solar Production in ${year}`}
      >
        <defs>
          <linearGradient id={`solarBarGrad_${year}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" />
            <stop offset="100%" stopColor="#14b8a6" />
          </linearGradient>
        </defs>

        {ticks.map((t) => {
          const y = getY(t);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#64748b">
                {t}
              </text>
            </g>
          );
        })}

        <text
          x={14}
          y={padT + plotH / 2}
          textAnchor="middle"
          fontSize="11"
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
              onMouseLeave={() => setHoverIdx(null)}
              onClick={() => setHoverIdx(isHovered ? null : idx)}
              style={{ cursor: r.stats ? 'pointer' : 'default' }}
            >
              {r.stats && (
                <>
                  <rect
                    x={cx - barW / 2}
                    y={barY}
                    width={barW}
                    height={barH}
                    rx={4}
                    fill={isHovered ? '#0369a1' : `url(#solarBarGrad_${year})`}
                  />
                  <text
                    x={cx}
                    y={Math.max(13, barY - 6)}
                    textAnchor="middle"
                    fontSize="11"
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
                fontSize="11"
                fontWeight={isHovered ? '700' : '500'}
                fill="#475569"
              >
                {r.shortMonthName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
