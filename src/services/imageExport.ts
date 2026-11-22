import type { BillRecord, ZoneKey } from '../types';
import type { SolarMonthComputedStats, SolarYearSummary } from './solarCalculator';

export function sanitizeImageFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'solar-image'}.png`;
}

export async function downloadCanvasAsPng(
  canvas: HTMLCanvasElement,
  filename: string
): Promise<void> {
  const pngBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );

  if (pngBlob) {
    const dlUrl = URL.createObjectURL(pngBlob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
  } else {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif';

const ZONE_LABELS: { key: ZoneKey; name: string }[] = [
  { key: 'NL', name: 'Normal (NL / WNL)' },
  { key: 'OP', name: 'Off Peak (OP / WOP)' },
  { key: 'PK', name: 'Peak (PK / WPK)' },
];

export async function exportBillRecordAsPng(record: BillRecord): Promise<void> {
  const isCumulative = record.meteringMode === 'cumulative';
  const readingRows: {
    channel: string;
    zone: string;
    ir: number;
    fr: number;
    units: number;
  }[] = [];

  for (const group of ['import', 'export', 'generation'] as const) {
    const channelLabel =
      group === 'import' ? 'Net Import' : group === 'export' ? 'Net Export' : 'Solar Gen';
    const zones = isCumulative
      ? [{ key: 'NL' as ZoneKey, name: group === 'generation' ? 'Cumulative (WAL)' : 'Cumulative' }]
      : ZONE_LABELS;
    for (const z of zones) {
      const item = record.readings[group][z.key];
      readingRows.push({
        channel: channelLabel,
        zone: z.name,
        ir: item.ir,
        fr: item.fr,
        units: item.units,
      });
    }
  }

  const chargeRows: { label: string; value: string; bold?: boolean }[] = [
    { label: 'Fixed Charge', value: `₹ ${record.summary.fixedCharge.toFixed(2)}` },
    {
      label: `Energy Charge (${record.summary.billedUnits} billed units)`,
      value: `₹ ${record.summary.energyCharge.toFixed(2)}`,
    },
    { label: 'Fuel Surcharge', value: `₹ ${record.summary.fuelSurcharge.toFixed(2)}` },
    { label: 'Electricity Duty', value: `₹ ${record.summary.electricityDuty.toFixed(2)}` },
    { label: 'Round Off', value: record.summary.roundOff.toFixed(2) },
    {
      label: 'Total Bill Amount',
      value: `₹ ${record.summary.totalAmount.toFixed(2)}`,
      bold: true,
    },
  ];

  const logicalW = 780;
  const padX = 28;
  const padTop = 26;
  const padBottom = 26;
  const contentW = logicalW - padX * 2;
  const headerBlockH = 56;
  const sectionTitleH = 30;
  const tableHeaderH = 34;
  const rowH = 34;
  const gapBetweenSections = 18;

  const logicalH =
    padTop +
    headerBlockH +
    sectionTitleH +
    tableHeaderH +
    readingRows.length * rowH +
    gapBetweenSections +
    sectionTitleH +
    chargeRows.length * rowH +
    padBottom;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = logicalW * scale;
  canvas.height = logicalH * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.scale(scale, scale);

  // Crisp white card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, logicalW, logicalH);

  let y = padTop;

  // Title & Consumer metadata
  const titleText = `${record.billingLabel} — ${
    record.recordType === 'official_bill' ? 'Official KSEB PDF Bill' : 'Saved Meter Calculation'
  }${isCumulative ? ' [Cumulative]' : ''}`;
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 18px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(titleText, padX, y + 10, contentW);

  const subText = `Consumer: ${record.consumerName || '—'} (${record.consumerNo || '—'}) • Phase: ${
    record.tariffPhase
  } • Mode: ${isCumulative ? 'Cumulative (Pre-Oct 2025)' : 'ToD'} • Bank Opening: ${
    record.bankOpening
  } → Closing: ${record.bankClosing}`;
  ctx.fillStyle = '#64748b';
  ctx.font = `500 12.5px ${FONT_STACK}`;
  ctx.fillText(subText, padX, y + 34, contentW);

  y += headerBlockH;

  // Readings Section Title
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 14.5px ${FONT_STACK}`;
  ctx.fillText(
    isCumulative
      ? 'Cumulative Meter Readings & Consumption'
      : 'Zone-Wise Meter Readings & Consumption',
    padX,
    y + 14,
    contentW
  );
  y += sectionTitleH;

  // Readings Table Header
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(padX, y, contentW, tableHeaderH);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, y + tableHeaderH);
  ctx.lineTo(padX + contentW, y + tableHeaderH);
  ctx.stroke();

  const colChannel = padX + 12;
  const colZone = padX + 150;
  const colIr = padX + 445;
  const colFr = padX + 575;
  const colUnits = padX + contentW - 12;

  ctx.fillStyle = '#475569';
  ctx.font = `700 11px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText('CHANNEL', colChannel, y + tableHeaderH / 2);
  ctx.fillText('ZONE', colZone, y + tableHeaderH / 2);
  ctx.textAlign = 'right';
  ctx.fillText('INITIAL (IR)', colIr, y + tableHeaderH / 2);
  ctx.fillText('FINAL (FR)', colFr, y + tableHeaderH / 2);
  ctx.fillText('UNITS (KWH)', colUnits, y + tableHeaderH / 2);
  y += tableHeaderH;

  // Readings Rows
  for (const row of readingRows) {
    const cy = y + rowH / 2;
    ctx.fillStyle = '#1e293b';
    ctx.font = `500 13px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(row.channel, colChannel, cy);
    ctx.fillText(row.zone, colZone, cy);
    ctx.textAlign = 'right';
    ctx.fillText(String(row.ir), colIr, cy);
    ctx.fillText(String(row.fr), colFr, cy);
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 13px ${FONT_STACK}`;
    ctx.fillText(String(row.units), colUnits, cy);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(padX, y + rowH);
    ctx.lineTo(padX + contentW, y + rowH);
    ctx.stroke();
    y += rowH;
  }

  y += gapBetweenSections;

  // Charge Summary Section Title
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 14.5px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText('Charge Summary', padX, y + 14, contentW);
  y += sectionTitleH;

  // Charge Summary Rows
  for (const c of chargeRows) {
    const cy = y + rowH / 2;
    if (c.bold) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(padX, y, contentW, rowH);
    }
    ctx.fillStyle = c.bold ? '#0f172a' : '#1e293b';
    ctx.font = `${c.bold ? '700' : '500'} 13.5px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(c.label, colChannel, cy);
    ctx.textAlign = 'right';
    ctx.fillText(c.value, colUnits, cy);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(padX, y + rowH);
    ctx.lineTo(padX + contentW, y + rowH);
    ctx.stroke();
    y += rowH;
  }

  const filename = sanitizeImageFilename(
    `kseb-bill-${record.billingMonth}-${record.recordType === 'official_bill' ? 'pdf' : 'estimate'}`
  );
  await downloadCanvasAsPng(canvas, filename);
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function fmtNum(val: number | null | undefined, maxDecimals = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return String(Number(val.toFixed(maxDecimals)));
}

export async function exportSolarMonthBreakdownAsPng(
  stats: SolarMonthComputedStats,
  showEstimated: boolean,
  weeklySvgEl: SVGSVGElement | null
): Promise<void> {
  const logicalW = 1000;
  const padX = 28;
  const padTop = 24;
  const padBottom = 24;
  const contentW = logicalW - padX * 2;
  const bannerH = 44;
  const kpiGap = 10;
  const kpiH = 74;
  const splitGap = 16;
  const leftW = 450;
  const rightW = contentW - leftW - splitGap;

  const kpiItems: { label: string; value: string; sub?: string }[] = [
    { label: 'Total Units Produced', value: fmtNum(stats.totalUnits) },
    { label: 'Daily Average Production', value: stats.dailyAverage.toFixed(2) },
    ...(showEstimated
      ? [{ label: 'Estimated Production', value: fmtNum(stats.estimatedProduction) }]
      : []),
    {
      label: 'Import',
      value: fmtNum(stats.importUnits),
      sub:
        stats.matchedBillMonth && stats.record.importOverride === undefined
          ? `From ${stats.matchedBillMonth} bill`
          : undefined,
    },
    { label: 'Export', value: fmtNum(stats.exportUnits) },
    {
      label: 'Average Import',
      value: fmtNum(stats.averageImport),
      sub:
        stats.exactAverageImport !== null
          ? `Exact: ${stats.exactAverageImport.toFixed(2)}`
          : undefined,
    },
  ];

  const statCells: { head: string; value: string }[] = [
    { head: 'Max Production', value: fmtNum(stats.maxUnits) },
    { head: 'Min Production', value: fmtNum(stats.minUnits) },
    ...stats.weeks.map((wk) => ({
      head: `Week ${wk.weekNumber} (${wk.rangeLabel})`,
      value: fmtNum(wk.averageUnits, 1),
    })),
    { head: 'Production Per kW', value: stats.productionPerKw.toFixed(2) },
  ];

  const statRowsCount = Math.ceil(statCells.length / 2);
  const statCellH = 60;
  const leftGridH = statRowsCount * statCellH;

  let weeklyChartImg: HTMLImageElement | null = null;
  let svgUrl: string | null = null;
  let chartRenderW = rightW - 24;
  let chartRenderH = Math.round(chartRenderW * (220 / 480));

  if (weeklySvgEl) {
    const vb = weeklySvgEl.viewBox.baseVal;
    const svgW = vb && vb.width > 0 ? vb.width : 480;
    const svgH = vb && vb.height > 0 ? vb.height : 220;
    chartRenderH = Math.round((chartRenderW * svgH) / svgW);

    const clone = weeklySvgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(svgW));
    clone.setAttribute('height', String(svgH));
    clone.style.fontFamily = FONT_STACK;

    const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml;charset=utf-8',
    });
    svgUrl = URL.createObjectURL(svgBlob);
  }

  try {
    if (svgUrl) {
      weeklyChartImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not render weekly chart SVG.'));
        image.src = svgUrl;
      });
    }

    const rightBoxH = weeklyChartImg ? 42 + chartRenderH + 12 : leftGridH;
    const splitH = Math.max(leftGridH, rightBoxH);

    const logicalH =
      padTop + bannerH + 14 + kpiH + 16 + splitH + padBottom;

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = logicalW * scale;
    canvas.height = logicalH * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable.');

    ctx.scale(scale, scale);

    // White page background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, logicalW, logicalH);

    let y = padTop;

    // 1. Month green banner
    drawRoundedRectPath(ctx, padX, y, contentW, bannerH, 10);
    ctx.fillStyle = '#bbf7d0';
    ctx.fill();
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#14532d';
    ctx.font = `800 17px ${FONT_STACK}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`${stats.monthName} ${stats.year}`, padX + 14, y + bannerH / 2);

    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.fillText(
      `${stats.recordedDays}/${stats.daysInMonth} days`,
      padX + contentW - 14,
      y + bannerH / 2
    );

    y += bannerH + 14;

    // 2. KPI boxes strip
    const cols = kpiItems.length;
    const boxW = (contentW - (cols - 1) * kpiGap) / cols;
    kpiItems.forEach((item, idx) => {
      const bx = padX + idx * (boxW + kpiGap);
      drawRoundedRectPath(ctx, bx, y, boxW, kpiH, 10);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = `600 11px ${FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, bx + 10, y + 18, boxW - 20);

      ctx.fillStyle = '#0f172a';
      ctx.font = `800 17px ${FONT_STACK}`;
      ctx.fillText(item.value, bx + 10, y + 43, boxW - 20);

      if (item.sub) {
        ctx.fillStyle = '#64748b';
        ctx.font = `500 10px ${FONT_STACK}`;
        ctx.fillText(item.sub, bx + 10, y + 61, boxW - 20);
      }
    });

    y += kpiH + 16;

    // 3a. Left Stat Grid
    const colW = leftW / 2;
    drawRoundedRectPath(ctx, padX, y, leftW, leftGridH, 10);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(padX, y, leftW, leftGridH);

    statCells.forEach((cell, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = padX + col * colW;
      const cy = y + row * statCellH;

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(cx, cy, colW, 26);

      ctx.fillStyle = '#0f172a';
      ctx.font = `700 11px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cell.head, cx + colW / 2, cy + 13, colW - 10);

      ctx.font = `700 15px ${FONT_STACK}`;
      ctx.fillText(cell.value, cx + colW / 2, cy + 43, colW - 10);

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 26);
      ctx.lineTo(cx + colW, cy + 26);
      ctx.moveTo(cx, cy + statCellH);
      ctx.lineTo(cx + colW, cy + statCellH);
      if (col === 0) {
        ctx.moveTo(cx + colW, cy);
        ctx.lineTo(cx + colW, cy + statCellH);
      }
      ctx.stroke();
    });
    ctx.restore();

    drawRoundedRectPath(ctx, padX, y, leftW, leftGridH, 10);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 3b. Right Weekly Line Chart Card
    if (weeklyChartImg) {
      const rx = padX + leftW + splitGap;
      drawRoundedRectPath(ctx, rx, y, rightW, rightBoxH, 10);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.font = `700 14px ${FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `Weekly Average Production in ${stats.monthName}`,
        rx + 12,
        y + 20,
        rightW - 24
      );

      ctx.drawImage(weeklyChartImg, rx + 12, y + 36, chartRenderW, chartRenderH);
    }

    await downloadCanvasAsPng(
      canvas,
      sanitizeImageFilename(`solar-breakdown-${stats.record.billingMonth}`)
    );
  } finally {
    if (svgUrl) URL.revokeObjectURL(svgUrl);
  }
}

export async function exportSolarYearSummaryAsPng(
  yearSummary: SolarYearSummary,
  plantKw: number
): Promise<void> {
  const padX = 28;
  const padTop = 26;
  const padBottom = 26;
  const headerH = 44;
  const tableHeaderH = 36;
  const rowH = 34;

  const colWidths = [
    190, // Month / Summary label
    110, // Units Produced
    120, // Daily Avg
    76, // Per kW
    82, // Max Units
    82, // Min Units
    ...Array.from({ length: yearSummary.maxWeekCount }, () => 68),
  ];

  const contentW = colWidths.reduce((a, b) => a + b, 0);
  const logicalW = padX * 2 + contentW;
  const totalRows = yearSummary.rows.length + 2; // months + 2 footer rows
  const logicalH = padTop + headerH + tableHeaderH + totalRows * rowH + padBottom;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = logicalW * scale;
  canvas.height = logicalH * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.scale(scale, scale);

  // Crisp white card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, logicalW, logicalH);

  let y = padTop;

  // Title + Months pill
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 18px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(
    `${yearSummary.year} Yearly Solar Summary (${plantKw}kW Plant)`,
    padX,
    y + 14,
    contentW - 140
  );

  const badgeText = `${yearSummary.monthsWithData} month${
    yearSummary.monthsWithData === 1 ? '' : 's'
  }`;
  ctx.font = `700 12px ${FONT_STACK}`;
  const badgeW = Math.max(82, ctx.measureText(badgeText).width + 22);
  const badgeH = 24;
  const badgeX = padX + contentW - badgeW;
  const badgeY = y + 2;
  drawRoundedRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 12);
  ctx.fillStyle = '#ccfbf1';
  ctx.fill();
  ctx.fillStyle = '#0f766e';
  ctx.textAlign = 'center';
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);

  y += headerH;

  // Compute column right edges (or left edge for col 0)
  const colStarts: number[] = [];
  let accX = padX;
  for (const w of colWidths) {
    colStarts.push(accX);
    accX += w;
  }

  // Table header
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(padX, y, contentW, tableHeaderH);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, y + tableHeaderH);
  ctx.lineTo(padX + contentW, y + tableHeaderH);
  ctx.stroke();

  const headers = [
    'MONTH',
    'UNITS PRODUCED',
    'DAILY AVG (UNITS)',
    'PER KW',
    'MAX UNITS',
    'MIN UNITS',
    ...Array.from({ length: yearSummary.maxWeekCount }, (_, i) => `WEEK ${i + 1}`),
  ];

  ctx.fillStyle = '#475569';
  ctx.font = `700 10.5px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';
  headers.forEach((h, i) => {
    if (i === 0) {
      ctx.textAlign = 'left';
      ctx.fillText(h, colStarts[0] + 10, y + tableHeaderH / 2);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(h, colStarts[i] + colWidths[i] - 10, y + tableHeaderH / 2);
    }
  });
  y += tableHeaderH;

  // Month rows
  for (const row of yearSummary.rows) {
    const cy = y + rowH / 2;
    const st = row.stats;

    ctx.fillStyle = '#0f172a';
    ctx.font = `700 13px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(row.monthName, colStarts[0] + 10, cy);

    const cells = [
      st ? fmtNum(st.totalUnits) : '—',
      st ? st.dailyAverage.toFixed(2) : '—',
      st ? st.productionPerKw.toFixed(2) : '—',
      st ? fmtNum(st.maxUnits) : '—',
      st ? fmtNum(st.minUnits) : '—',
      ...Array.from({ length: yearSummary.maxWeekCount }, (_, i) => {
        const wk = st?.weeks[i];
        return wk ? fmtNum(wk.averageUnits, 1) : '—';
      }),
    ];

    ctx.fillStyle = st ? '#1e293b' : '#94a3b8';
    ctx.font = `500 13px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    cells.forEach((val, idx) => {
      const colIdx = idx + 1;
      ctx.fillText(val, colStarts[colIdx] + colWidths[colIdx] - 10, cy);
    });

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(padX, y + rowH);
    ctx.lineTo(padX + contentW, y + rowH);
    ctx.stroke();
    y += rowH;
  }

  // Summary row 1: Total Units
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(padX, y, contentW, rowH);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(padX + contentW, y);
  ctx.stroke();

  let cy = y + rowH / 2;
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 13px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText('Total Units', colStarts[0] + 10, cy);
  ctx.textAlign = 'right';
  ctx.fillText(fmtNum(yearSummary.totalUnits), colStarts[1] + colWidths[1] - 10, cy);
  ctx.fillStyle = '#64748b';
  ctx.font = `500 12.5px ${FONT_STACK}`;
  ctx.fillText(
    `Monthly Avg: ${fmtNum(yearSummary.monthlyAverageInYear, 1)} kWh / mo (${yearSummary.totalRecordedDays} recorded days)`,
    padX + contentW - 10,
    cy
  );
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, y + rowH);
  ctx.lineTo(padX + contentW, y + rowH);
  ctx.stroke();
  y += rowH;

  // Summary row 2: Average Production in {year}
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(padX, y, contentW, rowH);
  cy = y + rowH / 2;
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 13px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText(`Average Production in ${yearSummary.year}`, colStarts[0] + 10, cy);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748b';
  ctx.font = `500 13px ${FONT_STACK}`;
  ctx.fillText('—', colStarts[1] + colWidths[1] - 10, cy);
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 13px ${FONT_STACK}`;
  ctx.fillText(yearSummary.dailyAverageInYear.toFixed(2), colStarts[2] + colWidths[2] - 10, cy);
  ctx.fillText(
    yearSummary.productionPerKwInYear.toFixed(2),
    colStarts[3] + colWidths[3] - 10,
    cy
  );
  ctx.fillStyle = '#64748b';
  ctx.font = `500 12.5px ${FONT_STACK}`;
  ctx.fillText('Weighted daily avg across uploaded days', padX + contentW - 10, cy);

  ctx.strokeStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(padX, y + rowH);
  ctx.lineTo(padX + contentW, y + rowH);
  ctx.stroke();

  await downloadCanvasAsPng(
    canvas,
    sanitizeImageFilename(`solar-yearly-summary-${yearSummary.year}`)
  );
}
